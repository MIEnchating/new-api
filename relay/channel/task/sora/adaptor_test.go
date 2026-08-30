package sora

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSoraAdaptorBuildsKIEVideoTaskContract(t *testing.T) {
	payload := []byte(`{"model":"wan/2-7-videoedit","prompt":"edit it","duration":10,"size":"16:9","resolution":"1080p","video_url":"https://cdn.example.com/source.mp4","reference_image":"https://cdn.example.com/style.png"}`)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/videos", bytes.NewReader(payload))
	c.Request.Header.Set("Content-Type", "application/json")
	defer common.CleanupBodyStorage(c)
	info := &relaycommon.RelayInfo{
		ChannelMeta:   &relaycommon.ChannelMeta{ChannelBaseUrl: "https://api.kie.ai", UpstreamModelName: "wan/2-7-videoedit"},
		TaskRelayInfo: &relaycommon.TaskRelayInfo{Action: "kie-video:wan/2-7-videoedit"},
	}
	adaptor := &TaskAdaptor{baseURL: info.ChannelBaseUrl}
	requestURL, err := adaptor.BuildRequestURL(info)
	require.NoError(t, err)
	assert.Equal(t, "https://api.kie.ai/v1/jobs/createTask", requestURL)
	body, err := adaptor.BuildRequestBody(c, info)
	require.NoError(t, err)
	encoded, err := io.ReadAll(body)
	require.NoError(t, err)
	var got map[string]any
	require.NoError(t, json.Unmarshal(encoded, &got))
	assert.Equal(t, "wan/2-7-videoedit", got["model"])
	input := got["input"].(map[string]any)
	assert.Equal(t, "https://cdn.example.com/source.mp4", input["video_url"])
	assert.Equal(t, "https://cdn.example.com/style.png", input["reference_image"])
	assert.EqualValues(t, 10, input["duration"])
	assert.Equal(t, "16:9", input["aspect_ratio"])
}

func TestKIEVideoModelContractMatrix(t *testing.T) {
	tests := map[string]kieVideoContract{
		"bytedance/seedance-1.5-pro":           {aspect: "aspect_ratio", duration: "number", resolution: "resolution", image: "input_urls"},
		"bytedance/seedance-2":                 {aspect: "aspect_ratio", duration: "number", resolution: "resolution", image: "reference_image_urls", video: "reference_video_urls", audio: "reference_audio_urls"},
		"bytedance/seedance-2-fast":            {aspect: "aspect_ratio", duration: "number", resolution: "resolution", image: "reference_image_urls", video: "reference_video_urls", audio: "reference_audio_urls"},
		"bytedance/seedance-2-mini":            {aspect: "aspect_ratio", duration: "number", resolution: "resolution", image: "reference_image_urls", video: "reference_video_urls", audio: "reference_audio_urls"},
		"bytedance/seedance-2-5":               {aspect: "aspect_ratio", duration: "number", resolution: "resolution", image: "reference_image_urls", video: "reference_video_urls", audio: "reference_audio_urls", min: 4, max: 30},
		"bytedance/v1-lite-image-to-video":     {duration: "string", resolution: "resolution", image: "image_url"},
		"bytedance/v1-lite-text-to-video":      {aspect: "aspect_ratio", duration: "string", resolution: "resolution"},
		"bytedance/v1-pro-fast-image-to-video": {duration: "string", resolution: "resolution", image: "image_url"},
		"bytedance/v1-pro-image-to-video":      {duration: "string", resolution: "resolution", image: "image_url"},
		"bytedance/v1-pro-text-to-video":       {aspect: "aspect_ratio", duration: "string", resolution: "resolution"},
		"gemini-omni-video":                    {aspect: "aspect_ratio", duration: "string", resolution: "resolution", image: "image_urls", video: "video_list", audio: "audio_ids"},
		"grok-imagine/image-to-video":          {aspect: "aspect_ratio", duration: "string", resolution: "resolution", image: "image_urls", min: 6, max: 30},
		"grok-imagine/text-to-video":           {aspect: "aspect_ratio", duration: "string", resolution: "resolution", min: 6, max: 30},
		"grok-imagine-video-1-5-preview":       {aspect: "aspect_ratio", duration: "number", resolution: "resolution", image: "image_urls"},
		"happyhorse/image-to-video":            {duration: "number", resolution: "resolution", image: "image_urls"},
		"happyhorse/reference-to-video":        {aspect: "aspect_ratio", duration: "number", resolution: "resolution", image: "reference_image", imageArray: true},
		"happyhorse/text-to-video":             {aspect: "aspect_ratio", duration: "number", resolution: "resolution"},
		"happyhorse/video-edit":                {resolution: "resolution", image: "reference_image", video: "video_url", imageArray: true},
		"happyhorse-1-1/text-to-video":         {aspect: "aspect_ratio", duration: "number", resolution: "resolution"},
		"happyhorse-1-1/image-to-video":        {duration: "number", resolution: "resolution", image: "image_urls"},
		"happyhorse-1-1/reference-to-video":    {aspect: "aspect_ratio", duration: "number", resolution: "resolution", image: "reference_image", imageArray: true},
		"minimax-h3/text-to-video":             {aspect: "aspect_ratio", duration: "number", resolution: "resolution", min: 4, max: 15},
		"minimax-h3/image-to-video":            {duration: "number", resolution: "resolution", image: "first_frame_url", min: 4, max: 15},
		"minimax-h3/reference-to-video":        {aspect: "aspect_ratio", duration: "number", resolution: "resolution", image: "reference_image_urls", video: "reference_video_urls", audio: "reference_audio_urls", min: 4, max: 15},
		"hailuo/02-image-to-video-standard":    {duration: "string", resolution: "resolution", image: "image_url"},
		"hailuo/02-image-to-video-pro":         {duration: "string", resolution: "resolution", image: "image_url"},
		"hailuo/02-text-to-video-standard":     {duration: "string"},
		"hailuo/02-text-to-video-pro":          {duration: "string"},
		"hailuo/2-3-image-to-video-pro":        {duration: "string", resolution: "resolution", image: "image_url"},
		"hailuo/2-3-image-to-video-standard":   {duration: "string", resolution: "resolution", image: "image_url"},
		"kling-2.6/image-to-video":             {duration: "string", image: "image_urls"},
		"kling-2.6/text-to-video":              {aspect: "aspect_ratio", duration: "string"},
		"kling-2.6/motion-control":             {duration: "string", image: "input_urls", video: "video_urls"},
		"kling-3.0/motion-control":             {duration: "string", image: "input_urls", video: "video_urls"},
		"kling-3.0/video":                      {aspect: "aspect_ratio", duration: "string", image: "image_urls"},
		"kling-3.0-omni/text-to-video":         {aspect: "aspect_ratio", duration: "number", resolution: "resolution", min: 3, max: 15},
		"kling-3.0-omni/image-to-video":        {aspect: "aspect_ratio", duration: "number", resolution: "resolution", image: "image_urls", min: 3, max: 15},
		"kling-3.0-omni/reference-to-video":    {aspect: "aspect_ratio", duration: "number", resolution: "resolution", image: "image_urls", video: "video_urls", min: 3, max: 15},
		"kling-3.0-omni/transformation":        {aspect: "aspect_ratio", duration: "number", resolution: "resolution", image: "image_urls", video: "video_urls", min: 3, max: 15},
		"kling/v3-turbo-text-to-video":         {aspect: "aspect_ratio", duration: "string", resolution: "resolution"},
		"kling/v3-turbo-image-to-video":        {duration: "string", resolution: "resolution", image: "image_urls"},
		"kling/ai-avatar-standard":             {image: "image_url", audio: "audio_url"},
		"kling/ai-avatar-pro":                  {image: "image_url", audio: "audio_url"},
		"kling/v2-1-master-image-to-video":     {duration: "string", image: "image_url"},
		"kling/v2-1-master-text-to-video":      {aspect: "aspect_ratio", duration: "string"},
		"kling/v2-1-pro":                       {duration: "string", image: "image_url"},
		"kling/v2-1-standard":                  {duration: "string", image: "image_url"},
		"kling/v2-5-turbo-image-to-video-pro":  {duration: "string", image: "image_url"},
		"kling/v2-5-turbo-text-to-video-pro":   {aspect: "aspect_ratio", duration: "string"},
		"wan/2-2-a14b-image-to-video-turbo":    {resolution: "resolution", image: "image_url"},
		"wan/2-2-a14b-speech-to-video-turbo":   {resolution: "resolution", image: "image_url", audio: "audio_url"},
		"wan/2-2-a14b-text-to-video-turbo":     {aspect: "aspect_ratio", resolution: "resolution"},
		"wan/2-2-animate-move":                 {resolution: "resolution", image: "image_url", video: "video_url"},
		"wan/2-2-animate-replace":              {resolution: "resolution", image: "image_url", video: "video_url"},
		"wan/2-5-image-to-video":               {duration: "string", resolution: "resolution", image: "image_url"},
		"wan/2-5-text-to-video":                {aspect: "aspect_ratio", duration: "string", resolution: "resolution"},
		"wan/2-6-flash-image-to-video":         {duration: "string", resolution: "resolution", image: "image_urls"},
		"wan/2-6-flash-video-to-video":         {duration: "string", resolution: "resolution", video: "video_urls"},
		"wan/2-6-image-to-video":               {duration: "string", resolution: "resolution", image: "image_urls"},
		"wan/2-6-text-to-video":                {duration: "string", resolution: "resolution"},
		"wan/2-6-video-to-video":               {duration: "string", resolution: "resolution", video: "video_urls"},
		"wan/2-7-image-to-video":               {duration: "number", resolution: "resolution", image: "first_frame_url", video: "first_clip_url", audio: "driving_audio_url"},
		"wan/2-7-r2v":                          {aspect: "aspect_ratio", duration: "number", resolution: "resolution", image: "reference_image", video: "reference_video", audio: "reference_voice", imageArray: true, videoArray: true},
		"wan/2-7-text-to-video":                {aspect: "ratio", duration: "number", resolution: "resolution", audio: "audio_url"},
		"wan/2-7-videoedit":                    {aspect: "aspect_ratio", duration: "number", resolution: "resolution", image: "reference_image", video: "video_url"},
		"topaz/video-upscale":                  {video: "video_url"},
		"infinitalk/from-audio":                {resolution: "resolution", image: "image_url", audio: "audio_url"},
	}
	for model, want := range tests {
		assert.Equal(t, want, kieVideoModelContract(model), model)
	}
}

func TestSoraAdaptorUsesKIEModelSpecificDurationTypes(t *testing.T) {
	tests := []struct {
		model, body string
		want        any
	}{
		{model: "kling/v2-1-pro", body: `{"prompt":"animate","seconds":5,"image_url":"https://cdn.example.com/frame.png"}`, want: "5"},
		{model: "wan/2-7-videoedit", body: `{"prompt":"animate","seconds":5,"video_url":"https://cdn.example.com/source.mp4"}`, want: float64(5)},
		{model: "minimax-h3/reference-to-video", body: `{"prompt":"animate","seconds":5}`, want: float64(5)},
		{model: "hailuo/02-image-to-video-standard", body: `{"prompt":"animate","seconds":5,"image_url":"https://cdn.example.com/frame.png"}`, want: "5"},
	}
	for _, test := range tests {
		body, err := buildKIEVideoRequestBody([]byte(test.body), test.model)
		require.NoError(t, err)
		var payload map[string]any
		require.NoError(t, json.Unmarshal(body, &payload))
		input := payload["input"].(map[string]any)
		assert.Equal(t, test.want, input["duration"], test.model)
	}
}

func TestSoraAdaptorNormalizesReferenceProjectVideoContracts(t *testing.T) {
	tests := []struct {
		name, model, body, field string
		want                     any
	}{
		{"h3 adaptive ratio", "minimax-h3/text-to-video", `{"prompt":"x","size":"adaptive","seconds":2,"resolution":"720p"}`, "aspect_ratio", "auto"},
		{"h3 first frame", "minimax-h3/image-to-video", `{"prompt":"x","seconds":8,"resolution":"768p","image_url":"https://cdn.example.com/a.png"}`, "first_frame_url", "https://cdn.example.com/a.png"},
		{"seedance references", "bytedance/seedance-2", `{"prompt":"x","seconds":"5","reference_image_urls":["https://cdn.example.com/a.png"],"reference_video_urls":["https://cdn.example.com/a.mp4"],"reference_audio_urls":["https://cdn.example.com/a.mp3"]}`, "reference_video_urls", []any{"https://cdn.example.com/a.mp4"}},
		{"wan video edit", "wan/2-7-videoedit", `{"prompt":"x","seconds":5,"size":"16:9","video_url":"https://cdn.example.com/a.mp4","reference_image":"https://cdn.example.com/a.png"}`, "video_url", "https://cdn.example.com/a.mp4"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			body, err := buildKIEVideoRequestBody([]byte(tt.body), tt.model)
			require.NoError(t, err)
			var envelope map[string]any
			require.NoError(t, json.Unmarshal(body, &envelope))
			input := envelope["input"].(map[string]any)
			assert.Equal(t, tt.want, input[tt.field])
		})
	}
}

func TestSoraAdaptorOmitsKIEKlingMotionQuality(t *testing.T) {
	body, err := buildKIEVideoRequestBody([]byte(`{"prompt":"move","resolution":"1080p","mode":"pro","input_urls":["https://cdn.example.com/character.png"],"video_urls":["https://cdn.example.com/motion.mp4"]}`), "kling-3.0/motion-control")
	require.NoError(t, err)
	var envelope map[string]any
	require.NoError(t, json.Unmarshal(body, &envelope))
	input := envelope["input"].(map[string]any)
	assert.NotContains(t, input, "resolution")
	assert.NotContains(t, input, "mode")
}

func TestSoraAdaptorPreservesKIEFirstAndLastFrames(t *testing.T) {
	tests := []struct {
		model, body, firstField, lastField string
	}{
		{"bytedance/seedance-2", `{"prompt":"x","first_frame_url":"https://cdn.example.com/first.png","last_frame_url":"https://cdn.example.com/last.png"}`, "first_frame_url", "last_frame_url"},
		{"wan/2-7-image-to-video", `{"prompt":"x","image_urls":["https://cdn.example.com/first.png","https://cdn.example.com/last.png"]}`, "first_frame_url", "last_frame_url"},
		{"minimax-h3/image-to-video", `{"prompt":"x","image_urls":["https://cdn.example.com/first.png","https://cdn.example.com/last.png"]}`, "first_frame_url", "last_frame_url"},
		{"hailuo/02-image-to-video-standard", `{"prompt":"x","image_urls":["https://cdn.example.com/first.png","https://cdn.example.com/last.png"]}`, "image_url", "end_image_url"},
		{"kling/v2-1-pro", `{"prompt":"x","image_urls":["https://cdn.example.com/first.png","https://cdn.example.com/last.png"]}`, "image_url", "tail_image_url"},
	}
	for _, tt := range tests {
		t.Run(tt.model, func(t *testing.T) {
			body, err := buildKIEVideoRequestBody([]byte(tt.body), tt.model)
			require.NoError(t, err)
			var envelope map[string]any
			require.NoError(t, json.Unmarshal(body, &envelope))
			input := envelope["input"].(map[string]any)
			assert.Equal(t, "https://cdn.example.com/first.png", input[tt.firstField])
			assert.Equal(t, "https://cdn.example.com/last.png", input[tt.lastField])
		})
	}
}

func TestSoraAdaptorDropsAspectForH3ImageToVideo(t *testing.T) {
	body, err := buildKIEVideoRequestBody([]byte(`{"prompt":"x","size":"16:9","image_url":"https://cdn.example.com/frame.png"}`), "minimax-h3/image-to-video")
	require.NoError(t, err)
	var envelope map[string]any
	require.NoError(t, json.Unmarshal(body, &envelope))
	input := envelope["input"].(map[string]any)
	assert.NotContains(t, input, "aspect_ratio")
	assert.NotContains(t, input, "ratio")
}

func TestSoraAdaptorRoutesGenericKIEReferencesByMediaType(t *testing.T) {
	tests := []struct {
		name, model, value, field string
		want                      any
	}{
		{"video", "wan/2-7-image-to-video", "https://cdn.example.com/source.mp4?token=x", "first_clip_url", "https://cdn.example.com/source.mp4?token=x"},
		{"audio", "wan/2-7-image-to-video", "https://cdn.example.com/voice.mp3?token=x", "driving_audio_url", "https://cdn.example.com/voice.mp3?token=x"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			body, err := buildKIEVideoRequestBody([]byte(`{"prompt":"x","first_frame_url":"https://cdn.example.com/frame.png","input_reference[]":"`+tt.value+`"}`), tt.model)
			require.NoError(t, err)
			var envelope map[string]any
			require.NoError(t, json.Unmarshal(body, &envelope))
			input := envelope["input"].(map[string]any)
			assert.Equal(t, tt.want, input[tt.field])
		})
	}
}

func TestSoraAdaptorKeepsKIESingleArrayAndScalarShapes(t *testing.T) {
	body, err := buildKIEVideoRequestBody([]byte(`{"prompt":"x","image_urls":["https://cdn.example.com/one.png","https://cdn.example.com/two.png"]}`), "happyhorse-1-1/image-to-video")
	require.NoError(t, err)
	var envelope map[string]any
	require.NoError(t, json.Unmarshal(body, &envelope))
	input := envelope["input"].(map[string]any)
	assert.Equal(t, []any{"https://cdn.example.com/one.png"}, input["image_urls"])

	body, err = buildKIEVideoRequestBody([]byte(`{"prompt":"x","video_url":"https://cdn.example.com/source.mp4","reference_image":["https://cdn.example.com/one.png","https://cdn.example.com/two.png"]}`), "wan/2-7-videoedit")
	require.NoError(t, err)
	require.NoError(t, json.Unmarshal(body, &envelope))
	input = envelope["input"].(map[string]any)
	assert.Equal(t, "https://cdn.example.com/one.png", input["reference_image"])
}

func TestSoraAdaptorRequiresKIEModelMedia(t *testing.T) {
	_, err := buildKIEVideoRequestBody([]byte(`{"prompt":"x"}`), "kling/v2-1-pro")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "image")
}

func TestSoraAdaptorRejectsGeminiOmniURLAudioIDs(t *testing.T) {
	_, err := buildKIEVideoRequestBody([]byte(`{"model":"gemini-omni-video","prompt":"x","audio_ids":["https://cdn.example.com/a.mp3"]}`), "gemini-omni-video")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "audio_")
}

func TestSoraAdaptorForwardsKIEGrokMode(t *testing.T) {
	body, err := buildKIEVideoRequestBody([]byte(`{"model":"grok-imagine/text-to-video","prompt":"animate","seconds":30,"size":"16:9","resolution":"1080p","metadata":{"mode":"spicy"}}`), "grok-imagine/text-to-video")
	require.NoError(t, err)
	var payload map[string]any
	require.NoError(t, json.Unmarshal(body, &payload))
	input := payload["input"].(map[string]any)
	assert.Equal(t, "30", input["duration"])
	assert.Equal(t, "spicy", input["mode"])
	assert.Equal(t, "16:9", input["aspect_ratio"])
	assert.Equal(t, "1080p", input["resolution"])
}

func TestSoraAdaptorResolvesKIEGrokAliasesByImageInput(t *testing.T) {
	aliases := []string{"grok-imagine-1.5-video", "grok-imagine-1.5-preview", "grok-imagine/grok-imagine-1.5-preview"}
	for _, alias := range aliases {
		body, err := buildKIEVideoRequestBody([]byte(`{"prompt":"animate"}`), alias)
		require.NoError(t, err)
		var envelope map[string]any
		require.NoError(t, json.Unmarshal(body, &envelope))
		assert.Equal(t, "grok-imagine-video-1-5-preview", envelope["model"])
	}

	body, err := buildKIEVideoRequestBody([]byte(`{"prompt":"animate","video_url":"https://cdn.example.com/source.mp4"}`), "grok-imagine-video")
	require.NoError(t, err)
	var envelope map[string]any
	require.NoError(t, json.Unmarshal(body, &envelope))
	assert.Equal(t, "grok-imagine/text-to-video", envelope["model"])

	body, err = buildKIEVideoRequestBody([]byte(`{"prompt":"animate","input":{"image_url":"https://cdn.example.com/frame.png"}}`), "grok-imagine-video")
	require.NoError(t, err)
	require.NoError(t, json.Unmarshal(body, &envelope))
	assert.Equal(t, "grok-imagine/image-to-video", envelope["model"])
}

func TestSoraAdaptorDropsCompatibilityAliases(t *testing.T) {
	body, err := buildKIEVideoRequestBody([]byte(`{"model":"grok-imagine/text-to-video","prompt":"animate","seconds":6,"size":"16:9","quality":"1080p","preset":"spicy"}`), "grok-imagine/text-to-video")
	require.NoError(t, err)
	var envelope map[string]any
	require.NoError(t, json.Unmarshal(body, &envelope))
	input := envelope["input"].(map[string]any)
	assert.Equal(t, "spicy", input["mode"])
	assert.NotContains(t, input, "size")
	assert.NotContains(t, input, "quality")
	assert.NotContains(t, input, "preset")
}

func TestSoraAdaptorNormalizesKlingAdvancedVideoControls(t *testing.T) {
	body, err := buildKIEVideoRequestBody([]byte(`{"model":"kling-3.0/video","prompt":"shot","seconds":5,"size":"16:9","resolution":"1080p","preset":"pro","multi_shot":true,"shot_type":"customize","multi_prompt":[{"prompt":"one","duration":"2"}],"element_list":[{"name":"hero","references":[{"kind":"image","url":"https://cdn.example.com/hero.png"}]}],"negative_prompt":"blur"}`), "kling-3.0/video")
	require.NoError(t, err)
	var envelope map[string]any
	require.NoError(t, json.Unmarshal(body, &envelope))
	input := envelope["input"].(map[string]any)
	assert.Equal(t, "pro", input["mode"])
	assert.Equal(t, true, input["multi_shots"])
	assert.NotContains(t, input, "multi_shot")
	assert.NotContains(t, input, "negative_prompt")
	assert.NotContains(t, input, "element_list")
	assert.Contains(t, input, "kling_elements")
}

func TestSoraAdaptorNormalizesKlingOmniVariants(t *testing.T) {
	body, err := buildKIEVideoRequestBody([]byte(`{"model":"kling-3.0-omni/reference-to-video","prompt":"style","duration":8,"resolution":"pro","multi_shot":true,"shot_type":"customize","image_urls":["https://cdn.example.com/ref.png"],"video_urls":["https://cdn.example.com/source.mp4"]}`), "kling-3.0-omni/reference-to-video")
	require.NoError(t, err)
	var envelope map[string]any
	require.NoError(t, json.Unmarshal(body, &envelope))
	input := envelope["input"].(map[string]any)
	assert.Equal(t, "1080p", input["resolution"])
	assert.Equal(t, "auto", input["aspect_ratio"])
	assert.Equal(t, false, input["audio"])
	assert.Equal(t, true, input["customize_multi_shots"])
	assert.NotContains(t, input, "multi_shot")
}

func TestSoraAdaptorDropsUnsupportedKIEUtilityControls(t *testing.T) {
	tests := []struct{ model, body string }{
		{"topaz/video-upscale", `{"video_url":"https://cdn.example.com/source.mp4","seconds":5,"size":"16:9","resolution":"1080p"}`},
		{"kling/ai-avatar-pro", `{"image_url":"https://cdn.example.com/avatar.png","audio_url":"https://cdn.example.com/voice.mp3","seconds":5,"size":"16:9","resolution":"1080p"}`},
		{"kling-2.6/motion-control", `{"input_urls":["https://cdn.example.com/avatar.png"],"video_urls":["https://cdn.example.com/source.mp4"],"seconds":5,"size":"16:9","resolution":"1080p"}`},
	}
	for _, tt := range tests {
		body, err := buildKIEVideoRequestBody([]byte(tt.body), tt.model)
		require.NoError(t, err)
		var payload map[string]any
		require.NoError(t, json.Unmarshal(body, &payload))
		input := payload["input"].(map[string]any)
		assert.NotContains(t, input, "duration", tt.model)
		assert.NotContains(t, input, "resolution", tt.model)
		assert.NotContains(t, input, "aspect_ratio", tt.model)
	}
}

func TestSoraAdaptorKeepsGrokImageToVideoAspectRatio(t *testing.T) {
	body, err := buildKIEVideoRequestBody([]byte(`{"model":"grok-imagine/image-to-video","prompt":"animate","seconds":8,"size":"16:9","resolution":"1080p","image_urls":["https://cdn.example.com/frame.png"]}`), "grok-imagine/image-to-video")
	require.NoError(t, err)
	var payload map[string]any
	require.NoError(t, json.Unmarshal(body, &payload))
	input := payload["input"].(map[string]any)
	assert.Equal(t, "16:9", input["aspect_ratio"])
	assert.Equal(t, "1080p", input["resolution"])
}

func TestSoraAdaptorBuildsAPIMartVideoTaskContract(t *testing.T) {
	payload := []byte(`{"model":"wan2-7-videoedit","prompt":"edit it","seconds":10,"size":"16:9","metadata":{"video_urls":["https://cdn.example.com/source.mp4"],"resolution":"1080P"}}`)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/videos", bytes.NewReader(payload))
	c.Request.Header.Set("Content-Type", "application/json")
	defer common.CleanupBodyStorage(c)
	info := &relaycommon.RelayInfo{
		ChannelMeta:   &relaycommon.ChannelMeta{ChannelBaseUrl: "https://api.apimart.ai/v1", UpstreamModelName: "wan2-7-videoedit"},
		TaskRelayInfo: &relaycommon.TaskRelayInfo{Action: "apimart-video:wan2-7-videoedit"},
	}
	adaptor := &TaskAdaptor{baseURL: info.ChannelBaseUrl}
	requestURL, err := adaptor.BuildRequestURL(info)
	require.NoError(t, err)
	assert.Equal(t, "https://api.apimart.ai/v1/videos/generations", requestURL)
	body, err := adaptor.BuildRequestBody(c, info)
	require.NoError(t, err)
	encoded, err := io.ReadAll(body)
	require.NoError(t, err)
	var got map[string]any
	require.NoError(t, json.Unmarshal(encoded, &got))
	assert.NotContains(t, got, "metadata")
	assert.NotContains(t, got, "seconds")
	assert.Equal(t, []any{"https://cdn.example.com/source.mp4"}, got["video_urls"])
	assert.Equal(t, "1080P", got["resolution"])
}

func TestSoraAdaptorNormalizesAPIMartVideoContracts(t *testing.T) {
	tests := []struct {
		name, model, body string
		check             func(*testing.T, map[string]any)
	}{
		{"seedance frames", "doubao-seedance-2-5", `{"prompt":"x","seconds":3,"ratio":"16:9","resolution":"1080p","first_frame_url":"https://cdn.example.com/first.png","last_frame_url":"https://cdn.example.com/last.png"}`, func(t *testing.T, got map[string]any) {
			assert.EqualValues(t, 4, got["duration"])
			assert.Equal(t, "16:9", got["size"])
			assert.Equal(t, "720p", got["resolution"])
			assert.Len(t, got["image_with_roles"], 2)
		}},
		{"kling frames and mode", "kling-v3", `{"prompt":"x","seconds":5,"size":"16:9","resolution":"1080p","mode":"pro","image":"https://cdn.example.com/first.png","image_tail":"https://cdn.example.com/last.png"}`, func(t *testing.T, got map[string]any) {
			assert.Equal(t, []any{"https://cdn.example.com/first.png", "https://cdn.example.com/last.png"}, got["image_urls"])
			assert.NotContains(t, got, "resolution")
			assert.Equal(t, "pro", got["mode"])
		}},
		{"kling advanced", "kling-v3", `{"prompt":"x","seconds":5,"multi_shot":true,"shot_type":"customize","multi_prompt":[{"prompt":"one","duration":20}],"element_list":[{"name":"hero","references":[{"kind":"image","url":"https://cdn.example.com/hero.png"}]}],"audio":"native"}`, func(t *testing.T, got map[string]any) {
			assert.Equal(t, true, got["audio"])
			prompts := got["multi_prompt"].([]any)
			assert.EqualValues(t, 1, prompts[0].(map[string]any)["index"])
			assert.EqualValues(t, 15, prompts[0].(map[string]any)["duration"])
			elements := got["element_list"].([]any)
			assert.Equal(t, []any{"https://cdn.example.com/hero.png"}, elements[0].(map[string]any)["element_input_urls"])
		}},
		{"h3 contract", "MiniMax-H3", `{"prompt":"x","seconds":2,"ratio":"adaptive","resolution":"720p","first_frame_url":"https://cdn.example.com/first.png","last_frame_url":"https://cdn.example.com/last.png"}`, func(t *testing.T, got map[string]any) {
			assert.EqualValues(t, 4, got["duration"])
			assert.Equal(t, "768P", got["resolution"])
			assert.Equal(t, "adaptive", got["aspect_ratio"])
			assert.Equal(t, "https://cdn.example.com/first.png", got["first_frame_image"])
			assert.Equal(t, "https://cdn.example.com/last.png", got["last_frame_image"])
		}},
		{"wan roles", "wan2.7-i2v-plus", `{"prompt":"x","seconds":10,"resolution":"1080p","images":["https://cdn.example.com/first.png","https://cdn.example.com/last.png"]}`, func(t *testing.T, got map[string]any) {
			assert.Equal(t, "1080P", got["resolution"])
			assert.Len(t, got["image_with_roles"], 2)
		}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			body, err := buildAPIMartVideoRequestBody([]byte(tt.body), tt.model)
			require.NoError(t, err)
			var got map[string]any
			require.NoError(t, json.Unmarshal(body, &got))
			tt.check(t, got)
		})
	}
}

func TestSoraAdaptorCoversAPIMartVideoModelMatrix(t *testing.T) {
	image1 := "https://cdn.example.com/one.png"
	image2 := "https://cdn.example.com/two.png"
	video1 := "https://cdn.example.com/source.mp4"
	audio1 := "https://cdn.example.com/voice.mp3"
	tests := []struct {
		name, model, body string
		check             func(*testing.T, map[string]any)
	}{
		{"sora image drops aspect and limits count", "sora-2", `{"prompt":"x","size":"16:9","resolution":"1080p","image_urls":["` + image1 + `","` + image2 + `"]}`, func(t *testing.T, got map[string]any) {
			assert.NotContains(t, got, "aspect_ratio")
			assert.Equal(t, []any{image1}, got["image_urls"])
			assert.Equal(t, "720p", got["resolution"])
		}},
		{"official veo uses named frames", "veo3.1-official", `{"prompt":"x","images":["` + image1 + `","` + image2 + `"]}`, func(t *testing.T, got map[string]any) {
			assert.Equal(t, image1, got["first_frame_image"])
			assert.Equal(t, image2, got["last_frame_image"])
			assert.NotContains(t, got, "image_urls")
		}},
		{"h3 generic references stay arrays", "minimax-h3", `{"prompt":"x","input_reference":["` + image1 + `","` + image2 + `"],"video_reference":["` + video1 + `"],"audio_reference":["` + audio1 + `"]}`, func(t *testing.T, got map[string]any) {
			assert.Equal(t, []any{image1, image2}, got["image_urls"])
			assert.Equal(t, []any{video1}, got["video_urls"])
			assert.Equal(t, []any{audio1}, got["audio_urls"])
			assert.NotContains(t, got, "first_frame_image")
		}},
		{"hailuo 23 keeps only first frame", "minimax-hailuo-2-3-fast", `{"prompt":"x","first_frame_url":"` + image1 + `","last_frame_url":"` + image2 + `"}`, func(t *testing.T, got map[string]any) {
			assert.Equal(t, image1, got["first_frame_image"])
			assert.NotContains(t, got, "last_frame_image")
			assert.NotContains(t, got, "aspect_ratio")
		}},
		{"skyreels builds tagged references", "skyreels-v4", `{"prompt":"x","image_urls":["` + image1 + `","` + image2 + `"],"video_urls":["` + video1 + `"],"audio_urls":["` + audio1 + `"]}`, func(t *testing.T, got map[string]any) {
			images := got["ref_images"].([]any)
			assert.Equal(t, audio1, images[0].(map[string]any)["audio_url"])
			videos := got["ref_videos"].([]any)
			assert.Equal(t, video1, videos[0].(map[string]any)["video_url"])
			assert.NotContains(t, got, "image_urls")
		}},
		{"happyhorse 11 distinguishes ordinary images", "happyhorse-1-1", `{"prompt":"x","image_urls":["` + image1 + `","` + image2 + `"]}`, func(t *testing.T, got map[string]any) {
			assert.Equal(t, []any{image1, image2}, got["image_urls"])
			assert.NotContains(t, got, "first_frame_image")
		}},
		{"happyhorse 11 explicit frame wins", "happyhorse-1-1", `{"prompt":"x","first_frame_url":"` + image1 + `","image_urls":["` + image2 + `"]}`, func(t *testing.T, got map[string]any) {
			assert.Equal(t, image1, got["first_frame_image"])
			assert.NotContains(t, got, "image_urls")
		}},
		{"wan r2v preserves roles and voice", "wan2.7-r2v", `{"prompt":"x","image_with_roles":[{"url":"` + image1 + `","role":"reference"}],"video_urls":["` + video1 + `"],"audio_urls":["` + audio1 + `"]}`, func(t *testing.T, got map[string]any) {
			roles := got["image_with_roles"].([]any)
			assert.Equal(t, audio1, roles[0].(map[string]any)["reference_voice"])
			assert.Equal(t, []any{video1}, got["video_urls"])
		}},
		{"motion control requires scalar media and no duration", "kling-v2-6-motion-control", `{"prompt":"x","seconds":8,"image_urls":["` + image1 + `"],"video_urls":["` + video1 + `"]}`, func(t *testing.T, got map[string]any) {
			assert.Equal(t, image1, got["image_url"])
			assert.Equal(t, video1, got["video_url"])
			assert.Equal(t, "video", got["character_orientation"])
			assert.NotContains(t, got, "duration")
		}},
		{"kling omni builds video list and disables generated audio", "kling-v3-omni-reference-to-video", `{"prompt":"x","video_urls":["` + video1 + `"],"generate_audio":true}`, func(t *testing.T, got map[string]any) {
			items := got["video_list"].([]any)
			assert.Equal(t, video1, items[0].(map[string]any)["video_url"])
			assert.NotContains(t, got, "audio")
		}},
		{"grok maps resolution to quality", "grok-imagine-video", `{"prompt":"x","resolution":"1080p","ratio":"9:16"}`, func(t *testing.T, got map[string]any) {
			assert.Equal(t, "1080p", got["quality"])
			assert.Equal(t, "9:16", got["size"])
			assert.NotContains(t, got, "resolution")
		}},
		{"pixverse distinguishes frame inputs", "pixverse-v6", `{"prompt":"x","first_frame_url":"` + image1 + `","last_frame_url":"` + image2 + `","generate_audio":true}`, func(t *testing.T, got map[string]any) {
			assert.Equal(t, image1, got["first_frame_image"])
			assert.Equal(t, image2, got["last_frame_image"])
			assert.Equal(t, true, got["audio"])
		}},
		{"vidu image mode drops aspect", "vidu-q2", `{"prompt":"x","size":"16:9","image_urls":["` + image1 + `","` + image2 + `"]}`, func(t *testing.T, got map[string]any) {
			assert.Equal(t, []any{image1, image2}, got["image_urls"])
			assert.NotContains(t, got, "aspect_ratio")
		}},
		{"flux limits image references and keeps one video", "flux-3-video", `{"prompt":"x","image_urls":["` + image1 + `","` + image2 + `","https://cdn.example.com/3.png","https://cdn.example.com/4.png","https://cdn.example.com/5.png","https://cdn.example.com/6.png","https://cdn.example.com/7.png","https://cdn.example.com/8.png","https://cdn.example.com/9.png","https://cdn.example.com/10.png","https://cdn.example.com/11.png"],"video_urls":["` + video1 + `"]}`, func(t *testing.T, got map[string]any) {
			assert.Len(t, got["image_urls"], 10)
			assert.Equal(t, video1, got["video_url"])
		}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			body, err := buildAPIMartVideoRequestBody([]byte(tt.body), tt.model)
			require.NoError(t, err)
			var got map[string]any
			require.NoError(t, json.Unmarshal(body, &got))
			tt.check(t, got)
		})
	}
}

func TestSoraAdaptorRequiresAPIMartVideoMedia(t *testing.T) {
	_, err := buildAPIMartVideoRequestBody([]byte(`{"prompt":"x"}`), "wan2.7-videoedit")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "video_urls")
}

func TestSoraAdaptorPreservesAPIMartReferenceRoles(t *testing.T) {
	body, err := buildAPIMartVideoRequestBody([]byte(`{"prompt":"x","images":["https://cdn.example.com/frame.png"],"image_with_roles":[{"url":"https://cdn.example.com/character.png","role":"reference"}],"video_urls":["https://cdn.example.com/source.mp4"]}`), "wan2.7-r2v")
	require.NoError(t, err)
	var got map[string]any
	require.NoError(t, json.Unmarshal(body, &got))
	roles := got["image_with_roles"].([]any)
	assert.Equal(t, "reference", roles[0].(map[string]any)["role"])
}

func TestSoraAdaptorRejectsNonPublicVideoReferences(t *testing.T) {
	for _, test := range []struct {
		name, model, body string
		build             func([]byte, string) ([]byte, error)
	}{
		{"KIE data URL", "kling/v2-1-pro", `{"prompt":"x","image_url":"data:image/png;base64,AAAA"}`, buildKIEVideoRequestBody},
		{"KIE private URL", "kling/v2-1-pro", `{"prompt":"x","image_url":"http://127.0.0.1/frame.png"}`, buildKIEVideoRequestBody},
		{"APIMart local URL", "wan2.7-videoedit", `{"prompt":"x","video_urls":["http://localhost/source.mp4"]}`, buildAPIMartVideoRequestBody},
	} {
		t.Run(test.name, func(t *testing.T) {
			_, err := test.build([]byte(test.body), test.model)
			require.Error(t, err)
			assert.Contains(t, err.Error(), "视频参考素材")
		})
	}
}

func TestSoraAdaptorFlattensProviderMetadata(t *testing.T) {
	kie, err := buildKIEVideoRequestBody([]byte(`{"model":"wan/2-7-text-to-video","prompt":"hello","seconds":5,"resolution":"720p","metadata":{"input":{"audio_url":"https://cdn.example.com/voice.mp3"},"parameters":{"resolution":"1080P"}}}`), "wan/2-7-text-to-video")
	require.NoError(t, err)
	var kieBody map[string]any
	require.NoError(t, json.Unmarshal(kie, &kieBody))
	kieInput := kieBody["input"].(map[string]any)
	assert.Equal(t, "https://cdn.example.com/voice.mp3", kieInput["audio_url"])
	assert.Equal(t, "1080P", kieInput["resolution"])
	assert.NotContains(t, kieInput, "parameters")

	apimart, err := buildAPIMartVideoRequestBody([]byte(`{"model":"flux-3-video","prompt":"hello","resolution":"720p","metadata":{"parameters":{"resolution":"1080p"},"input":{"video_url":"https://cdn.example.com/source.mp4"}}}`), "flux-3-video")
	require.NoError(t, err)
	var apimartBody map[string]any
	require.NoError(t, json.Unmarshal(apimart, &apimartBody))
	assert.Equal(t, "1080p", apimartBody["resolution"])
	assert.Equal(t, "https://cdn.example.com/source.mp4", apimartBody["video_url"])
	assert.NotContains(t, apimartBody, "parameters")
	assert.NotContains(t, apimartBody, "input")
}

func TestSoraAdaptorParsesKIEAndAPIMartVideoTasks(t *testing.T) {
	adaptor := &TaskAdaptor{}
	kieSubmitID, status, err := parseKIEVideoSubmitResponse([]byte(`{"code":200,"data":{"taskId":"kie_task"}}`))
	require.NoError(t, err)
	assert.Equal(t, "kie_task", kieSubmitID)
	assert.Equal(t, "processing", status)
	kieResult, ok, err := parseKIEVideoTaskResult([]byte(`{"code":200,"data":{"taskId":"kie_task","state":"success","progress":100,"resultJson":"{\"resultUrls\":[\"https://cdn.example.com/kie.mp4\"]}"}}`))
	require.NoError(t, err)
	require.True(t, ok)
	assert.Equal(t, model.TaskStatusSuccess, kieResult.Status)
	assert.Equal(t, "https://cdn.example.com/kie.mp4", kieResult.Url)

	apimartSubmitID, status, err := parseAPIMartVideoSubmitResponse([]byte(`{"code":200,"data":[{"task_id":"apimart_task","status":"submitted"}]}`))
	require.NoError(t, err)
	assert.Equal(t, "apimart_task", apimartSubmitID)
	assert.Equal(t, "processing", status)
	apimartResult, ok, err := parseAPIMartVideoTaskResult([]byte(`{"code":200,"data":{"id":"apimart_task","status":"completed","progress":100,"result":{"videos":[{"url":"https://cdn.example.com/apimart.mp4"}]}}}`))
	require.NoError(t, err)
	require.True(t, ok)
	assert.Equal(t, model.TaskStatusSuccess, apimartResult.Status)
	assert.Equal(t, "https://cdn.example.com/apimart.mp4", apimartResult.Url)

	_ = adaptor
}

func TestSoraAdaptorFetchesKIEAndAPIMartStatusPaths(t *testing.T) {
	paths := make(chan string, 2)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths <- r.URL.RequestURI()
		_, _ = w.Write([]byte(`{}`))
	}))
	defer server.Close()
	adaptor := &TaskAdaptor{}
	for _, test := range []struct {
		action string
		want   string
	}{
		{action: "kie-video:wan/2-7-videoedit", want: "/v1/jobs/recordInfo?taskId=task_1"},
		{action: "apimart-video:wan2-7-videoedit", want: "/v1/tasks/task_1?language=zh"},
	} {
		resp, err := adaptor.FetchTask(server.URL, "sk-test", map[string]any{"task_id": "task_1", "action": test.action}, "")
		require.NoError(t, err)
		resp.Body.Close()
		assert.Equal(t, test.want, <-paths)
	}
}

func TestSoraBuildRequestBodyReturnsReplayablePassThroughBody(t *testing.T) {
	payload := []byte("opaque-sora-request-body")
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/videos", bytes.NewReader(payload))
	c.Request.Header.Set("Content-Type", "application/octet-stream")
	defer common.CleanupBodyStorage(c)

	info := &relaycommon.RelayInfo{}
	body, err := (&TaskAdaptor{}).BuildRequestBody(c, info)
	require.NoError(t, err)
	replayable, ok := body.(common.ReplayableBody)
	require.True(t, ok)

	sent, err := io.ReadAll(body)
	require.NoError(t, err)
	assert.Equal(t, payload, sent)
	assert.EqualValues(t, len(payload), replayable.Size())

	replayBody, err := replayable.NewReader()
	require.NoError(t, err)
	replay, err := io.ReadAll(replayBody)
	require.NoError(t, err)
	require.NoError(t, replayBody.Close())
	assert.Equal(t, payload, replay)
}

func TestSoraAdaptorStripsCompatibilityOnlyFieldsForOfficialSora(t *testing.T) {
	payload := []byte(`{"model":"sora-2","prompt":"make a video","seconds":8,"size":"1280x720","resolution":"720p","duration":8,"watermark":false}`)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/videos", bytes.NewReader(payload))
	c.Request.Header.Set("Content-Type", "application/json")
	defer common.CleanupBodyStorage(c)
	info := &relaycommon.RelayInfo{
		ChannelMeta:   &relaycommon.ChannelMeta{ChannelBaseUrl: "https://api.openai.com/v1", UpstreamModelName: "sora-2"},
		TaskRelayInfo: &relaycommon.TaskRelayInfo{},
	}
	body, err := (&TaskAdaptor{}).BuildRequestBody(c, info)
	require.NoError(t, err)
	encoded, err := io.ReadAll(body)
	require.NoError(t, err)
	var got map[string]any
	require.NoError(t, json.Unmarshal(encoded, &got))
	assert.Equal(t, "1280x720", got["size"])
	assert.EqualValues(t, 8, got["seconds"])
	assert.NotContains(t, got, "resolution")
	assert.NotContains(t, got, "duration")
	assert.NotContains(t, got, "watermark")
}

func TestSoraAdaptorUsesAgnesTaskContract(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "/agnesapi", r.URL.Path)
		assert.Equal(t, "video_upstream", r.URL.Query().Get("video_id"))
		assert.Equal(t, "agnes-video-2.5", r.URL.Query().Get("model_name"))
		assert.Equal(t, "Bearer sk-test", r.Header.Get("Authorization"))
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"video_id":"video_upstream","status":"completed","video_url":"https://cdn.example.com/result.mp4"}`))
	}))
	defer server.Close()

	adaptor := &TaskAdaptor{}
	resp, err := adaptor.FetchTask(server.URL+"/v1", "sk-test", map[string]any{
		"task_id": "video_upstream",
		"action":  "agnes-video:agnes-video-2.5",
	}, "")
	require.NoError(t, err)
	defer resp.Body.Close()
	data, err := io.ReadAll(resp.Body)
	require.NoError(t, err)

	result, err := adaptor.ParseTaskResult(data)
	require.NoError(t, err)
	assert.Equal(t, "SUCCESS", result.Status)
	assert.Equal(t, "https://cdn.example.com/result.mp4", result.Url)
}

func TestSoraAdaptorAcceptsAgnesVideoIDOnSubmit(t *testing.T) {
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	info := &relaycommon.RelayInfo{TaskRelayInfo: &relaycommon.TaskRelayInfo{PublicTaskID: "task_public"}}
	resp := &http.Response{Body: io.NopCloser(bytes.NewBufferString(`{"video_id":"video_upstream","status":"queued"}`))}

	parsed, taskErr := (&TaskAdaptor{}).ParseResponse(c, resp, info)
	require.Nil(t, taskErr)
	require.NotNil(t, parsed)
	assert.Equal(t, "video_upstream", parsed.UpstreamTaskID)
	clientResponse, ok := parsed.ClientResponse.(responseTask)
	require.True(t, ok)
	assert.Equal(t, "task_public", clientResponse.VideoID)
}
