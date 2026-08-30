package gemini

import (
	"encoding/base64"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/QuantumNous/new-api/constant"
	taskcommon "github.com/QuantumNous/new-api/relay/channel/task/taskcommon"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/gin-gonic/gin"
)

const maxVeoImageSize = 20 * 1024 * 1024 // 20 MB

// ExtractMultipartImage reads the first `input_reference` file from a multipart
// form upload and returns a VeoImageInput. Returns nil if no file is present.
func ExtractMultipartImage(c *gin.Context, info *relaycommon.RelayInfo) *VeoImageInput {
	mf, err := c.MultipartForm()
	if err != nil {
		return nil
	}
	files, exists := mf.File["input_reference"]
	if !exists || len(files) == 0 {
		return nil
	}
	fh := files[0]
	if fh.Size > maxVeoImageSize {
		return nil
	}
	file, err := fh.Open()
	if err != nil {
		return nil
	}
	defer file.Close()

	fileBytes, err := io.ReadAll(file)
	if err != nil {
		return nil
	}

	mimeType := fh.Header.Get("Content-Type")
	if mimeType == "" || mimeType == "application/octet-stream" {
		mimeType = http.DetectContentType(fileBytes)
	}

	info.Action = constant.TaskActionGenerate
	return &VeoImageInput{
		BytesBase64Encoded: base64.StdEncoding.EncodeToString(fileBytes),
		MimeType:           mimeType,
	}
}

func BuildVeoInstance(c *gin.Context, info *relaycommon.RelayInfo, req relaycommon.TaskSubmitReq) (VeoInstance, error) {
	instance := VeoInstance{Prompt: req.Prompt}
	if info.ChannelMeta == nil {
		info.ChannelMeta = &relaycommon.ChannelMeta{}
	}
	if info.TaskRelayInfo == nil {
		info.TaskRelayInfo = &relaycommon.TaskRelayInfo{}
	}
	inputs := VeoInputMetadata{}
	if err := taskcommon.UnmarshalMetadata(req.Metadata, &inputs); err != nil {
		return instance, fmt.Errorf("unmarshal Veo input metadata failed: %w", err)
	}
	if inputs.LastFrame != "" && inputs.FirstFrame == "" {
		return instance, fmt.Errorf("Veo lastFrame requires firstFrame")
	}
	if len(inputs.ReferenceImages) > 3 {
		return instance, fmt.Errorf("Veo referenceImages supports at most 3 images")
	}
	if (inputs.FirstFrame != "" || inputs.LastFrame != "") && len(inputs.ReferenceImages) > 0 {
		return instance, fmt.Errorf("Veo frame inputs cannot be combined with referenceImages")
	}
	parseRequired := func(value, field string) (*VeoImageInput, error) {
		parsed := ParseImageInput(value)
		if parsed == nil {
			return nil, fmt.Errorf("invalid Veo %s image", field)
		}
		return parsed, nil
	}
	if inputs.FirstFrame != "" {
		parsed, err := parseRequired(inputs.FirstFrame, "firstFrame")
		if err != nil {
			return instance, err
		}
		instance.Image = parsed
	}
	if inputs.LastFrame != "" {
		parsed, err := parseRequired(inputs.LastFrame, "lastFrame")
		if err != nil {
			return instance, err
		}
		instance.LastFrame = parsed
	}
	for _, value := range inputs.ReferenceImages {
		parsed, err := parseRequired(value, "referenceImages")
		if err != nil {
			return instance, err
		}
		instance.ReferenceImages = append(instance.ReferenceImages, VeoReferenceImage{Image: *parsed, ReferenceType: "asset"})
	}
	if instance.Image != nil || instance.LastFrame != nil || len(instance.ReferenceImages) > 0 {
		info.Action = constant.TaskActionGenerate
		return instance, nil
	}
	if img := ExtractMultipartImage(c, info); img != nil {
		instance.Image = img
	} else if len(req.Images) > 0 {
		if parsed := ParseImageInput(req.Images[0]); parsed != nil {
			instance.Image = parsed
			info.Action = constant.TaskActionGenerate
		}
	}
	return instance, nil
}

// ParseImageInput parses an image string (data URI or raw base64) into a
// VeoImageInput. Returns nil if the input is empty or invalid.
// TODO: support downloading HTTP URL images and converting to base64
func ParseImageInput(imageStr string) *VeoImageInput {
	imageStr = strings.TrimSpace(imageStr)
	if imageStr == "" {
		return nil
	}

	if strings.HasPrefix(imageStr, "data:") {
		return parseDataURI(imageStr)
	}

	raw, err := base64.StdEncoding.DecodeString(imageStr)
	if err != nil {
		return nil
	}
	return &VeoImageInput{
		BytesBase64Encoded: imageStr,
		MimeType:           http.DetectContentType(raw),
	}
}

func parseDataURI(uri string) *VeoImageInput {
	// data:image/png;base64,iVBOR...
	rest := uri[len("data:"):]
	idx := strings.Index(rest, ",")
	if idx < 0 {
		return nil
	}
	meta := rest[:idx]
	b64 := rest[idx+1:]
	if b64 == "" {
		return nil
	}

	mimeType := "application/octet-stream"
	parts := strings.SplitN(meta, ";", 2)
	if len(parts) >= 1 && parts[0] != "" {
		mimeType = parts[0]
	}

	return &VeoImageInput{
		BytesBase64Encoded: b64,
		MimeType:           mimeType,
	}
}
