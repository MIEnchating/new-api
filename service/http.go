package service

import (
	"bytes"
	"fmt"
	"io"
	"maps"
	"net/http"
	"slices"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/logger"

	"github.com/gin-gonic/gin"
)

const providerRequestIdHeader = "X-Request-Id"

const (
	upstreamRequestIdSourceOneAPI    = "x-oneapi-request-id"
	upstreamRequestIdSourceClientID  = "x-client-request-id"
	upstreamRequestIdSourceGenericID = "x-request-id"
)

// upstreamRequestHeaderID also accepts non-canonical maps from custom transports.
func upstreamRequestHeaderID(header http.Header, source string) string {
	if id := strings.TrimSpace(header.Get(source)); id != "" {
		return id
	}
	for _, key := range slices.Sorted(maps.Keys(header)) {
		if strings.EqualFold(key, source) && len(header[key]) > 0 {
			if id := strings.TrimSpace(header[key][0]); id != "" {
				return id
			}
		}
	}
	return ""
}

func appendUpstreamRequestId(c *gin.Context, requestId string) {
	requestId = strings.TrimSpace(requestId)
	if requestId == "" {
		return
	}
	requestIds := c.GetStringSlice(common.UpstreamRequestIdsKey)
	if slices.Contains(requestIds, requestId) {
		return
	}
	c.Set(common.UpstreamRequestIdsKey, append(requestIds, requestId))
}

func recordUpstreamRequestIdSource(c *gin.Context, requestId string, source string) {
	requestId = strings.TrimSpace(requestId)
	if requestId == "" || source == "" {
		return
	}
	sources, _ := c.Get(common.UpstreamRequestIdSourcesKey)
	sourceByRequestId, _ := sources.(map[string]string)
	if sourceByRequestId == nil {
		sourceByRequestId = make(map[string]string)
	}
	// Keep the most specific source even when a later attempt repeats an ID.
	sourcesByPriority := []string{upstreamRequestIdSourceOneAPI, upstreamRequestIdSourceGenericID, upstreamRequestIdSourceClientID}
	previousPriority := slices.Index(sourcesByPriority, sourceByRequestId[requestId])
	if previousPriority < 0 || slices.Index(sourcesByPriority, source) < previousPriority {
		sourceByRequestId[requestId] = source
	}
	c.Set(common.UpstreamRequestIdSourcesKey, sourceByRequestId)
}

// CaptureUpstreamRequestId records one ID per response: native request ID,
// generic request ID, then client correlation ID as a fallback.
// An empty response clears the primary ID but preserves IDs from earlier attempts.
func CaptureUpstreamRequestId(c *gin.Context, header http.Header) string {
	if c == nil {
		return ""
	}
	c.Set(common.UpstreamRequestIdKey, "")
	for _, source := range []string{upstreamRequestIdSourceOneAPI, upstreamRequestIdSourceGenericID, upstreamRequestIdSourceClientID} {
		requestID := upstreamRequestHeaderID(header, source)
		if requestID == "" {
			continue
		}
		c.Set(common.UpstreamRequestIdKey, requestID)
		appendUpstreamRequestId(c, requestID)
		recordUpstreamRequestIdSource(c, requestID, source)
		return requestID
	}
	return ""
}

// CaptureUpstreamRequestIds records request IDs returned by an upstream response.
func CaptureUpstreamRequestIds(c *gin.Context, header http.Header, channelType int) {
	c.Set(common.UpstreamRequestIdKey, "")
	if channelType == constant.ChannelTypeSub2API {
		for _, source := range []string{upstreamRequestIdSourceClientID, upstreamRequestIdSourceGenericID} {
			id := upstreamRequestHeaderID(header, source)
			if id == "" {
				continue
			}
			if id != c.GetString(common.UpstreamRequestIdKey) {
				if c.GetString(common.UpstreamRequestIdKey) == "" {
					c.Set(common.UpstreamRequestIdKey, id)
				}
				appendUpstreamRequestId(c, id)
				recordUpstreamRequestIdSource(c, id, source)
			}
		}
	} else {
		CaptureUpstreamRequestId(c, header)
	}
}

func CloseResponseBodyGracefully(httpResponse *http.Response) {
	if httpResponse == nil || httpResponse.Body == nil {
		return
	}
	err := httpResponse.Body.Close()
	if err != nil {
		common.SysError(common.LogText("failed to close response body: %s", err.Error()))
	}
}

// ShouldCopyUpstreamHeader checks whether a given upstream response header
// should be copied to the client response. It returns false for Content-Length
// (managed separately) and X-Oneapi-Request-Id (to preserve the local instance
// ID). Correlation IDs are collected separately from the full response headers.
func ShouldCopyUpstreamHeader(_ *gin.Context, k string, _ []string) bool {
	return !strings.EqualFold(k, "Content-Length") && !strings.EqualFold(k, common.RequestIdKey)
}

func IOCopyBytesGracefully(c *gin.Context, src *http.Response, data []byte) {
	if c.Writer == nil {
		return
	}

	body := io.NopCloser(bytes.NewBuffer(data))

	// We shouldn't set the header before we parse the response body, because the parse part may fail.
	// And then we will have to send an error response, but in this case, the header has already been set.
	// So the httpClient will be confused by the response.
	// For example, Postman will report error, and we cannot check the response at all.
	if src != nil {
		for k, v := range src.Header {
			if !ShouldCopyUpstreamHeader(c, k, v) {
				continue
			}
			c.Writer.Header().Set(k, v[0])
		}
	}

	// set Content-Length header manually BEFORE calling WriteHeader
	c.Writer.Header().Set("Content-Length", fmt.Sprintf("%d", len(data)))

	// Write header with status code (this sends the headers)
	if src != nil {
		c.Writer.WriteHeader(src.StatusCode)
	} else {
		c.Writer.WriteHeader(http.StatusOK)
	}

	_, err := io.Copy(c.Writer, body)
	if err != nil {
		logger.LogError(c, common.LogText("failed to copy response body: %s", err.Error()))
	}
	c.Writer.Flush()
}
