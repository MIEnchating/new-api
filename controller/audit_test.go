package controller

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestAuditContentTemplatesCoverManualActions(t *testing.T) {
	actions := []string{
		"user.create",
		"user.update",
		"user.delete",
		"user.manage",
		"user.quota_add",
		"user.quota_subtract",
		"user.quota_override",
		"user.binding_clear",
		"user.2fa_disable",
		"user.passkey_register",
		"user.passkey_delete",
		"user.reset_passkey",
		"option.update",
		"cache_hit_rate_baseline.update",
		"cache_monitor_groups.update",
		"channel.create",
		"channel.update",
		"channel.status_update",
		"channel.status_update_batch",
		"channel.delete",
		"channel.delete_batch",
		"channel.delete_disabled",
		"channel.key_view",
		"channel.tag_disable",
		"channel.tag_enable",
		"channel.tag_edit",
		"channel.tag_batch_set",
		"channel.copy",
		"channel.multi_key_manage",
		"channel.route_cooldown_clear",
		"channel.upstream_apply",
		"channel.upstream_apply_all",
		"channel.upstream_detect_all",
		"redemption.create",
		"subscription.plan_reset",
		"subscription.user_plan_reset",
	}

	for _, action := range actions {
		_, ok := auditContentTemplates[action]
		require.Truef(t, ok, "missing audit content template for %s", action)
	}
}

func TestAuditRequestInfoIncludesRouteContext(t *testing.T) {
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	var info map[string]interface{}
	engine.PUT("/api/channel/:id", func(c *gin.Context) {
		info = auditRequestInfo(c)
		c.Status(http.StatusNoContent)
	})

	request := httptest.NewRequest(http.MethodPut, "/api/channel/42", nil)
	response := httptest.NewRecorder()
	engine.ServeHTTP(response, request)

	require.Equal(t, true, info["success"])
	require.Equal(t, http.MethodPut, info["method"])
	require.Equal(t, "/api/channel/:id", info["route"])
	require.Equal(t, "/api/channel/42", info["path"])
	require.Equal(t, map[string]string{"id": "42"}, info["params"])
}

func TestBuildOptionAuditParamsOnlyIncludesAllowlistedValues(t *testing.T) {
	allowlistedKeys := []string{
		"RetryTimes",
		"AutomaticRetryStatusCodes",
		"ChannelRouteCooldownEnabled",
		"ChannelRouteCooldownSeconds",
		"ChannelRouteSameChannelRetries",
		"ChannelRouteGroupExclusionsEnabled",
		"ChannelRouteGroupExclusions",
	}
	for _, key := range allowlistedKeys {
		allowed := buildOptionAuditParams(key, "from-value", "to-value")
		require.Equal(t, map[string]interface{}{
			"key":  key,
			"from": "from-value",
			"to":   "to-value",
		}, allowed)
	}

	sensitive := buildOptionAuditParams("GitHubClientSecret", "old-secret", "new-secret")
	require.Equal(t, map[string]interface{}{
		"key": "GitHubClientSecret",
	}, sensitive)
}
