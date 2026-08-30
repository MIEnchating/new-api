package gemini

import (
	"io"
	"testing"

	"github.com/QuantumNous/new-api/common"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestBuildRequestBodyMapsVeo31FrameInputs(t *testing.T) {
	c, _ := gin.CreateTestContext(nil)
	c.Set("task_request", relaycommon.TaskSubmitReq{
		Prompt: "interpolate the frames",
		Metadata: map[string]any{
			"firstFrame":      "data:image/png;base64,Zmlyc3Q=",
			"lastFrame":       "data:image/jpeg;base64,bGFzdA==",
			"aspectRatio":     "16:9",
			"durationSeconds": 8,
			"resolution":      "1080p",
		},
	})

	body, err := (&TaskAdaptor{}).BuildRequestBody(c, &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{}})
	require.NoError(t, err)
	data, err := io.ReadAll(body)
	require.NoError(t, err)

	var payload VeoRequestPayload
	require.NoError(t, common.Unmarshal(data, &payload))
	require.Len(t, payload.Instances, 1)
	require.Equal(t, "Zmlyc3Q=", payload.Instances[0].Image.BytesBase64Encoded)
	require.Equal(t, "image/png", payload.Instances[0].Image.MimeType)
	require.Equal(t, "bGFzdA==", payload.Instances[0].LastFrame.BytesBase64Encoded)
	require.Equal(t, "image/jpeg", payload.Instances[0].LastFrame.MimeType)
	require.Empty(t, payload.Instances[0].ReferenceImages)
	require.Equal(t, 8, payload.Parameters.DurationSeconds)
	require.Equal(t, "1080p", payload.Parameters.Resolution)
}

func TestBuildRequestBodyMapsVeo31AssetReferences(t *testing.T) {
	c, _ := gin.CreateTestContext(nil)
	c.Set("task_request", relaycommon.TaskSubmitReq{
		Prompt: "keep the referenced products",
		Metadata: map[string]any{
			"referenceImages": []string{
				"data:image/png;base64,b25l",
				"data:image/webp;base64,dHdv",
			},
		},
	})

	body, err := (&TaskAdaptor{}).BuildRequestBody(c, &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{}})
	require.NoError(t, err)
	data, err := io.ReadAll(body)
	require.NoError(t, err)

	var payload VeoRequestPayload
	require.NoError(t, common.Unmarshal(data, &payload))
	require.Len(t, payload.Instances, 1)
	require.Nil(t, payload.Instances[0].Image)
	require.Nil(t, payload.Instances[0].LastFrame)
	require.Len(t, payload.Instances[0].ReferenceImages, 2)
	require.Equal(t, "asset", payload.Instances[0].ReferenceImages[0].ReferenceType)
	require.Equal(t, "b25l", payload.Instances[0].ReferenceImages[0].Image.BytesBase64Encoded)
	require.Equal(t, "asset", payload.Instances[0].ReferenceImages[1].ReferenceType)
	require.Equal(t, "dHdv", payload.Instances[0].ReferenceImages[1].Image.BytesBase64Encoded)
}

func TestBuildRequestBodyRejectsMixedVeo31InputRoles(t *testing.T) {
	c, _ := gin.CreateTestContext(nil)
	c.Set("task_request", relaycommon.TaskSubmitReq{
		Prompt: "invalid mixed inputs",
		Metadata: map[string]any{
			"firstFrame":      "data:image/png;base64,Zmlyc3Q=",
			"referenceImages": []string{"data:image/png;base64,b25l"},
		},
	})

	_, err := (&TaskAdaptor{}).BuildRequestBody(c, &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{}})
	require.EqualError(t, err, "Veo frame inputs cannot be combined with referenceImages")
}
