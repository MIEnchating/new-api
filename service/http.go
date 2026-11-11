package service

import (
	"bytes"
	"fmt"
	"io"
	"maps"
	"net/http"
	"slices"
	"strconv"
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

// BeginUpstreamRequestAttempt records even attempts that never receive headers.
// Its returned index belongs to this outbound request, independent of route retries.
func BeginUpstreamRequestAttempt(c *gin.Context, channelID, channelType int) int {
	c.Set(common.UpstreamRequestIdKey, "")
	value, _ := c.Get(common.UpstreamRequestChainKey)
	chain, _ := value.([]common.UpstreamRequestAttempt)
	kind := strconv.Itoa(channelType)
	if channelType == constant.ChannelTypeSub2API {
		kind = "sub2api"
	}
	attempt := common.UpstreamRequestAttempt{Attempt: len(chain) + 1, ChannelID: channelID, ChannelType: kind, Nodes: []common.UpstreamRequestNode{}}
	c.Set(common.UpstreamRequestChainKey, append(slices.Clone(chain), attempt))
	return len(chain)
}

// CaptureUpstreamRequestChain keeps Sub2API's client correlation and downstream
// response IDs together. Other channels retain their existing primary-ID policy.
func CaptureUpstreamRequestChain(c *gin.Context, header http.Header, attemptIndex int) {
	value, _ := c.Get(common.UpstreamRequestChainKey)
	chain, _ := value.([]common.UpstreamRequestAttempt)
	if attemptIndex < 0 || attemptIndex >= len(chain) {
		return
	}
	chain = slices.Clone(chain)
	attempt := &chain[attemptIndex]
	nodes := make([]common.UpstreamRequestNode, 0, 2)
	c.Set(common.UpstreamRequestIdKey, "")
	if attempt.ChannelType == "sub2api" {
		for _, source := range []string{upstreamRequestIdSourceClientID, upstreamRequestIdSourceGenericID} {
			id := upstreamRequestHeaderID(header, source)
			if id == "" || slices.ContainsFunc(nodes, func(node common.UpstreamRequestNode) bool { return node.ID == id }) {
				continue
			}
			node := common.UpstreamRequestNode{ID: id, Source: source, Service: "upstream", Role: "upstream_request"}
			if source == upstreamRequestIdSourceClientID {
				node.Service, node.Role = "sub2api", "client_correlation"
			} else if len(nodes) > 0 {
				node.Service, node.Role = "sub2api-upstream", "provider_request"
			}
			if len(nodes) == 0 {
				c.Set(common.UpstreamRequestIdKey, id)
			}
			nodes = append(nodes, node)
			appendUpstreamRequestId(c, id)
			recordUpstreamRequestIdSource(c, id, source)
		}
	} else if id := CaptureUpstreamRequestId(c, header); id != "" {
		for _, source := range []string{upstreamRequestIdSourceOneAPI, upstreamRequestIdSourceGenericID, upstreamRequestIdSourceClientID} {
			if upstreamRequestHeaderID(header, source) == id {
				nodes = append(nodes, common.UpstreamRequestNode{ID: id, Source: source, Service: "upstream", Role: "upstream_request"})
				break
			}
		}
	}
	attempt.Nodes = nodes
	c.Set(common.UpstreamRequestChainKey, chain)
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
