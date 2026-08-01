package relay

import (
	"bytes"
	"fmt"
	"strings"

	"github.com/QuantumNous/new-api/constant"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/tidwall/gjson"
	"github.com/tidwall/sjson"
)

func shouldNormalizeSub2APIResponsesReasoningIDs(info *relaycommon.RelayInfo) bool {
	return info != nil &&
		info.ChannelMeta != nil &&
		info.ApiType == constant.APITypeSub2API &&
		info.RelayMode == relayconstant.RelayModeResponses &&
		info.ChannelOtherSettings.NormalizeResponsesReasoningIDs
}

func normalizeSub2APIResponsesReasoningIDs(jsonData []byte, info *relaycommon.RelayInfo) ([]byte, int, error) {
	if !shouldNormalizeSub2APIResponsesReasoningIDs(info) {
		return jsonData, 0, nil
	}

	input := gjson.GetBytes(jsonData, "input")
	if !input.IsArray() {
		return jsonData, 0, nil
	}

	result := jsonData
	removed := 0
	for index, item := range input.Array() {
		if item.Get("type").String() != "reasoning" {
			continue
		}
		id := item.Get("id")
		if !id.Exists() || strings.HasPrefix(id.String(), "rs_") {
			continue
		}

		if removed == 0 {
			result = bytes.Clone(jsonData)
		}
		var err error
		result, err = sjson.DeleteBytes(result, fmt.Sprintf("input.%d.id", index))
		if err != nil {
			return jsonData, 0, fmt.Errorf("remove incompatible reasoning item id: %w", err)
		}
		removed++
	}

	return result, removed, nil
}
