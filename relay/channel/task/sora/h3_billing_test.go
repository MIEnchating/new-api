package sora

import (
	"net/http/httptest"
	"testing"

	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
)

func TestEstimateBillingUsesH3DefaultDuration(t *testing.T) {
	tests := []struct {
		name        string
		model       string
		request     relaycommon.TaskSubmitReq
		wantSeconds float64
	}{
		{
			name:        "base H3 defaults to five seconds",
			model:       "minimax-h3-768p",
			wantSeconds: 5,
		},
		{
			name:        "enhanced H3 defaults to five seconds",
			model:       "minimax-h3-768p-enhanced",
			wantSeconds: 5,
		},
		{
			name:        "explicit H3 duration is preserved",
			model:       "minimax-h3-768p",
			request:     relaycommon.TaskSubmitReq{Duration: 8},
			wantSeconds: 8,
		},
		{
			name:        "other Sora models keep the existing default",
			model:       "sora-2",
			wantSeconds: 4,
		},
	}

	adaptor := &TaskAdaptor{}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			context, _ := gin.CreateTestContext(httptest.NewRecorder())
			context.Set("task_request", tt.request)
			info := &relaycommon.RelayInfo{
				ChannelMeta:   &relaycommon.ChannelMeta{UpstreamModelName: tt.model},
				TaskRelayInfo: &relaycommon.TaskRelayInfo{},
			}

			ratios := adaptor.EstimateBilling(context, info)
			assert.Equal(t, tt.wantSeconds, ratios["seconds"])
		})
	}
}
