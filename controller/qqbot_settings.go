package controller

import (
	"errors"
	"net/http"
	"slices"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/pkg/qqbot"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

type QQBotSettings struct {
	Runtime *qqbot.Runtime
}

func (h QQBotSettings) Get(c *gin.Context) {
	if _, ok := middleware.GetSessionAuthIdentity(c); !ok {
		c.Status(http.StatusForbidden)
		return
	}
	settings, err := h.Runtime.Settings(model.CachedQQBotSettings())
	if err != nil {
		common.ApiErrorStatus(c, http.StatusInternalServerError, common.NewMessage(err.Error()))
		return
	}
	common.ApiSuccess(c, settings)
}

func (h QQBotSettings) Update(c *gin.Context) {
	identity, ok := middleware.GetSessionAuthIdentity(c)
	if !ok {
		c.Status(http.StatusForbidden)
		return
	}
	var input qqbot.SettingsUpdate
	if err := common.DecodeJsonBody(http.MaxBytesReader(c.Writer, c.Request.Body, 16<<10), &input); err != nil {
		common.ApiErrorStatus(c, http.StatusBadRequest, common.NewMessage("Invalid parameters"))
		return
	}
	previous := model.CachedQQBotSettings()
	sealed, err := h.Runtime.PrepareUpdate(previous, input, identity.UserID)
	if errors.Is(err, qqbot.ErrSettingsConflict) {
		common.ApiErrorStatus(c, http.StatusConflict, common.NewMessage(qqbot.ErrSettingsConflict.Error()))
		return
	}
	if err != nil {
		common.ApiErrorStatus(c, http.StatusBadRequest, common.NewMessage(err.Error()))
		return
	}
	settings, err := h.Runtime.Settings(sealed)
	if err != nil {
		common.ApiErrorStatus(c, http.StatusInternalServerError, common.NewMessage("Could not read the saved QQ bot settings."))
		return
	}
	if settings.ChatSource == qqbot.ChatSourceBuiltin && settings.ChatTokenID > 0 {
		token, groups, err := qqBotTokenGroups(identity.UserID, settings.ChatTokenID)
		if err != nil {
			common.ApiErrorStatus(c, http.StatusBadRequest, err)
			return
		}
		if !slices.Contains(groups, settings.ChatGroup) ||
			!qqBotModelAvailable(token, settings.ChatGroup, settings.ChatModel, qqbot.ChatPath(settings.ChatProtocol)) {
			common.ApiErrorStatus(c, http.StatusBadRequest, common.NewMessage("The selected model is unavailable for this API key and group."))
			return
		}
	}
	if middleware.RequireSecurityProof(c, service.VerificationOperation{Scope: service.VerificationScopeQQBotSettings}) == nil {
		return
	}
	if err = model.SaveQQBotSettings(c.Request.Context(), previous, sealed); err != nil {
		if errors.Is(err, model.ErrQQBotSettingsChanged) {
			common.ApiErrorStatus(c, http.StatusConflict, common.NewMessage(qqbot.ErrSettingsConflict.Error()))
		} else {
			common.ApiErrorStatus(c, http.StatusInternalServerError, common.NewMessage("Could not save the QQ bot settings."))
		}
		return
	}
	h.Runtime.Refresh()
	recordManageAudit(c, "option.update", map[string]any{"key": model.QQBotSettingsOptionKey})
	common.ApiSuccess(c, settings)
}

func (h QQBotSettings) ChatOptions(c *gin.Context) {
	identity, ok := middleware.GetSessionAuthIdentity(c)
	if !ok {
		c.Status(http.StatusForbidden)
		return
	}
	keyID, err := strconv.Atoi(c.Query("token_id"))
	path := qqbot.ChatPath(c.Query("protocol"))
	if err != nil || keyID <= 0 || path == "" {
		common.ApiErrorStatus(c, http.StatusBadRequest, common.NewMessage("Invalid parameters"))
		return
	}
	token, groups, err := qqBotTokenGroups(identity.UserID, keyID)
	if err != nil {
		common.ApiErrorStatus(c, http.StatusBadRequest, err)
		return
	}
	models := []string{}
	group := c.Query("group")
	if group != "" && slices.Contains(groups, group) {
		for _, modelName := range model.GetGroupEnabledModels(group) {
			if qqBotModelAvailable(token, group, modelName, path) {
				models = append(models, modelName)
			}
		}
		slices.Sort(models)
	}
	common.ApiSuccess(c, gin.H{"groups": groups, "models": models})
}

func (h QQBotSettings) DiscoveredGroups(c *gin.Context) {
	if _, ok := middleware.GetSessionAuthIdentity(c); !ok {
		c.Status(http.StatusForbidden)
		return
	}
	groups, err := h.Runtime.DiscoveredGroups(c.Request.Context())
	if err != nil {
		common.ApiErrorStatus(c, http.StatusServiceUnavailable, common.NewMessage("Failed to load discovered QQ groups."))
		return
	}
	common.ApiSuccess(c, groups)
}

func (h QQBotSettings) ExternalModels(c *gin.Context) {
	if _, ok := middleware.GetSessionAuthIdentity(c); !ok {
		c.Status(http.StatusForbidden)
		return
	}
	var input qqbot.ExternalModelsInput
	if err := common.DecodeJsonBody(http.MaxBytesReader(c.Writer, c.Request.Body, 16<<10), &input); err != nil {
		common.ApiErrorStatus(c, http.StatusBadRequest, common.NewMessage("Invalid parameters"))
		return
	}
	models, err := h.Runtime.FetchExternalModels(c.Request.Context(), model.CachedQQBotSettings(), input)
	if err != nil {
		status := http.StatusBadRequest
		if errors.Is(err, qqbot.ErrExternalModelFetch) {
			status = http.StatusBadGateway
		}
		common.ApiErrorStatus(c, status, common.NewMessage(err.Error()))
		return
	}
	common.ApiSuccess(c, models)
}

func qqBotTokenGroups(ownerID, tokenID int) (*model.Token, []string, error) {
	unavailable := common.NewMessage("The selected API key is unavailable.")
	token, err := model.GetTokenByIds(tokenID, ownerID)
	if err != nil || token.Status != common.TokenStatusEnabled ||
		(token.ExpiredTime != -1 && token.ExpiredTime < common.GetTimestamp()) {
		return nil, nil, unavailable
	}
	token, err = token.ResolveRoutingTemplate()
	if err != nil {
		return nil, nil, unavailable
	}
	owner, err := model.GetUserCache(ownerID)
	if err != nil || owner.Status != common.UserStatusEnabled {
		return nil, nil, unavailable
	}
	groups, err := service.TokenModelGroups(token, owner.Group)
	if err != nil {
		return nil, nil, unavailable
	}
	allowed := make([]string, 0, len(groups))
	for _, group := range groups {
		if service.IsUserSelectableGroup(owner.Group, group) {
			allowed = append(allowed, group)
		}
	}
	return token, allowed, nil
}

func qqBotModelAvailable(token *model.Token, group, name, path string) bool {
	if strings.TrimSpace(name) == "" ||
		(token.ModelLimitsEnabled && !middleware.TokenModelLimitAllows(token.GetModelLimitsMap(), name)) {
		return false
	}
	candidates, err := model.ListSatisfiedChannelCandidates(group, name, path)
	if err != nil {
		return false
	}
	return slices.ContainsFunc(candidates, func(candidate model.ChannelSelectionCandidate) bool {
		return candidate.Status == common.ChannelStatusEnabled
	})
}
