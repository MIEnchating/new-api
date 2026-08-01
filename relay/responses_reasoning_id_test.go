package relay

import (
	"testing"

	"github.com/QuantumNous/new-api/constant"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/stretchr/testify/require"
	"github.com/tidwall/gjson"
)

func TestNormalizeSub2APIResponsesReasoningIDs(t *testing.T) {
	info := &relaycommon.RelayInfo{
		RelayMode: relayconstant.RelayModeResponses,
		ChannelMeta: &relaycommon.ChannelMeta{
			ApiType: constant.APITypeSub2API,
			ChannelOtherSettings: dto.ChannelOtherSettings{
				NormalizeResponsesReasoningIDs: true,
			},
		},
	}
	input := []byte(`{
		"model":"gpt-5",
		"vendor_extension":{"keep":true},
		"input":[
			{"type":"reasoning","id":"item_invalid","encrypted_content":"cipher","summary":[]},
			{"type":"reasoning","id":"rs_valid","encrypted_content":"valid"},
			{"type":"message","id":"item_message","role":"user","content":"continue"}
		]
	}`)

	got, removed, err := normalizeSub2APIResponsesReasoningIDs(input, info)
	require.NoError(t, err)
	require.Equal(t, 1, removed)
	require.False(t, gjson.GetBytes(got, "input.0.id").Exists())
	require.Equal(t, "cipher", gjson.GetBytes(got, "input.0.encrypted_content").String())
	require.True(t, gjson.GetBytes(got, "input.0.summary").IsArray())
	require.Equal(t, "rs_valid", gjson.GetBytes(got, "input.1.id").String())
	require.Equal(t, "item_message", gjson.GetBytes(got, "input.2.id").String())
	require.True(t, gjson.GetBytes(got, "vendor_extension.keep").Bool())
}

func TestNormalizeSub2APIResponsesReasoningIDsRespectsScope(t *testing.T) {
	input := []byte(`{"input":[{"type":"reasoning","id":"item_invalid"}]}`)
	tests := []struct {
		name string
		info *relaycommon.RelayInfo
	}{
		{
			name: "disabled",
			info: &relaycommon.RelayInfo{
				RelayMode:   relayconstant.RelayModeResponses,
				ChannelMeta: &relaycommon.ChannelMeta{ApiType: constant.APITypeSub2API},
			},
		},
		{
			name: "compact request",
			info: &relaycommon.RelayInfo{
				RelayMode: relayconstant.RelayModeResponsesCompact,
				ChannelMeta: &relaycommon.ChannelMeta{
					ApiType:              constant.APITypeSub2API,
					ChannelOtherSettings: dto.ChannelOtherSettings{NormalizeResponsesReasoningIDs: true},
				},
			},
		},
		{
			name: "other channel type",
			info: &relaycommon.RelayInfo{
				RelayMode: relayconstant.RelayModeResponses,
				ChannelMeta: &relaycommon.ChannelMeta{
					ApiType:              constant.APITypeOpenAI,
					ChannelOtherSettings: dto.ChannelOtherSettings{NormalizeResponsesReasoningIDs: true},
				},
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, removed, err := normalizeSub2APIResponsesReasoningIDs(input, tt.info)
			require.NoError(t, err)
			require.Zero(t, removed)
			require.Equal(t, input, got)
		})
	}
}
