package helper

import (
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/dto"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
)

func TestClaudePingDoesNotMarkBusinessOutputStarted(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)

	ClaudeChunkData(ctx, dto.ClaudeResponse{Type: "ping"}, `{"type":"ping"}`)

	assert.False(t, StreamOutputStarted(ctx))
	assert.Contains(t, recorder.Body.String(), `"type":"ping"`)
}

func TestClaudeBusinessEventMarksOutputStarted(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)

	ClaudeChunkData(ctx, dto.ClaudeResponse{Type: "message_start"}, `{"type":"message_start"}`)

	assert.True(t, StreamOutputStarted(ctx))
}
