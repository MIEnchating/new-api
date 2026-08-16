package controller

import (
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestBillingCompatibilityEndpointsHandleMissingToken(t *testing.T) {
	previousDisplayTokenStatEnabled := common.DisplayTokenStatEnabled
	common.DisplayTokenStatEnabled = true
	t.Cleanup(func() {
		common.DisplayTokenStatEnabled = previousDisplayTokenStatEnabled
	})

	tests := []struct {
		name    string
		handler gin.HandlerFunc
	}{
		{name: "subscription", handler: GetSubscription},
		{name: "usage", handler: GetUsage},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			ctx, _ := gin.CreateTestContext(recorder)

			require.NotPanics(t, func() {
				test.handler(ctx)
			})

			var response struct {
				Error struct {
					Message string `json:"message"`
				} `json:"error"`
			}
			require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
			require.NotEmpty(t, response.Error.Message)
		})
	}
}
