package middleware

import (
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
)

func TestShouldUseChannelAffinity(t *testing.T) {
	gin.SetMode(gin.TestMode)
	oldEnabled := common.ChannelRouteCooldownEnabled
	oldSeconds := common.ChannelRouteCooldownSeconds
	t.Cleanup(func() {
		common.ChannelRouteCooldownEnabled = oldEnabled
		common.ChannelRouteCooldownSeconds = oldSeconds
	})

	newContext := func() *gin.Context {
		ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
		return ctx
	}

	common.ChannelRouteCooldownEnabled = false
	common.ChannelRouteCooldownSeconds = 60
	assert.True(t, shouldUseChannelAffinity(newContext()))

	common.ChannelRouteCooldownEnabled = true
	assert.False(t, shouldUseChannelAffinity(newContext()))

	common.ChannelRouteCooldownEnabled = false
	ctx := newContext()
	common.SetContextKey(ctx, constant.ContextKeyTokenGroupRoutes, []model.TokenGroupRoute{{Group: "default"}})
	assert.False(t, shouldUseChannelAffinity(ctx))

	ctx = newContext()
	common.SetContextKey(ctx, constant.ContextKeyUsingGroup, "auto")
	assert.False(t, shouldUseChannelAffinity(ctx))
}
