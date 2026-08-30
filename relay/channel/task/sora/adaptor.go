package sora

import (
	"bytes"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"net/url"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relay/channel"
	taskcommon "github.com/QuantumNous/new-api/relay/channel/task/taskcommon"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/service"

	"github.com/gin-gonic/gin"
	"github.com/pkg/errors"
	"github.com/tidwall/sjson"
)

// ============================
// Request / Response structures
// ============================

type ContentItem struct {
	Type     string    `json:"type"`                // "text" or "image_url"
	Text     string    `json:"text,omitempty"`      // for text type
	ImageURL *ImageURL `json:"image_url,omitempty"` // for image_url type
}

type ImageURL struct {
	URL string `json:"url"`
}

type responseTask struct {
	ID                 string `json:"id"`
	TaskID             string `json:"task_id,omitempty"` //兼容旧接口
	VideoID            string `json:"video_id,omitempty"`
	Object             string `json:"object"`
	Model              string `json:"model"`
	Status             string `json:"status"`
	Progress           int    `json:"progress"`
	CreatedAt          int64  `json:"created_at"`
	CompletedAt        int64  `json:"completed_at,omitempty"`
	ExpiresAt          int64  `json:"expires_at,omitempty"`
	Seconds            string `json:"seconds,omitempty"`
	Size               string `json:"size,omitempty"`
	RemixedFromVideoID string `json:"remixed_from_video_id,omitempty"`
	VideoURL           string `json:"video_url,omitempty"`
	URL                string `json:"url,omitempty"`
	OutputURL          string `json:"output_url,omitempty"`
	DownloadURL        string `json:"download_url,omitempty"`
	Data               any    `json:"data,omitempty"`
	Result             any    `json:"result,omitempty"`
	Output             any    `json:"output,omitempty"`
	Error              *struct {
		Message string `json:"message"`
		Code    string `json:"code"`
	} `json:"error,omitempty"`
}

// ============================
// Adaptor implementation
// ============================

type TaskAdaptor struct {
	taskcommon.BaseBilling
	ChannelType int
	apiKey      string
	baseURL     string
}

func (a *TaskAdaptor) Init(info *relaycommon.RelayInfo) {
	a.ChannelType = info.ChannelType
	a.baseURL = info.ChannelBaseUrl
	a.apiKey = info.ApiKey
}

func validateRemixRequest(c *gin.Context) *dto.TaskError {
	var req relaycommon.TaskSubmitReq
	if err := common.UnmarshalBodyReusable(c, &req); err != nil {
		return service.TaskErrorWrapperLocal(err, "invalid_request", http.StatusBadRequest)
	}
	if strings.TrimSpace(req.Prompt) == "" {
		return service.TaskErrorWrapperLocal(fmt.Errorf("field prompt is required"), "invalid_request", http.StatusBadRequest)
	}
	// 存储原始请求到 context，与 ValidateMultipartDirect 路径保持一致
	c.Set("task_request", req)
	return nil
}

func (a *TaskAdaptor) ValidateRequestAndSetAction(c *gin.Context, info *relaycommon.RelayInfo) (taskErr *dto.TaskError) {
	if info.Action == constant.TaskActionRemix {
		return validateRemixRequest(c)
	}
	if taskErr := relaycommon.ValidateMultipartDirect(c, info); taskErr != nil {
		return taskErr
	}
	req, err := relaycommon.GetTaskRequest(c)
	if err == nil {
		switch {
		case isKIEVideoUpstream(info.ChannelBaseUrl, req.Model):
			info.Action = "kie-video:" + req.Model
		case isAPIMartVideoUpstream(info.ChannelBaseUrl):
			info.Action = "apimart-video:" + req.Model
		case strings.Contains(strings.ToLower(req.Model), "agnes-video"):
			info.Action = "agnes-video:" + req.Model
		}
	}
	return nil
}

// EstimateBilling 根据用户请求的 seconds 和 size 计算 OtherRatios。
func (a *TaskAdaptor) EstimateBilling(c *gin.Context, info *relaycommon.RelayInfo) map[string]float64 {
	// remix 路径的 OtherRatios 已在 ResolveOriginTask 中设置
	if info.Action == constant.TaskActionRemix {
		return nil
	}

	req, err := relaycommon.GetTaskRequest(c)
	if err != nil {
		return nil
	}

	seconds, _ := strconv.Atoi(req.Seconds)
	if seconds == 0 {
		seconds = req.Duration
	}
	if seconds <= 0 {
		seconds = 4
		modelName := req.Model
		if info != nil && info.ChannelMeta != nil && info.UpstreamModelName != "" {
			modelName = info.UpstreamModelName
		}
		if strings.HasPrefix(strings.ToLower(strings.TrimSpace(modelName)), "minimax-h3") {
			seconds = 5
		}
	}

	size := req.Size
	if size == "" {
		size = "720x1280"
	}

	ratios := map[string]float64{
		"seconds": float64(seconds),
		"size":    1,
	}
	if size == "1792x1024" || size == "1024x1792" {
		ratios["size"] = 1.666667
	}
	return ratios
}

func (a *TaskAdaptor) BuildRequestURL(info *relaycommon.RelayInfo) (string, error) {
	action := taskRelayAction(info)
	if action == constant.TaskActionRemix {
		return fmt.Sprintf("%s/v1/videos/%s/remix", a.baseURL, info.OriginTaskID), nil
	}
	if strings.HasPrefix(action, "kie-video:") {
		return videoProviderURL(a.baseURL, "/v1/jobs/createTask"), nil
	}
	if strings.HasPrefix(action, "apimart-video:") {
		return videoProviderURL(a.baseURL, "/v1/videos/generations"), nil
	}
	return fmt.Sprintf("%s/v1/videos", a.baseURL), nil
}

// BuildRequestHeader sets required headers.
func (a *TaskAdaptor) BuildRequestHeader(c *gin.Context, req *http.Request, info *relaycommon.RelayInfo) error {
	req.Header.Set("Authorization", "Bearer "+a.apiKey)
	req.Header.Set("Content-Type", c.Request.Header.Get("Content-Type"))
	return nil
}

func (a *TaskAdaptor) BuildRequestBody(c *gin.Context, info *relaycommon.RelayInfo) (io.Reader, error) {
	storage, err := common.GetBodyStorage(c)
	if err != nil {
		return nil, errors.Wrap(err, "get_request_body_failed")
	}
	cachedBody, err := storage.Bytes()
	if err != nil {
		return nil, errors.Wrap(err, "read_body_bytes_failed")
	}
	contentType := c.GetHeader("Content-Type")
	action := taskRelayAction(info)
	if strings.HasPrefix(action, "kie-video:") {
		if strings.HasPrefix(strings.ToLower(contentType), "multipart/form-data") {
			multipartBody, multipartErr := a.buildKIEVideoMultipartPayload(c, cachedBody)
			if multipartErr != nil {
				return nil, multipartErr
			}
			cachedBody = multipartBody
		}
		body, err := buildKIEVideoRequestBody(cachedBody, info.UpstreamModelName)
		if err != nil {
			return nil, err
		}
		c.Request.Header.Set("Content-Type", "application/json")
		return bytes.NewReader(body), nil
	}
	if strings.HasPrefix(action, "apimart-video:") {
		body, err := buildAPIMartVideoRequestBody(cachedBody, info.UpstreamModelName)
		if err != nil {
			return nil, err
		}
		c.Request.Header.Set("Content-Type", "application/json")
		return bytes.NewReader(body), nil
	}

	if strings.HasPrefix(contentType, "application/json") {
		var bodyMap map[string]interface{}
		if err := common.Unmarshal(cachedBody, &bodyMap); err == nil {
			bodyMap["model"] = info.UpstreamModelName
			if isOfficialSoraVideoRequest(info) {
				sanitizeOfficialSoraVideoPayload(bodyMap)
			}
			if newBody, err := common.Marshal(bodyMap); err == nil {
				return bytes.NewReader(newBody), nil
			}
		}
		return bytes.NewReader(cachedBody), nil
	}

	if strings.Contains(contentType, "multipart/form-data") {
		formData, err := common.ParseMultipartFormReusable(c)
		if err != nil {
			return bytes.NewReader(cachedBody), nil
		}
		var buf bytes.Buffer
		writer := multipart.NewWriter(&buf)
		writer.WriteField("model", info.UpstreamModelName)
		for key, values := range formData.Value {
			if key == "model" {
				continue
			}
			if isOfficialSoraVideoRequest(info) && isUnsupportedOfficialSoraVideoField(key) {
				continue
			}
			for _, v := range values {
				writer.WriteField(key, v)
			}
		}
		for fieldName, fileHeaders := range formData.File {
			for _, fh := range fileHeaders {
				f, err := fh.Open()
				if err != nil {
					continue
				}
				ct := fh.Header.Get("Content-Type")
				if ct == "" || ct == "application/octet-stream" {
					buf512 := make([]byte, 512)
					n, _ := io.ReadFull(f, buf512)
					ct = http.DetectContentType(buf512[:n])
					// Re-open after sniffing so the full content is copied below
					f.Close()
					f, err = fh.Open()
					if err != nil {
						continue
					}
				}
				h := make(textproto.MIMEHeader)
				h.Set("Content-Disposition", fmt.Sprintf(`form-data; name="%s"; filename="%s"`, fieldName, fh.Filename))
				h.Set("Content-Type", ct)
				part, err := writer.CreatePart(h)
				if err != nil {
					f.Close()
					continue
				}
				io.Copy(part, f)
				f.Close()
			}
		}
		writer.Close()
		c.Request.Header.Set("Content-Type", writer.FormDataContentType())
		return &buf, nil
	}

	return common.NewReplayableBodyReader(storage), nil
}

// KIE's task endpoint is JSON, but the public compatibility endpoint also
// accepts input_reference file parts. Upload each part first so the final
// model payload contains a publicly reachable URL.
func (a *TaskAdaptor) buildKIEVideoMultipartPayload(c *gin.Context, _ []byte) ([]byte, error) {
	form, err := common.ParseMultipartFormReusable(c)
	if err != nil {
		return nil, errors.Wrap(err, "parse KIE multipart request failed")
	}
	payload := map[string]any{}
	for key, values := range form.Value {
		if len(values) == 1 {
			var parsed any
			if common.Unmarshal([]byte(values[0]), &parsed) == nil {
				payload[key] = parsed
			} else {
				payload[key] = values[0]
			}
		} else {
			items := make([]any, 0, len(values))
			for _, value := range values {
				var parsed any
				if common.Unmarshal([]byte(value), &parsed) == nil {
					items = append(items, parsed)
				} else {
					items = append(items, value)
				}
			}
			payload[key] = items
		}
	}
	for field, headers := range form.File {
		values := make([]string, 0, len(headers))
		for _, header := range headers {
			value, uploadErr := a.uploadKIEReferenceFile(header)
			if uploadErr != nil {
				return nil, uploadErr
			}
			values = append(values, value)
		}
		if len(values) == 1 {
			payload[field] = values[0]
		} else if len(values) > 1 {
			payload[field] = values
		}
	}
	return common.Marshal(payload)
}

func (a *TaskAdaptor) uploadKIEReferenceFile(header *multipart.FileHeader) (string, error) {
	file, err := header.Open()
	if err != nil {
		return "", errors.Wrap(err, "open KIE multipart reference failed")
	}
	data, err := io.ReadAll(io.LimitReader(file, 32<<20))
	file.Close()
	if err != nil || len(data) == 0 {
		return "", fmt.Errorf("KIE multipart reference is empty")
	}
	contentType := strings.TrimSpace(header.Header.Get("Content-Type"))
	if contentType == "" || contentType == "application/octet-stream" {
		contentType = http.DetectContentType(data)
	}
	uploadPath := "images/user-uploads"
	if strings.HasPrefix(contentType, "video/") {
		uploadPath = "videos/user-uploads"
	} else if strings.HasPrefix(contentType, "audio/") {
		uploadPath = "audios/user-uploads"
	}
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	partHeader := make(textproto.MIMEHeader)
	partHeader.Set("Content-Disposition", fmt.Sprintf(`form-data; name="file"; filename="%s"`, strings.ReplaceAll(header.Filename, `"`, "")))
	partHeader.Set("Content-Type", contentType)
	part, err := writer.CreatePart(partHeader)
	if err != nil {
		return "", err
	}
	if _, err = part.Write(data); err != nil {
		return "", err
	}
	_ = writer.WriteField("uploadPath", uploadPath)
	_ = writer.WriteField("fileName", header.Filename)
	if err = writer.Close(); err != nil {
		return "", err
	}
	req, err := http.NewRequest(http.MethodPost, "https://kieai.redpandaai.co/api/file-stream-upload", &body)
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(a.apiKey))
	req.Header.Set("Content-Type", writer.FormDataContentType())
	client, err := service.GetHttpClientWithProxy("")
	if err != nil {
		return "", err
	}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("KIE file upload failed: %w", err)
	}
	defer resp.Body.Close()
	responseBody, _ := io.ReadAll(io.LimitReader(resp.Body, 512<<10))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("KIE file upload failed with status %d: %s", resp.StatusCode, strings.TrimSpace(string(responseBody)))
	}
	var result struct {
		Data struct {
			FileURL     string `json:"fileUrl"`
			DownloadURL string `json:"downloadUrl"`
			URL         string `json:"url"`
		} `json:"data"`
	}
	if err := common.Unmarshal(responseBody, &result); err != nil {
		return "", fmt.Errorf("KIE file upload returned invalid response")
	}
	value := firstNonEmptyString(result.Data.DownloadURL, result.Data.FileURL, result.Data.URL)
	if value == "" {
		return "", fmt.Errorf("KIE file upload returned no public URL")
	}
	return value, nil
}

func firstNonEmptyString(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

// DoRequest delegates to common helper.
func (a *TaskAdaptor) DoRequest(c *gin.Context, info *relaycommon.RelayInfo, requestBody io.Reader) (*http.Response, error) {
	return channel.DoTaskApiRequest(a, c, info, requestBody)
}

// DoResponse handles upstream response, returns taskID etc.
func (a *TaskAdaptor) DoResponse(c *gin.Context, resp *http.Response, info *relaycommon.RelayInfo) (taskID string, taskData []byte, taskErr *dto.TaskError) {
	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		taskErr = service.TaskErrorWrapper(err, "read_response_body_failed", http.StatusInternalServerError)
		return
	}
	_ = resp.Body.Close()

	action := taskRelayAction(info)
	if strings.HasPrefix(action, "kie-video:") {
		upstreamID, status, err := parseKIEVideoSubmitResponse(responseBody)
		if err != nil {
			taskErr = service.TaskErrorWrapper(err, "invalid_kie_video_response", resp.StatusCode)
			return
		}
		c.JSON(http.StatusOK, map[string]any{"id": info.PublicTaskID, "task_id": info.PublicTaskID, "object": "video", "status": status})
		return upstreamID, responseBody, nil
	}
	if strings.HasPrefix(action, "apimart-video:") {
		upstreamID, status, err := parseAPIMartVideoSubmitResponse(responseBody)
		if err != nil {
			taskErr = service.TaskErrorWrapper(err, "invalid_apimart_video_response", resp.StatusCode)
			return
		}
		c.JSON(http.StatusOK, map[string]any{"id": info.PublicTaskID, "task_id": info.PublicTaskID, "object": "video", "status": status})
		return upstreamID, responseBody, nil
	}

	// Parse Sora-compatible response.
	var dResp responseTask
	if err := common.Unmarshal(responseBody, &dResp); err != nil {
		taskErr = service.TaskErrorWrapper(errors.Wrapf(err, "body: %s", responseBody), "unmarshal_response_body_failed", http.StatusInternalServerError)
		return
	}

	upstreamID := dResp.ID
	if upstreamID == "" {
		upstreamID = dResp.TaskID
	}
	if upstreamID == "" {
		upstreamID = dResp.VideoID
	}
	if upstreamID == "" {
		taskErr = service.TaskErrorWrapper(fmt.Errorf("task_id is empty"), "invalid_response", http.StatusInternalServerError)
		return
	}

	// 使用公开 task_xxxx ID 返回给客户端
	dResp.ID = info.PublicTaskID
	dResp.TaskID = info.PublicTaskID
	if dResp.VideoID != "" {
		dResp.VideoID = info.PublicTaskID
	}
	c.JSON(http.StatusOK, dResp)
	return upstreamID, responseBody, nil
}

// FetchTask fetch task status
func (a *TaskAdaptor) FetchTask(baseUrl, key string, body map[string]any, proxy string) (*http.Response, error) {
	taskID, ok := body["task_id"].(string)
	if !ok {
		return nil, fmt.Errorf("invalid task_id")
	}

	uri := fmt.Sprintf("%s/v1/videos/%s", baseUrl, taskID)
	action, _ := body["action"].(string)
	switch {
	case strings.HasPrefix(action, "kie-video:"):
		uri = videoProviderURL(baseUrl, "/v1/jobs/recordInfo?taskId="+url.QueryEscape(taskID))
	case strings.HasPrefix(action, "apimart-video:"):
		uri = videoProviderURL(baseUrl, "/v1/tasks/"+url.PathEscape(taskID)+"?language=zh")
	case strings.HasPrefix(action, "agnes-video:"):
		modelName := strings.TrimPrefix(action, "agnes-video:")
		agnesBaseURL := strings.TrimRight(baseUrl, "/")
		if strings.HasSuffix(strings.ToLower(agnesBaseURL), "/v1") {
			agnesBaseURL = strings.TrimRight(agnesBaseURL[:len(agnesBaseURL)-3], "/")
		}
		uri = fmt.Sprintf("%s/agnesapi?video_id=%s&model_name=%s", agnesBaseURL, url.QueryEscape(taskID), url.QueryEscape(modelName))
	}

	req, err := http.NewRequest(http.MethodGet, uri, nil)
	if err != nil {
		return nil, err
	}

	req.Header.Set("Authorization", "Bearer "+key)

	client, err := service.GetHttpClientWithProxy(proxy)
	if err != nil {
		return nil, fmt.Errorf("new proxy http client failed: %w", err)
	}
	return client.Do(req)
}

func (a *TaskAdaptor) GetModelList() []string {
	return ModelList
}

func (a *TaskAdaptor) GetChannelName() string {
	return ChannelName
}

func (a *TaskAdaptor) ParseTaskResult(respBody []byte) (*relaycommon.TaskInfo, error) {
	if result, ok, err := parseKIEVideoTaskResult(respBody); ok || err != nil {
		return result, err
	}
	if result, ok, err := parseAPIMartVideoTaskResult(respBody); ok || err != nil {
		return result, err
	}
	resTask := responseTask{}
	if err := common.Unmarshal(respBody, &resTask); err != nil {
		return nil, errors.Wrap(err, "unmarshal task result failed")
	}

	taskResult := relaycommon.TaskInfo{
		Code: 0,
	}

	switch strings.ToLower(resTask.Status) {
	case "submitting":
		taskResult.Status = model.TaskStatusSubmitted
	case "queued", "pending":
		taskResult.Status = model.TaskStatusQueued
	case "processing", "in_progress", "enhancing":
		taskResult.Status = model.TaskStatusInProgress
	case "completed", "complete", "success", "succeeded", "done":
		taskResult.Status = model.TaskStatusSuccess
		taskResult.Url = firstNonEmptyVideoURL(resTask.VideoURL, resTask.URL, resTask.OutputURL, resTask.DownloadURL, nestedVideoURL(resTask.Data), nestedVideoURL(resTask.Result), nestedVideoURL(resTask.Output))
	case "failed", "fail", "error", "cancelled", "canceled":
		taskResult.Status = model.TaskStatusFailure
		if resTask.Error != nil {
			taskResult.Reason = resTask.Error.Message
		} else {
			taskResult.Reason = "task failed"
		}
	default:
	}
	if resTask.Progress > 0 && resTask.Progress < 100 {
		taskResult.Progress = fmt.Sprintf("%d%%", resTask.Progress)
	}

	return &taskResult, nil
}

func isKIEVideoUpstream(baseURL, modelName string) bool {
	base := strings.ToLower(strings.TrimSpace(baseURL))
	model := strings.ToLower(strings.TrimSpace(modelName))
	return strings.Contains(base, "kie.ai") || strings.Contains(base, "kieai") || strings.HasPrefix(model, "kie/") || strings.Contains(model, "wan/")
}

func taskRelayAction(info *relaycommon.RelayInfo) string {
	if info == nil || info.TaskRelayInfo == nil {
		return ""
	}
	return info.Action
}

func isAPIMartVideoUpstream(baseURL string) bool {
	base := strings.ToLower(strings.TrimSpace(baseURL))
	return strings.Contains(base, "apimart")
}

// The public compatibility envelope exposes resolution for providers such as
// APIMart and KIE. OpenAI's official Sora endpoint accepts size/seconds, but
// does not accept that provider-neutral field. Keep the richer field in the
// shared request and remove it only at this official-channel boundary.
func isOfficialSoraVideoRequest(info *relaycommon.RelayInfo) bool {
	if info == nil || info.ChannelMeta == nil {
		return false
	}
	action := taskRelayAction(info)
	if strings.HasPrefix(action, "kie-video:") || strings.HasPrefix(action, "apimart-video:") {
		return false
	}
	model := strings.ToLower(strings.TrimSpace(info.UpstreamModelName))
	return strings.Contains(model, "sora-2") || strings.Contains(model, "sora_2")
}

func isUnsupportedOfficialSoraVideoField(key string) bool {
	switch strings.ToLower(strings.TrimSpace(key)) {
	case "resolution", "duration", "generate_audio", "watermark", "quality":
		return true
	default:
		return false
	}
}

func sanitizeOfficialSoraVideoPayload(payload map[string]interface{}) {
	for key := range payload {
		if isUnsupportedOfficialSoraVideoField(key) {
			delete(payload, key)
		}
	}
}

func videoProviderURL(baseURL, path string) string {
	base := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if strings.HasSuffix(strings.ToLower(base), "/v1") && strings.HasPrefix(path, "/v1/") {
		return base + strings.TrimPrefix(path, "/v1")
	}
	return base + path
}

func buildKIEVideoRequestBody(data []byte, upstreamModel string) ([]byte, error) {
	payload := map[string]any{}
	if err := common.Unmarshal(data, &payload); err != nil {
		return nil, errors.Wrap(err, "unmarshal KIE video request failed")
	}
	modelName := taskcommon.DefaultString(upstreamModel, strings.TrimSpace(fmt.Sprint(payload["model"])))
	modelName = resolveKIEVideoModelAlias(modelName, payload)
	input := map[string]any{}
	for key, value := range payload {
		switch key {
		case "model", "metadata", "input":
			continue
		default:
			input[key] = value
		}
	}
	if nested, ok := payload["input"].(map[string]any); ok {
		for key, value := range nested {
			input[key] = value
		}
	}
	if metadata, ok := payload["metadata"].(map[string]any); ok {
		mergeVideoProviderMetadata(input, metadata)
	}
	if prompt := strings.TrimSpace(fmt.Sprint(payload["prompt"])); prompt != "" {
		input["prompt"] = prompt
	}
	if err := normalizeKIEVideoContract(modelName, payload, input); err != nil {
		return nil, err
	}
	return common.Marshal(map[string]any{"model": modelName, "input": input})
}

func sanitizeKIEVideoInput(modelName string, input map[string]any) {
	modelName = strings.ToLower(strings.TrimSpace(modelName))
	dropResolution := strings.Contains(modelName, "motion-control") || strings.Contains(modelName, "ai-avatar") || strings.Contains(modelName, "topaz/video") || strings.Contains(modelName, "kling-2.6/") || strings.Contains(modelName, "kling/v2-") || (strings.Contains(modelName, "hailuo/") && strings.Contains(modelName, "text-to-video"))
	if dropResolution {
		delete(input, "resolution")
	}
	if strings.Contains(modelName, "motion-control") {
		delete(input, "aspect_ratio")
	}
	// Most image-to-video KIE endpoints derive the output shape from the
	// source image and reject aspect_ratio. Grok's image-to-video endpoint is
	// the exception documented by the reference project and requires the
	// field, so keep it intact.
	if strings.Contains(modelName, "topaz/video") || strings.Contains(modelName, "infinitalk") || strings.Contains(modelName, "ai-avatar") || (strings.Contains(modelName, "image-to-video") && !strings.Contains(modelName, "kling-3.0-omni") && !strings.Contains(modelName, "grok-imagine/image-to-video")) {
		delete(input, "aspect_ratio")
	}
}

func buildAPIMartVideoRequestBody(data []byte, upstreamModel string) ([]byte, error) {
	payload := map[string]any{}
	if err := common.Unmarshal(data, &payload); err != nil {
		return nil, errors.Wrap(err, "unmarshal APIMart video request failed")
	}
	if metadata, ok := payload["metadata"].(map[string]any); ok {
		mergeVideoProviderMetadata(payload, metadata)
	}
	delete(payload, "metadata")
	modelName := taskcommon.DefaultString(upstreamModel, strings.TrimSpace(fmt.Sprint(payload["model"])))
	payload["model"] = modelName
	if err := normalizeAPIMartVideoContract(payload, modelName); err != nil {
		return nil, err
	}
	return common.Marshal(payload)
}

func mergeVideoProviderMetadata(target, metadata map[string]any) {
	for key, value := range metadata {
		if key == "parameters" || key == "input" {
			if nested, ok := value.(map[string]any); ok {
				mergeVideoProviderMetadata(target, nested)
			}
			continue
		}
		// Metadata is produced by the provider adapter after the shared
		// envelope is normalized, so its value must win over the original
		// compatibility field when both are present.
		target[key] = value
	}
}

func taskDurationValue(payload map[string]any) int {
	for _, key := range []string{"duration", "seconds"} {
		switch value := payload[key].(type) {
		case float64:
			if value > 0 {
				return int(value)
			}
		case int:
			if value > 0 {
				return value
			}
		case string:
			if parsed, err := strconv.Atoi(strings.TrimSpace(value)); err == nil && parsed > 0 {
				return parsed
			}
		}
	}
	return 0
}

func kieVideoDurationValue(modelName string, payload map[string]any) (any, bool) {
	duration := taskDurationValue(payload)
	if duration <= 0 {
		return nil, false
	}
	modelName = strings.ToLower(strings.TrimSpace(modelName))
	if strings.Contains(modelName, "motion-control") || strings.Contains(modelName, "ai-avatar") || strings.Contains(modelName, "topaz/video") || strings.Contains(modelName, "infinitalk") || strings.Contains(modelName, "animate-") || strings.Contains(modelName, "2-2-a14b") {
		return nil, false
	}
	numberDuration := strings.Contains(modelName, "seedance-2") || strings.Contains(modelName, "minimax-h3/") || strings.Contains(modelName, "grok-imagine-video-1-5") || strings.Contains(modelName, "happyhorse") || strings.Contains(modelName, "kling-3.0-omni/") || strings.Contains(modelName, "wan/2-7-") || strings.Contains(modelName, "wan/2-7/")
	if numberDuration {
		return duration, true
	}
	return strconv.Itoa(duration), true
}

func parseKIEVideoSubmitResponse(data []byte) (string, string, error) {
	var response struct {
		Code int    `json:"code"`
		Msg  string `json:"msg"`
		Data struct {
			TaskID string `json:"taskId"`
		} `json:"data"`
	}
	if err := common.Unmarshal(data, &response); err != nil {
		return "", "", err
	}
	if response.Code != 200 || strings.TrimSpace(response.Data.TaskID) == "" {
		return "", "", fmt.Errorf("KIE video submit failed: %s", taskcommon.DefaultString(response.Msg, "missing taskId"))
	}
	return strings.TrimSpace(response.Data.TaskID), "processing", nil
}

func parseAPIMartVideoSubmitResponse(data []byte) (string, string, error) {
	var response struct {
		Code int    `json:"code"`
		Msg  string `json:"msg"`
		Data []struct {
			TaskID string `json:"task_id"`
			Status string `json:"status"`
		} `json:"data"`
	}
	if err := common.Unmarshal(data, &response); err != nil {
		return "", "", err
	}
	if response.Code != 200 || len(response.Data) == 0 || strings.TrimSpace(response.Data[0].TaskID) == "" {
		return "", "", fmt.Errorf("APIMart video submit failed: %s", taskcommon.DefaultString(response.Msg, "missing task_id"))
	}
	return strings.TrimSpace(response.Data[0].TaskID), normalizeExternalVideoStatus(response.Data[0].Status), nil
}

func parseKIEVideoTaskResult(data []byte) (*relaycommon.TaskInfo, bool, error) {
	var response struct {
		Code int `json:"code"`
		Data struct {
			TaskID     string `json:"taskId"`
			State      string `json:"state"`
			ResultJSON any    `json:"resultJson"`
			FailCode   string `json:"failCode"`
			FailMsg    string `json:"failMsg"`
			Progress   int    `json:"progress"`
		} `json:"data"`
	}
	if err := common.Unmarshal(data, &response); err != nil {
		return nil, false, nil
	}
	if strings.TrimSpace(response.Data.TaskID) == "" {
		return nil, false, nil
	}
	result := &relaycommon.TaskInfo{TaskID: response.Data.TaskID, Progress: fmt.Sprintf("%d%%", response.Data.Progress)}
	applyExternalVideoStatus(result, response.Data.State)
	result.Url = nestedVideoURL(decodeJSONValue(response.Data.ResultJSON))
	result.Reason = taskcommon.DefaultString(response.Data.FailMsg, response.Data.FailCode)
	return result, true, nil
}

func parseAPIMartVideoTaskResult(data []byte) (*relaycommon.TaskInfo, bool, error) {
	var response struct {
		Code int `json:"code"`
		Data struct {
			ID       string         `json:"id"`
			Status   string         `json:"status"`
			Progress int            `json:"progress"`
			Result   map[string]any `json:"result"`
			Error    *struct {
				Message string `json:"message"`
			} `json:"error"`
		} `json:"data"`
	}
	if err := common.Unmarshal(data, &response); err != nil {
		return nil, false, nil
	}
	if strings.TrimSpace(response.Data.ID) == "" {
		return nil, false, nil
	}
	result := &relaycommon.TaskInfo{TaskID: response.Data.ID, Progress: fmt.Sprintf("%d%%", response.Data.Progress), Url: nestedVideoURL(response.Data.Result)}
	applyExternalVideoStatus(result, response.Data.Status)
	if response.Data.Error != nil {
		result.Reason = response.Data.Error.Message
	}
	return result, true, nil
}

func decodeJSONValue(value any) any {
	text, ok := value.(string)
	if !ok || strings.TrimSpace(text) == "" {
		return value
	}
	var decoded any
	if common.Unmarshal([]byte(text), &decoded) == nil {
		return decoded
	}
	return value
}

func normalizeExternalVideoStatus(status string) string {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "submitted", "pending", "processing", "running", "queued", "waiting", "queuing", "generating":
		return "processing"
	case "completed", "success", "succeeded", "done":
		return "completed"
	case "failed", "fail", "cancelled", "canceled", "error":
		return "failed"
	default:
		return "processing"
	}
}

func applyExternalVideoStatus(result *relaycommon.TaskInfo, status string) {
	switch normalizeExternalVideoStatus(status) {
	case "completed":
		result.Status = model.TaskStatusSuccess
	case "failed":
		result.Status = model.TaskStatusFailure
	default:
		result.Status = model.TaskStatusInProgress
	}
}

func nestedVideoURL(value any) string {
	switch item := value.(type) {
	case string:
		if strings.HasPrefix(item, "http://") || strings.HasPrefix(item, "https://") {
			return item
		}
	case []any:
		for _, child := range item {
			if result := nestedVideoURL(child); result != "" {
				return result
			}
		}
	case map[string]any:
		for _, key := range []string{"video_url", "videoUrl", "url", "output_url", "download_url", "file_url", "video", "videos", "resultUrls", "result_urls", "urls", "videoUrls", "video_urls", "data", "result", "output", "content"} {
			if result := nestedVideoURL(item[key]); result != "" {
				return result
			}
		}
	}
	return ""
}

func firstNonEmptyVideoURL(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func (a *TaskAdaptor) ConvertToOpenAIVideo(task *model.Task) ([]byte, error) {
	data := task.Data
	var err error
	if data, err = sjson.SetBytes(data, "id", task.TaskID); err != nil {
		return nil, errors.Wrap(err, "set id failed")
	}
	return data, nil
}
