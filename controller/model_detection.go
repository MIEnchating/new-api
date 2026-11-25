package controller

import (
	"context"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"io"
	"net"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"

	"github.com/gin-gonic/gin"
)

type modelDetectionChallengeSet struct {
	ExpiresAt  int64                             `json:"expires_at"`
	Challenges []service.ModelDetectionChallenge `json:"challenges"`
}

type modelDetectionRelayKey struct{}

type modelDetectionRelayIdentity struct {
	session service.AuthIdentity
	group   string
}

func GetModelDetectionChallenges(c *gin.Context) {
	identity, ok := middleware.GetAuthIdentity(c)
	if !ok || c.GetBool("use_access_token") {
		c.AbortWithStatus(http.StatusUnauthorized)
		return
	}

	challenges, err := service.PrepareModelDetectionChallenges(c.Request.Context())
	if err != nil {
		writeModelDetectionError(c, err)
		return
	}
	set := modelDetectionChallengeSet{
		ExpiresAt:  time.Now().Add(30 * time.Minute).Unix(),
		Challenges: challenges,
	}
	payload, err := common.Marshal(set)
	if err != nil {
		writeModelDetectionError(c, err)
		return
	}
	encoded := base64.RawURLEncoding.EncodeToString(payload)
	sig := common.GenerateHMACWithKey([]byte(common.SessionSecret), "model-detection-challenges:"+identity.SessionID+":"+encoded)
	common.ApiSuccess(c, gin.H{"challenges": challenges, "token": encoded + "." + sig})
}

func openModelDetectionChallengeSet(token, sessionID string, now time.Time) ([]service.ModelDetectionChallenge, bool) {
	encoded, signature, ok := strings.Cut(token, ".")
	if !ok || len(token) > 12<<10 || sessionID == "" {
		return nil, false
	}
	expected := common.GenerateHMACWithKey([]byte(common.SessionSecret), "model-detection-challenges:"+sessionID+":"+encoded)
	if subtle.ConstantTimeCompare([]byte(expected), []byte(signature)) != 1 {
		return nil, false
	}
	data, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil {
		return nil, false
	}
	var set modelDetectionChallengeSet
	if common.Unmarshal(data, &set) != nil || len(set.Challenges) != 3 || set.ExpiresAt <= now.Unix() {
		return nil, false
	}
	return set.Challenges, true
}

func RunModelDetection(relay http.Handler) gin.HandlerFunc {
	return func(c *gin.Context) {
		identity, ok := middleware.GetAuthIdentity(c)
		if !ok || c.GetBool("use_access_token") {
			c.AbortWithStatus(http.StatusUnauthorized)
			return
		}
		body, err := io.ReadAll(http.MaxBytesReader(c.Writer, c.Request.Body, 16<<10))
		var input service.ModelDetectionRequest
		if err != nil || common.Unmarshal(body, &input) != nil || input.Validate() != nil {
			writeModelDetectionError(c, service.ErrModelDetectionInput)
			return
		}
		userGroup := common.GetContextKeyString(c, constant.ContextKeyUserGroup)
		groups := []string{input.Group}
		if input.Group == "auto" && service.GroupInUserUsableGroups(userGroup, input.Group) {
			groups = service.GetUserAutoGroup(userGroup)
		} else if !service.IsUserSelectableGroup(userGroup, input.Group) {
			groups = nil
		}
		if !slices.Contains(service.GetGroupsEnabledModels(groups), input.Model) {
			common.ApiErrorStatus(c, http.StatusForbidden, common.NewMessage("This model is unavailable in the selected group."))
			return
		}

		var challenges []service.ModelDetectionChallenge
		if input.Mode == "detect" {
			challenges, ok = openModelDetectionChallengeSet(input.ChallengeToken, identity.SessionID, time.Now())
			if !ok {
				common.ApiErrorStatus(c, http.StatusBadRequest, common.NewMessage("Generate a new sample set and try again."))
				return
			}
		}

		relayIdentity := modelDetectionRelayIdentity{session: identity, group: input.Group}
		clientAddress := net.JoinHostPort(c.ClientIP(), "0")
		var runRelay http.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// The browser's authenticated identity stays in this process.
			r.RemoteAddr = clientAddress
			relay.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), modelDetectionRelayKey{}, relayIdentity)))
		})
		if input.APIURL != "" {
			target, err := service.ModelDetectionAPIAddress(input.APIURL, input.Endpoint)
			if err != nil {
				common.ApiErrorStatus(c, http.StatusBadRequest, common.NewMessage("This API address is unavailable for model detection."))
				return
			}
			key := strings.TrimPrefix(input.APIKey, "sk-")
			token, err := model.ValidateUserToken(key)
			if err != nil || token == nil || token.UserId != identity.UserID || token.IsManxueTestToken() ||
				subtle.ConstantTimeCompare([]byte(token.Key), []byte(key)) != 1 {
				common.ApiErrorStatus(c, http.StatusForbidden, common.NewMessage("Use an active API key for the selected group."))
				return
			}
			tokenGroup := token.Group
			if tokenGroup == "" {
				tokenGroup = userGroup
			}
			if token.GroupRouteConfig != "" || tokenGroup != input.Group ||
				(token.ModelLimitsEnabled && !middleware.TokenModelLimitAllows(token.GetModelLimitsMap(), input.Model)) {
				common.ApiErrorStatus(c, http.StatusForbidden, common.NewMessage("Use an active API key for the selected group."))
				return
			}
			runRelay = service.ModelDetectionAddressRelay(target, input.APIKey, input.Endpoint)
		}
		response, err := service.RunModelDetection(c.Request.Context(), input, challenges, runRelay)
		if err != nil {
			writeModelDetectionError(c, err)
			return
		}
		common.ApiSuccess(c, response)
	}
}

// ModelDetectionRelayContext is installed on the private relay router. Its
// identity is supplied by the authenticated detection handler, never a header.
func ModelDetectionRelayContext(c *gin.Context) {
	identity, ok := c.Request.Context().Value(modelDetectionRelayKey{}).(modelDetectionRelayIdentity)
	if !ok {
		c.AbortWithStatus(http.StatusUnauthorized)
		return
	}
	_, user, err := service.ValidateLoginSession(identity.session)
	if err != nil {
		c.AbortWithStatus(http.StatusUnauthorized)
		return
	}
	if !service.IsUserSelectableGroup(user.Group, identity.group) &&
		!(identity.group == "auto" && service.GroupInUserUsableGroups(user.Group, "auto")) {
		c.AbortWithStatus(http.StatusForbidden)
		return
	}
	user.WriteContext(c)
	c.Set("role", user.Role)
	common.SetContextKey(c, constant.ContextKeyDashboardRelay, true)
	common.SetContextKey(c, constant.ContextKeyUsingGroup, identity.group)
	_ = middleware.SetupContextForToken(c, &model.Token{
		UserId: user.Id,
		Name:   "model-detection",
		Group:  identity.group,
	})
	c.Next()
}

func writeModelDetectionError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, context.Canceled):
		return
	case errors.Is(err, context.DeadlineExceeded):
		common.ApiErrorStatus(c, http.StatusGatewayTimeout, common.NewMessage("Model detection timed out."))
	case errors.Is(err, service.ErrModelDetectionInput):
		common.ApiErrorStatus(c, http.StatusBadRequest, common.NewMessage("Invalid model detection settings."))
	case errors.Is(err, service.ErrModelDetectionUnavailable):
		common.ApiErrorStatus(c, http.StatusServiceUnavailable, common.NewMessage("The model detection CLI is unavailable on this server."))
	case errors.Is(err, service.ErrModelDetectionBusy):
		common.ApiErrorStatus(c, http.StatusTooManyRequests, common.NewMessage("Model detection is busy. Try again shortly."))
	default:
		common.ApiErrorStatus(c, http.StatusBadGateway, common.NewMessage("Model detection failed."))
	}
}
