package service

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"net/url"
	"os"
	"slices"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"gorm.io/gorm"
)

var ErrSSOInvalid = errors.New("single sign-on is unavailable or the request has expired")

// ChatGPT2APISSOConfig is an explicit trust relationship, separate from dashboard credentials.
type ChatGPT2APISSOConfig struct {
	Secret  string
	Origin  string
	Issuers []string
}

func LoadChatGPT2APISSOConfig() (ChatGPT2APISSOConfig, error) {
	cfg := ChatGPT2APISSOConfig{Secret: os.Getenv("CHATGPT2API_SSO_SECRET"), Origin: os.Getenv("CHATGPT2API_SSO_ORIGIN")}
	if len(cfg.Secret) < 32 || !validSSOOrigin(cfg.Origin) {
		return cfg, ErrSSOInvalid
	}
	for issuer := range strings.SplitSeq(os.Getenv("NEWAPI_SSO_ORIGINS"), ",") {
		issuer = strings.TrimSpace(issuer)
		if !validSSOOrigin(issuer) || issuer == cfg.Origin {
			return cfg, ErrSSOInvalid
		}
		cfg.Issuers = append(cfg.Issuers, issuer)
	}
	if len(cfg.Issuers) == 0 {
		return cfg, ErrSSOInvalid
	}
	return cfg, nil
}

func validSSOOrigin(raw string) bool {
	u, err := url.Parse(raw)
	return err == nil && u.Scheme == "https" && u.Hostname() != "" && u.User == nil && u.Path == "" && u.RawQuery == "" && u.Fragment == "" && u.String() == raw
}

// SSORequest is signed by the trusted client and binds the callback to its PKCE transaction.
type SSORequest struct {
	Issuer    string `json:"issuer"`
	Audience  string `json:"audience"`
	State     string `json:"state"`
	Challenge string `json:"challenge"`
	ExpiresAt int64  `json:"expires_at"`
}

type ssoGrant struct {
	SSORequest
	Identity AuthIdentity `json:"identity"`
}

type ssoSession struct {
	Issuer    string       `json:"issuer"`
	Audience  string       `json:"audience"`
	Identity  AuthIdentity `json:"identity"`
	ExpiresAt int64        `json:"expires_at"`
}

type SSOUser struct {
	ID          int    `json:"user_id"`
	Username    string `json:"username"`
	DisplayName string `json:"display_name"`
	Email       string `json:"email"`
	// Access to the image application's administration is managed there, independently.
	Reference string `json:"reference,omitempty"`
	ExpiresAt int64  `json:"expires_at"`
}

func sealSSO(value any, key []byte, purpose string) (string, error) {
	payload, err := common.Marshal(value)
	if err != nil {
		return "", err
	}
	encoded := base64.RawURLEncoding.EncodeToString(payload)
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte("chatgpt2api-sso/v1/" + purpose + "/" + encoded))
	return encoded + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil)), nil
}

func openSSO(raw string, key []byte, purpose string, value any) error {
	if len(raw) > 8192 {
		return ErrSSOInvalid
	}
	payload, signature, ok := strings.Cut(raw, ".")
	if !ok {
		return ErrSSOInvalid
	}
	sig, err := base64.RawURLEncoding.DecodeString(signature)
	if err != nil {
		return ErrSSOInvalid
	}
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte("chatgpt2api-sso/v1/" + purpose + "/" + payload))
	if !hmac.Equal(sig, mac.Sum(nil)) {
		return ErrSSOInvalid
	}
	data, err := base64.RawURLEncoding.DecodeString(payload)
	if err != nil || common.Unmarshal(data, value) != nil {
		return ErrSSOInvalid
	}
	return nil
}

func (cfg ChatGPT2APISSOConfig) AcceptsIssuer(issuer string) bool {
	return slices.Contains(cfg.Issuers, issuer)
}

func (cfg ChatGPT2APISSOConfig) Authorize(raw, issuer string, identity AuthIdentity) (string, error) {
	var request SSORequest
	if openSSO(raw, []byte(cfg.Secret), "request", &request) != nil ||
		request.Issuer != issuer || !cfg.AcceptsIssuer(issuer) || request.Audience != cfg.Origin ||
		request.ExpiresAt <= time.Now().Unix() || request.ExpiresAt > time.Now().Add(10*time.Minute).Unix() ||
		!validSSORandom(request.State) || !validSSORandom(request.Challenge) {
		return "", ErrSSOInvalid
	}
	if _, err := ssoUser(identity); err != nil {
		return "", err
	}
	payload, err := common.Marshal(ssoGrant{SSORequest: request, Identity: identity})
	if err != nil {
		return "", err
	}
	code, _, err := model.CreateAuthFlow(model.AuthFlowCreate{
		Purpose: model.AuthFlowPurposeChatGPT2APISSO, UserId: identity.UserID, SessionId: identity.SessionID,
		Payload: string(payload), ExpiresAt: time.Now().Add(time.Minute),
	})
	if err != nil {
		return "", err
	}
	query := url.Values{"code": {code}, "state": {request.State}, "iss": {issuer}}
	return cfg.Origin + "/auth/sso/callback?" + query.Encode(), nil
}

func validSSORandom(raw string) bool {
	value, err := base64.RawURLEncoding.DecodeString(raw)
	return err == nil && len(value) == 32 && base64.RawURLEncoding.EncodeToString(value) == raw
}

func (cfg ChatGPT2APISSOConfig) Exchange(code, verifier, issuer string) (*SSOUser, error) {
	if !validSSORandom(code) || !validSSORandom(verifier) || !cfg.AcceptsIssuer(issuer) {
		return nil, ErrSSOInvalid
	}
	var grant ssoGrant
	_, err := model.ConsumeAuthFlowWithAction(code, model.AuthFlowMatch{Purpose: model.AuthFlowPurposeChatGPT2APISSO}, func(tx *gorm.DB, flow *model.AuthFlow) error {
		if common.UnmarshalJsonStr(flow.Payload, &grant) != nil {
			return ErrSSOInvalid
		}
		digest := sha256.Sum256([]byte(verifier))
		if grant.Audience != cfg.Origin || grant.Issuer != issuer || !hmac.Equal([]byte(grant.Challenge), []byte(base64.RawURLEncoding.EncodeToString(digest[:]))) {
			return ErrSSOInvalid
		}
		return model.ValidateAuthSessionWithTx(tx, grant.Identity)
	})
	if err != nil {
		return nil, err
	}
	user, err := ssoUser(grant.Identity)
	if err != nil {
		return nil, err
	}
	user.Reference, err = sealSSO(ssoSession{Issuer: issuer, Audience: cfg.Origin, Identity: grant.Identity, ExpiresAt: user.ExpiresAt}, []byte(cfg.Secret), "session")
	return user, err
}

func (cfg ChatGPT2APISSOConfig) Validate(reference, issuer string) (*SSOUser, error) {
	var session ssoSession
	if openSSO(reference, []byte(cfg.Secret), "session", &session) != nil ||
		session.Issuer != issuer || !cfg.AcceptsIssuer(issuer) || session.Audience != cfg.Origin || session.ExpiresAt <= time.Now().Unix() {
		return nil, ErrSSOInvalid
	}
	return ssoUser(session.Identity)
}

// Read the authoritative rows on every exchange/introspection. Dashboard cache
// propagation does not delay revocation in the relying application.
func ssoUser(identity AuthIdentity) (*SSOUser, error) {
	session, err := model.GetUserSessionBySID(identity.SessionID)
	if err != nil {
		return nil, ErrSSOInvalid
	}
	user, err := model.GetSelfUserById(identity.UserID)
	if err != nil || user.Status != common.UserStatusEnabled || user.AuthVersion != identity.UserAuthVersion ||
		session.UserID != identity.UserID || session.UserAuthVersion != identity.UserAuthVersion || session.Version != identity.SessionVersion ||
		session.Status != model.UserSessionStatusActive || session.RevokedAt != 0 || session.ExpiresAt <= time.Now().Unix() {
		return nil, ErrSSOInvalid
	}
	return &SSOUser{ID: user.Id, Username: user.Username, DisplayName: user.DisplayName, Email: user.Email, ExpiresAt: session.ExpiresAt}, nil
}
