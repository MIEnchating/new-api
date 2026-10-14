package service

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
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

func TestCaptureUpstreamRequestIdSelectsOneHeaderPerResponse(t *testing.T) {
	for _, tc := range []struct {
		name    string
		headers http.Header
		want    []string
		sources map[string]string
	}{
		{"client and provider", http.Header{"X-Client-Request-Id": {" client-id "}, "X-Request-Id": {"Provider-ID"}}, []string{"Provider-ID"}, map[string]string{"Provider-ID": "x-request-id"}},
		{"all three", http.Header{common.RequestIdKey: {"oneapi-id"}, "X-Client-Request-Id": {"client-id"}, "X-Request-Id": {"provider-id"}}, []string{"oneapi-id"}, map[string]string{"oneapi-id": "x-oneapi-request-id"}},
		{"client fallback", http.Header{"X-Client-Request-Id": {" client-id "}, "X-Request-Id": {" "}}, []string{"client-id"}, map[string]string{"client-id": "x-client-request-id"}},
		{"same value", http.Header{common.RequestIdKey: {"shared"}, "X-Client-Request-Id": {"shared"}, "X-Request-Id": {"shared"}}, []string{"shared"}, map[string]string{"shared": "x-oneapi-request-id"}},
		{"case sensitive values", http.Header{"X-Client-Request-Id": {"ID"}, "X-Request-Id": {"id"}}, []string{"id"}, map[string]string{"id": "x-request-id"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c := newUpstreamRequestIdTestContext()
			c.Set(common.RequestIdKey, "local-id")
			for range 2 {
				assert.Equal(t, tc.want[0], CaptureUpstreamRequestId(c, tc.headers))
			}
			assert.Equal(t, tc.want[0], c.GetString(common.UpstreamRequestIdKey))
			assert.Equal(t, tc.want, c.GetStringSlice(common.UpstreamRequestIdsKey))
			assert.Equal(t, tc.sources, c.MustGet(common.UpstreamRequestIdSourcesKey))
			assert.Equal(t, "local-id", c.GetString(common.RequestIdKey))
		})
	}
}

func TestCaptureUpstreamRequestIdSourcePriorityAcrossAttempts(t *testing.T) {
	c := newUpstreamRequestIdTestContext()
	for _, headerName := range []string{"x-ReQuEsT-ID", "X-CLIENT-REQUEST-ID", "x-request-id", "x-oneAPI-request-ID", "X-Client-Request-Id"} {
		header := http.Header{}
		header.Set(headerName, "shared")
		CaptureUpstreamRequestId(c, header)
		source := c.MustGet(common.UpstreamRequestIdSourcesKey).(map[string]string)["shared"]
		switch headerName {
		case "x-ReQuEsT-ID", "X-CLIENT-REQUEST-ID", "x-request-id":
			assert.Equal(t, "x-request-id", source)
		default:
			assert.Equal(t, "x-oneapi-request-id", source)
		}
	}
	assert.Equal(t, []string{"shared"}, c.GetStringSlice(common.UpstreamRequestIdsKey))
}

func TestCaptureUpstreamRequestIdClearsPrimaryWithoutHeaders(t *testing.T) {
	for _, header := range []http.Header{nil, {}, {"X-Client-Request-Id": {"  "}, "X-Request-Id": {" "}}} {
		c := newUpstreamRequestIdTestContext()
		CaptureUpstreamRequestId(c, http.Header{"X-Request-Id": {"previous"}})
		assert.Empty(t, CaptureUpstreamRequestId(c, header))
		assert.Empty(t, c.GetString(common.UpstreamRequestIdKey))
		assert.Equal(t, []string{"previous"}, c.GetStringSlice(common.UpstreamRequestIdsKey))
	}
}

func TestShouldCopyUpstreamHeaderDoesNotCaptureIDs(t *testing.T) {
	c := newUpstreamRequestIdTestContext()
	c.Set(common.UpstreamRequestIdKey, "current")
	c.Header(common.RequestIdKey, "local")
	header := http.Header{common.RequestIdKey: {"upstream"}, "X-Client-Request-Id": {"client"}, "X-Request-Id": {"provider"}, "Content-Length": {"100"}}
	IOCopyBytesGracefully(c, &http.Response{Header: header, StatusCode: http.StatusOK}, []byte("body"))
	assert.Equal(t, "current", c.GetString(common.UpstreamRequestIdKey))
	assert.Empty(t, c.GetStringSlice(common.UpstreamRequestIdsKey))
	assert.Equal(t, "local", c.Writer.Header().Get(common.RequestIdKey))
	assert.Equal(t, "4", c.Writer.Header().Get("Content-Length"))
	assert.Equal(t, "client", c.Writer.Header().Get("X-Client-Request-ID"))
	assert.Equal(t, "provider", c.Writer.Header().Get("X-Request-ID"))
	assert.True(t, ShouldCopyUpstreamHeader(c, "x-request-id", []string{"provider"}))
	assert.False(t, ShouldCopyUpstreamHeader(c, "x-oneapi-request-id", []string{"upstream"}))
}
