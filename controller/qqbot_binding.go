package controller

import (
	"encoding/base64"
	"errors"
	"net/http"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/pkg/qqbot"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

type QQBotBinding struct{ Runtime *qqbot.Runtime }

func (h QQBotBinding) Get(c *gin.Context) {
	identity, ok := middleware.GetSessionAuthIdentity(c)
	if !ok {
		c.Status(http.StatusForbidden)
		return
	}
	bound, err := model.HasQQBotIdentity(identity.UserID)
	if err != nil {
		writeSecurityOperationError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"enabled": h.Runtime.ActiveAppID() != "", "bound": bound})
}

func (h QQBotBinding) Bind(c *gin.Context) {
	identity, ok := middleware.GetSessionAuthIdentity(c)
	if !ok {
		c.Status(http.StatusForbidden)
		return
	}
	success := false
	defer func() {
		recordUserSecurityAudit(c, identity.UserID, "user.binding_bind", map[string]any{"provider": model.QQBotIdentityProvider, "success": success})
	}()
	var request struct {
		Code string `json:"code"`
	}
	if common.DecodeJsonBody(http.MaxBytesReader(c.Writer, c.Request.Body, 1024), &request) != nil {
		writeSecurityOperationError(c, model.ErrAuthFlowInvalid)
		return
	}
	code := strings.TrimSpace(request.Code)
	decoded, err := base64.RawURLEncoding.DecodeString(code)
	if err != nil || len(decoded) != model.AuthFlowTokenBytes || base64.RawURLEncoding.EncodeToString(decoded) != code {
		writeSecurityOperationError(c, model.ErrAuthFlowInvalid)
		return
	}
	appID := h.Runtime.ActiveAppID()
	if appID == "" {
		writeSecurityOperationError(c, model.ErrAuthFlowInvalid)
		return
	}
	intent, err := common.Marshal(service.AccountBindingContext{Provider: model.QQBotIdentityProvider, Code: code})
	if err != nil {
		writeSecurityOperationError(c, err)
		return
	}
	proof := middleware.RequireSecurityProof(c, service.VerificationOperation{Scope: service.VerificationScopeAccountBind, Context: intent})
	if proof == nil {
		return
	}
	if appID != h.Runtime.ActiveAppID() {
		writeSecurityOperationError(c, model.ErrAuthFlowInvalid)
		return
	}
	err = model.BindQQBotIdentity(code, appID, proof.AuthSessionIdentity)
	if errors.Is(err, model.ErrAuthFlowInvalid) {
		err = model.BindQQBotGroupIdentity(code, appID, proof.AuthSessionIdentity, h.Runtime.ActiveGroups(appID))
	}
	if err != nil {
		writeSecurityOperationError(c, err)
		return
	}
	success = true
	common.ApiSuccess(c, gin.H{"bound": true})
}

func (h QQBotBinding) Unbind(c *gin.Context) {
	identity, ok := middleware.GetSessionAuthIdentity(c)
	if !ok {
		c.Status(http.StatusForbidden)
		return
	}
	success := false
	defer func() {
		recordUserSecurityAudit(c, identity.UserID, "user.binding_unbind", map[string]any{"provider": model.QQBotIdentityProvider, "success": success})
	}()
	proof := middleware.RequireSecurityProof(c, service.VerificationOperation{Scope: service.VerificationScopeQQBotUnbind})
	if proof == nil {
		return
	}
	if err := model.UnbindQQBotIdentity(proof.AuthSessionIdentity); err != nil {
		writeSecurityOperationError(c, err)
		return
	}
	success = true
	common.ApiSuccess(c, gin.H{"bound": false})
}
