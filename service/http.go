package service

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"

	"github.com/gin-gonic/gin"
)

const providerRequestIdHeader = "X-Request-Id"

func appendUpstreamRequestId(c *gin.Context, requestId string) {
	requestId = strings.TrimSpace(requestId)
	if requestId == "" {
		return
	}
	requestIds := c.GetStringSlice(common.UpstreamRequestIdsKey)
	for _, existing := range requestIds {
		if existing == requestId {
			return
		}
	}
	c.Set(common.UpstreamRequestIdsKey, append(requestIds, requestId))
}

// CaptureUpstreamRequestId records the best available upstream correlation ID.
// Native new-api IDs take precedence; X-Request-Id supports providers such as
// sub2api and is used only as a fallback.
func CaptureUpstreamRequestId(c *gin.Context, header http.Header) string {
	if c == nil {
		return ""
	}
	if requestId := strings.TrimSpace(header.Get(common.RequestIdKey)); requestId != "" {
		c.Set(common.UpstreamRequestIdKey, requestId)
		appendUpstreamRequestId(c, requestId)
		return requestId
	}
	requestId := strings.TrimSpace(header.Get(providerRequestIdHeader))
	if requestId != "" {
		c.Set(common.UpstreamRequestIdKey, requestId)
		appendUpstreamRequestId(c, requestId)
	}
	return requestId
}

func CloseResponseBodyGracefully(httpResponse *http.Response) {
	if httpResponse == nil || httpResponse.Body == nil {
		return
	}
	err := httpResponse.Body.Close()
	if err != nil {
		common.SysError("failed to close response body: " + err.Error())
	}
}

// ShouldCopyUpstreamHeader checks whether a given upstream response header
// should be copied to the client response. It returns false for Content-Length
// (managed separately) and X-Oneapi-Request-Id (to preserve the local instance
// ID). X-Oneapi-Request-Id and the X-Request-Id fallback are captured into the
// Gin context for later logging.
func ShouldCopyUpstreamHeader(c *gin.Context, k string, v []string) bool {
	if strings.EqualFold(k, "Content-Length") {
		return false
	}
	if strings.EqualFold(k, common.RequestIdKey) {
		if len(v) > 0 {
			CaptureUpstreamRequestId(c, http.Header{common.RequestIdKey: v})
		}
		return false
	}
	if strings.EqualFold(k, providerRequestIdHeader) && len(v) > 0 {
		if c != nil && strings.TrimSpace(c.GetString(common.UpstreamRequestIdKey)) == "" {
			CaptureUpstreamRequestId(c, http.Header{providerRequestIdHeader: v})
		}
	}
	return true
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
		logger.LogError(c, fmt.Sprintf("failed to copy response body: %s", err.Error()))
	}
	c.Writer.Flush()
}
