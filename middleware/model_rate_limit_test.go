package middleware

import (
	"context"
	"net/http"
	"sync/atomic"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

var memoryModelRateLimitTestUserSequence atomic.Int64

func TestModelRedisRateLimitUsesUTCRegardlessOfLocalTimezone(t *testing.T) {
	redisServer, redisClient := useRateLimitMiniRedis(t)
	previousLocation := time.Local
	time.Local = time.FixedZone("test-utc-plus-eight", 8*60*60)
	t.Cleanup(func() { time.Local = previousLocation })

	ctx := context.Background()
	recordKey := "rateLimit:model-utc-record"
	recordRedisRequest(ctx, redisClient, recordKey, 2)
	recorded, err := redisClient.LIndex(ctx, recordKey, 0).Result()
	require.NoError(t, err)
	recordedAt, err := time.Parse(modelRateLimitTimeFormat, recorded)
	require.NoError(t, err)
	assert.WithinDuration(t, time.Now().UTC(), recordedAt, 2*time.Second)

	checkKey := "rateLimit:model-utc-check"
	withinWindow := time.Now().UTC().Add(-30 * time.Second).Format(modelRateLimitTimeFormat)
	_, err = redisServer.Push(checkKey, withinWindow, withinWindow)
	require.NoError(t, err)
	allowed, err := checkRedisRateLimit(ctx, redisClient, checkKey, 2, 60)
	require.NoError(t, err)
	assert.False(t, allowed, "an existing UTC timestamp inside the window must remain limited on a non-UTC host")
}

func TestMemoryModelRateLimitOptionalLimits(t *testing.T) {
	gin.SetMode(gin.TestMode)
	previousDuration := setting.ModelRequestRateLimitDurationMinutes
	setting.ModelRequestRateLimitDurationMinutes = 1
	t.Cleanup(func() { setting.ModelRequestRateLimitDurationMinutes = previousDuration })

	for _, tc := range []struct {
		name            string
		totalMaxCount   int
		successMaxCount int
		thirdStatusCode int
	}{
		{name: "total only", totalMaxCount: 2, thirdStatusCode: http.StatusTooManyRequests},
		{name: "both disabled", thirdStatusCode: http.StatusNoContent},
		{name: "success only", successMaxCount: 2, thirdStatusCode: http.StatusTooManyRequests},
	} {
		t.Run(tc.name, func(t *testing.T) {
			// The shared limiter persists across test cases and repeated test runs.
			userID := 7060000 + int(memoryModelRateLimitTestUserSequence.Add(1))
			router := gin.New()
			router.GET(
				"/limited",
				func(c *gin.Context) { c.Set("id", userID) },
				memoryRateLimitHandler(60, tc.totalMaxCount, tc.successMaxCount),
				func(c *gin.Context) { c.Status(http.StatusNoContent) },
			)

			require.Equal(t, http.StatusNoContent, performRateLimitRequest(router, "/limited", "192.0.2.70:12345").Code)
			require.Equal(t, http.StatusNoContent, performRateLimitRequest(router, "/limited", "192.0.2.70:12345").Code)
			assert.Equal(t, tc.thirdStatusCode, performRateLimitRequest(router, "/limited", "192.0.2.70:12345").Code)
		})
	}
}
