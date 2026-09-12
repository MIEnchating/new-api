package controller

import (
	"crypto/hmac"
	"net/http"
	"net/url"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

func StartChatGPT2APISSO(c *gin.Context) {
	cfg, err := service.LoadChatGPT2APISSOConfig()
	issuer := c.Query("issuer")
	if err != nil || !cfg.AcceptsIssuer(issuer) {
		ssoError(c)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"url": cfg.Origin + "/auth/sso/start?issuer=" + url.QueryEscape(issuer)}})
}

func AuthorizeChatGPT2APISSO(c *gin.Context) {
	identity, ok := middleware.GetSessionAuthIdentity(c)
	if !ok {
		ssoError(c)
		return
	}
	success := false
	defer func() {
		recordUserSecurityAudit(c, identity.UserID, "user.sso_authorize", map[string]any{"client": "chatgpt2api", "success": success})
	}()
	cfg, err := service.LoadChatGPT2APISSOConfig()
	var request struct {
		Request string `json:"request"`
	}
	if err != nil || common.DecodeJson(c.Request.Body, &request) != nil {
		ssoError(c)
		return
	}
	target, err := cfg.Authorize(request.Request, c.GetHeader("Origin"), identity)
	if err != nil {
		ssoError(c)
		return
	}
	success = true
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"url": target}})
}

// ExchangeChatGPT2APISSO and ValidateChatGPT2APISSO accept only the backend's
// dedicated credential; no dashboard credentials or browser cookies are accepted.
func ExchangeChatGPT2APISSO(c *gin.Context) { serveChatGPT2APISSO(c, true) }
func ValidateChatGPT2APISSO(c *gin.Context) { serveChatGPT2APISSO(c, false) }

func serveChatGPT2APISSO(c *gin.Context, exchange bool) {
	cfg, err := service.LoadChatGPT2APISSOConfig()
	if err != nil || !hmac.Equal([]byte(c.GetHeader("Authorization")), []byte("Bearer "+cfg.Secret)) {
		ssoError(c)
		return
	}
	var request struct {
		Code      string `json:"code"`
		Verifier  string `json:"verifier"`
		Issuer    string `json:"issuer"`
		Reference string `json:"reference"`
	}
	if common.DecodeJson(c.Request.Body, &request) != nil {
		ssoError(c)
		return
	}
	var user *service.SSOUser
	if exchange {
		user, err = cfg.Exchange(request.Code, request.Verifier, request.Issuer)
	} else {
		user, err = cfg.Validate(request.Reference, request.Issuer)
	}
	if err != nil {
		ssoError(c)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": user})
}

func ssoError(c *gin.Context) {
	c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "Single sign-on failed. Please return to the platform and try again."})
}
