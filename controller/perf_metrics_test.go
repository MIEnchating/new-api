package controller

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestValidateCacheHitRateBaseline(t *testing.T) {
	for _, baseline := range []int{0, 85, 100} {
		require.NoError(t, validateCacheHitRateBaseline(baseline))
	}
	for _, baseline := range []int{-1, 101} {
		require.Error(t, validateCacheHitRateBaseline(baseline))
	}
}

func TestUpdateCacheHitRateBaselineRequiresValue(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(
		http.MethodPut,
		"/api/status-monitor/cache/baseline",
		strings.NewReader(`{}`),
	)

	UpdateCacheHitRateBaseline(ctx)

	require.Contains(t, recorder.Body.String(), `"success":false`)
	require.Contains(t, recorder.Body.String(), "无效的参数")
}
