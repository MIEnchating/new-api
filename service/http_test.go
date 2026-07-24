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
	require.Equal(t, []string{"sub2api-request-id"}, c.GetStringSlice(common.UpstreamRequestIdsKey))
	require.Equal(t, map[string]string{
		"sub2api-request-id": upstreamRequestIdSourceGenericID,
	}, c.MustGet(common.UpstreamRequestIdSourcesKey))
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
	require.Equal(t, []string{"sub2api-request-id", "oneapi-request-id"}, c.GetStringSlice(common.UpstreamRequestIdsKey))
	require.Equal(t, map[string]string{
		"sub2api-request-id": upstreamRequestIdSourceGenericID,
		"oneapi-request-id":  upstreamRequestIdSourceOneAPI,
	}, c.MustGet(common.UpstreamRequestIdSourcesKey))
}

func TestCaptureUpstreamRequestIdPrefersSpecificSourceForSameValue(t *testing.T) {
	c := newUpstreamRequestIdTestContext()

	CaptureUpstreamRequestId(c, http.Header{
		providerRequestIdHeader: []string{"shared-request-id"},
	})
	CaptureUpstreamRequestId(c, http.Header{
		common.RequestIdKey: []string{"shared-request-id"},
	})

	require.Equal(t, map[string]string{
		"shared-request-id": upstreamRequestIdSourceOneAPI,
	}, c.MustGet(common.UpstreamRequestIdSourcesKey))
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
	require.Equal(t, []string{"first-sub2api-request-id", "second-sub2api-request-id"}, c.GetStringSlice(common.UpstreamRequestIdsKey))
}

func TestCaptureUpstreamRequestIdDeduplicatesChain(t *testing.T) {
	c := newUpstreamRequestIdTestContext()
	header := http.Header{providerRequestIdHeader: []string{"same-request-id"}}

	CaptureUpstreamRequestId(c, header)
	CaptureUpstreamRequestId(c, header)

	require.Equal(t, []string{"same-request-id"}, c.GetStringSlice(common.UpstreamRequestIdsKey))
}

func TestCaptureUpstreamRequestIdSelectsOneIdPerResponse(t *testing.T) {
	c := newUpstreamRequestIdTestContext()

	CaptureUpstreamRequestId(c, http.Header{
		common.RequestIdKey:     []string{"oneapi-request-id"},
		providerRequestIdHeader: []string{"provider-request-id"},
	})

	require.Equal(t, []string{"oneapi-request-id"}, c.GetStringSlice(common.UpstreamRequestIdsKey))
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
