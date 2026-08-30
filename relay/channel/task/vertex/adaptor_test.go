package vertex

import (
	"io"
	"testing"

	"github.com/QuantumNous/new-api/common"
	geminitask "github.com/QuantumNous/new-api/relay/channel/task/gemini"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestBuildRequestBodyKeepsVeo31AssetReferences(t *testing.T) {
	c, _ := gin.CreateTestContext(nil)
	c.Set("task_request", relaycommon.TaskSubmitReq{
		Prompt: "keep the reference asset",
		Metadata: map[string]any{
			"referenceImages": []string{"data:image/png;base64,YXNzZXQ="},
			"durationSeconds": 8,
		},
	})

	body, err := (&TaskAdaptor{}).BuildRequestBody(c, &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{}})
	require.NoError(t, err)
	data, err := io.ReadAll(body)
	require.NoError(t, err)

	var payload geminitask.VeoRequestPayload
	require.NoError(t, common.Unmarshal(data, &payload))
	require.Len(t, payload.Instances, 1)
	require.Len(t, payload.Instances[0].ReferenceImages, 1)
	require.Equal(t, "asset", payload.Instances[0].ReferenceImages[0].ReferenceType)
	require.Equal(t, "YXNzZXQ=", payload.Instances[0].ReferenceImages[0].Image.BytesBase64Encoded)
	require.Equal(t, 8, payload.Parameters.DurationSeconds)
}
