package controller

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestUpdateTopUpInvoiceRejectsInvalidAction(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodPut, "/api/user/topup/1/invoice", strings.NewReader(`{"action":"invalid"}`))
	context.Request.Header.Set("Content-Type", "application/json")
	context.Params = gin.Params{{Key: "id", Value: "1"}}
	context.Set("id", 7)

	UpdateTopUpInvoice(context)

	var response struct {
		Success bool   `json:"success"`
		Message string `json:"message"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	assert.False(t, response.Success)
	assert.Equal(t, "开票操作无效", response.Message)
}
