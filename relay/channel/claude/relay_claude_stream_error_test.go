package claude

import (
	"net/http"
	"net/http/httptest"
	"testing"

	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/types"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestHandleStreamResponseDataMarksClaudeErrorEvent(t *testing.T) {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/messages", nil)
	info := &relaycommon.RelayInfo{RelayFormat: types.RelayFormatClaude}
	claudeInfo := &ClaudeResponseInfo{}

	apiErr := HandleStreamResponseData(
		c,
		info,
		claudeInfo,
		`{"type":"error","error":{"type":"overloaded_error","message":"upstream overloaded"}}`,
	)

	require.NotNil(t, apiErr)
	assert.Equal(t, http.StatusBadGateway, apiErr.StatusCode)
	assert.Equal(t, "upstream overloaded", apiErr.Error())
	assert.True(t, types.IsStreamEventError(apiErr))
}
