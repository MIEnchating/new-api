package service

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func newUpstreamRequestIdTestContext() *gin.Context {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	return c
}

func TestCaptureUpstreamRequestIdFallsBackToProviderHeader(t *testing.T) {
	c := newUpstreamRequestIdTestContext()

	requestId := CaptureUpstreamRequestId(c, http.Header{
		providerRequestIdHeader: []string{"sub2api-request-id"},
	})

	require.Equal(t, "sub2api-request-id", requestId)
	require.Equal(t, "sub2api-request-id", c.GetString(common.UpstreamRequestIdKey))
}

func TestCaptureUpstreamRequestIdPrefersOneapiHeader(t *testing.T) {
	c := newUpstreamRequestIdTestContext()

	CaptureUpstreamRequestId(c, http.Header{
		providerRequestIdHeader: []string{"sub2api-request-id"},
	})
	requestId := CaptureUpstreamRequestId(c, http.Header{
		common.RequestIdKey:     []string{"oneapi-request-id"},
		providerRequestIdHeader: []string{"sub2api-request-id"},
	})

	require.Equal(t, "oneapi-request-id", requestId)
	require.Equal(t, "oneapi-request-id", c.GetString(common.UpstreamRequestIdKey))
}

func TestCaptureUpstreamRequestIdUpdatesAcrossUpstreamAttempts(t *testing.T) {
	c := newUpstreamRequestIdTestContext()

	CaptureUpstreamRequestId(c, http.Header{
		providerRequestIdHeader: []string{"first-sub2api-request-id"},
	})
	requestId := CaptureUpstreamRequestId(c, http.Header{
		providerRequestIdHeader: []string{"second-sub2api-request-id"},
	})

	require.Equal(t, "second-sub2api-request-id", requestId)
	require.Equal(t, "second-sub2api-request-id", c.GetString(common.UpstreamRequestIdKey))
}

func TestShouldCopyUpstreamHeaderPreservesPriorityAcrossIterationOrder(t *testing.T) {
	fallbackFirst := newUpstreamRequestIdTestContext()

	require.True(t, ShouldCopyUpstreamHeader(fallbackFirst, providerRequestIdHeader, []string{"sub2api-request-id"}))
	require.False(t, ShouldCopyUpstreamHeader(fallbackFirst, common.RequestIdKey, []string{"oneapi-request-id"}))
	require.Equal(t, "oneapi-request-id", fallbackFirst.GetString(common.UpstreamRequestIdKey))

	primaryFirst := newUpstreamRequestIdTestContext()
	require.False(t, ShouldCopyUpstreamHeader(primaryFirst, common.RequestIdKey, []string{"oneapi-request-id"}))
	require.True(t, ShouldCopyUpstreamHeader(primaryFirst, providerRequestIdHeader, []string{"sub2api-request-id"}))
	require.Equal(t, "oneapi-request-id", primaryFirst.GetString(common.UpstreamRequestIdKey))
}
