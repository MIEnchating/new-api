package controller

import (
	"bytes"
	"context"
	"errors"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"github.com/samber/lo"
	"github.com/tidwall/gjson"
)

const intelligenceOptionKey = "IntelligenceMonitorConfig"
const intelligenceTaskType = "intelligence_test"

const defaultIntelligencePrompt = "请生成可直接运行的单文件HTML，使用内联SVG绘制鹈鹕骑自行车的二维循环动画。画面以鹈鹕和自行车为主体，展示清晰的身体结构、踩踏动作和车轮转动，配合协调的背景、配色与层次。动画应流畅自然、衔接连续，并适配不同屏幕尺寸。禁止依赖外部资源，只输出完整HTML，不要代码围栏或解释文字。"

type intelligenceQuestion struct {
	Name   string `json:"name"`
	Prompt string `json:"prompt"`
}

type intelligenceConfig struct {
	Groups          []intelligenceGroup    `json:"groups,omitempty"`
	ScheduledAt     int64                  `json:"scheduled_at,omitempty"`
	Questions       []intelligenceQuestion `json:"questions"`
	Group           string                 `json:"group"`
	Model           string                 `json:"model"`
	Endpoint        string                 `json:"endpoint"`
	Stream          *bool                  `json:"stream,omitempty"`
	Enabled         bool                   `json:"enabled"`
	IntervalMinutes int                    `json:"interval_minutes"`
}

type intelligenceGroup struct {
	Group    string   `json:"group"`
	Model    string   `json:"model"`
	Endpoint string   `json:"endpoint"`
	Stream   *bool    `json:"stream,omitempty"`
	Enabled  bool     `json:"enabled"`
	Times    []string `json:"times"`
}

func (config intelligenceConfig) ForGroup(group intelligenceGroup) intelligenceConfig {
	return intelligenceConfig{Questions: config.Questions, Group: group.Group, Model: group.Model, Endpoint: group.Endpoint, Stream: group.Stream, IntervalMinutes: 60}
}

func (config intelligenceConfig) Validate() error {
	if len(config.Groups) > 0 {
		if len(config.Groups) > 50 {
			return errors.New("Configure at most 50 intelligence test groups")
		}
		seen := map[string]bool{}
		for _, group := range config.Groups {
			if seen[group.Group] {
				return errors.New("Each intelligence test group must be unique")
			}
			seen[group.Group] = true
			if err := config.ForGroup(group).Validate(); err != nil {
				return err
			}
			if len(group.Times) > 24 || (group.Enabled && len(group.Times) == 0) {
				return errors.New("Choose between 1 and 24 daily execution times")
			}
			times := map[string]bool{}
			for _, value := range group.Times {
				parsed, err := time.Parse("15:04", value)
				if err != nil || parsed.Format("15:04") != value || times[value] {
					return errors.New("Execution times must be unique and use HH:mm")
				}
				times[value] = true
			}
		}
		return nil
	}
	if len(config.Questions) < 1 || len(config.Questions) > 5 {
		return errors.New("Configure between 1 and 5 intelligence test questions")
	}
	for _, question := range config.Questions {
		if strings.TrimSpace(question.Name) == "" || len(question.Name) > 120 || strings.TrimSpace(question.Prompt) == "" || len(question.Prompt) > 8000 {
			return errors.New("Each question needs a name and a prompt of at most 8000 bytes")
		}
	}

	if strings.TrimSpace(config.Group) == "" || strings.TrimSpace(config.Model) == "" || len(config.Group) > 64 || len(config.Model) > 255 {
		return errors.New("Select a group and model for intelligence testing")
	}
	if !slices.Contains([]string{string(constant.EndpointTypeOpenAI), string(constant.EndpointTypeOpenAIResponse), string(constant.EndpointTypeAnthropic), string(constant.EndpointTypeGemini)}, config.Endpoint) {
		return errors.New("Unsupported intelligence test endpoint")
	}
	if config.IntervalMinutes < 5 || config.IntervalMinutes > 10080 {
		return errors.New("Intelligence test interval must be between 5 and 10080 minutes")
	}
	return nil
}

func getIntelligenceConfig() intelligenceConfig {
	config := intelligenceConfig{Endpoint: string(constant.EndpointTypeOpenAI), IntervalMinutes: 60, Questions: []intelligenceQuestion{{Name: "Pelican riding a bicycle", Prompt: defaultIntelligencePrompt}}}
	common.OptionMapRWMutex.RLock()
	encoded := common.OptionMap[intelligenceOptionKey]
	common.OptionMapRWMutex.RUnlock()
	if encoded != "" {
		if err := common.UnmarshalJsonStr(encoded, &config); err != nil {
			config.Enabled = false
			return config
		}
	}
	if len(config.Groups) == 0 {
		config.Groups = []intelligenceGroup{{Group: config.Group, Model: config.Model, Endpoint: config.Endpoint, Stream: config.Stream, Times: []string{"09:00"}}}
	}
	for i := range config.Groups {
		if config.Groups[i].Stream == nil {
			config.Groups[i].Stream = lo.ToPtr(true)
		}
	}
	return config
}

// Restrict execution to enabled channels that actually advertise this group/model.
func intelligenceTargets(config intelligenceConfig) ([]*model.Channel, error) {
	channels, err := model.GetAllChannels(0, 0, true, true)
	if err != nil {
		return nil, err
	}
	targets := make([]*model.Channel, 0)
	for _, channel := range channels {
		if channel.Status == common.ChannelStatusEnabled && slices.Contains(channel.GetGroups(), config.Group) && slices.Contains(channel.GetModels(), config.Model) {
			targets = append(targets, channel)
		}
	}
	if len(targets) == 0 {
		return nil, errors.New("No enabled channels match the selected group and model")
	}
	if len(targets)*len(config.Questions) > 50 {
		return nil, errors.New("Intelligence testing supports at most 50 channel-question pairs per run")
	}
	return targets, nil
}

func GetIntelligenceMonitor(c *gin.Context) {
	channels, err := model.GetAllChannels(0, 0, true, true)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	catalog := map[string][]string{}
	for _, channel := range channels {
		if channel.Status != common.ChannelStatusEnabled {
			continue
		}
		for _, group := range channel.GetGroups() {
			catalog[group] = append(catalog[group], channel.GetModels()...)
		}
	}
	for group, models := range catalog {
		slices.Sort(models)
		catalog[group] = slices.Compact(models)
	}
	history, err := intelligenceHistory()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"config": getIntelligenceConfig(), "catalog": catalog, "history": history}})
}

// Public responses are an allowlist: never serialize a system task or its payload.
func publishedIntelligenceTask(task *model.SystemTask, includeHTML bool) (gin.H, error) {
	var config intelligenceConfig
	if err := task.DecodePayload(&config); err != nil {
		return nil, err
	}
	var progress service.SystemTaskProgress
	if err := task.DecodeState(&progress); err != nil {
		return nil, err
	}
	var result intelligenceResult
	if task.Result != "" {
		if err := common.UnmarshalJsonStr(task.Result, &result); err != nil {
			return nil, err
		}
	}
	channels := make([]gin.H, 0, len(result.Channels))
	for _, channel := range result.Channels {
		row := gin.H{"channel_id": channel.ChannelID, "question_index": channel.QuestionIndex,
			"question_name": channel.QuestionName, "latency_ms": channel.LatencyMs, "error": "", "group": channel.Group, "model": channel.Model, "endpoint": channel.Endpoint}
		// Also sanitize historical errors, rather than trusting persisted strings.
		if channel.Error != "" {
			row["error"] = "Intelligence test request failed"
		}
		if includeHTML && channel.HTML != "" {
			row["html"] = channel.HTML
		}
		channels = append(channels, row)
	}
	publicGroups := make([]gin.H, 0, len(config.Groups))
	for _, group := range config.Groups {
		publicGroups = append(publicGroups, gin.H{"group": group.Group, "model": group.Model, "endpoint": group.Endpoint})
	}
	errorMessage := ""
	if task.Error != "" {
		errorMessage = "Intelligence test request failed"
	}
	return gin.H{"task_id": task.TaskID, "status": task.Status, "created_at": task.CreatedAt,
		"updated_at": task.UpdatedAt, "group": config.Group, "model": config.Model,
		"endpoint": config.Endpoint, "groups": publicGroups, "state": progress, "error": errorMessage,
		"result": gin.H{"channels": channels}}, nil
}

func intelligenceHistory() ([]gin.H, error) {
	tasks, _, err := model.ListSystemTasks(model.SystemTaskFilter{Type: intelligenceTaskType}, 0, 20)
	if err != nil {
		return nil, err
	}
	history := make([]gin.H, 0, len(tasks))
	for _, task := range tasks {
		response, err := publishedIntelligenceTask(task, false)
		if err != nil {
			return nil, err
		}
		history = append(history, response)
	}
	return history, nil
}

func GetIntelligenceResults(c *gin.Context) {
	history, err := intelligenceHistory()
	if err != nil {
		common.ApiErrorT(c, "Intelligence test request failed")
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"history": history}})
}

func UpdateIntelligenceMonitor(c *gin.Context) {
	var config intelligenceConfig
	if err := common.DecodeJson(http.MaxBytesReader(c.Writer, c.Request.Body, 65536), &config); err != nil {
		common.ApiErrorT(c, "Invalid intelligence test configuration")
		return
	}
	config.Group, config.Model = strings.TrimSpace(config.Group), strings.TrimSpace(config.Model)
	for i := range config.Groups {
		config.Groups[i].Group = strings.TrimSpace(config.Groups[i].Group)
		config.Groups[i].Model = strings.TrimSpace(config.Groups[i].Model)
		if config.Groups[i].Stream == nil {
			config.Groups[i].Stream = lo.ToPtr(true)
		}
	}
	if err := config.Validate(); err != nil {
		common.ApiErrorT(c, err.Error())
		return
	}
	for _, group := range config.Groups {
		if group.Enabled {
			if _, err := intelligenceTargets(config.ForGroup(group)); err != nil {
				common.ApiErrorT(c, err.Error())
				return
			}
		}
	}
	encoded, err := common.Marshal(config)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if err := model.UpdateOptionsBulk(map[string]string{intelligenceOptionKey: string(encoded)}); err != nil {
		common.ApiError(c, err)
		return
	}
	recordManageAudit(c, "intelligence_monitor.update", map[string]any{"groups": config.Groups})
	c.JSON(http.StatusOK, gin.H{"success": true, "data": config})
}

func RunIntelligenceMonitor(c *gin.Context) {
	config := getIntelligenceConfig()
	var request struct {
		Group string `json:"group"`
	}
	if c.Request.ContentLength > 0 {
		if err := common.DecodeJson(http.MaxBytesReader(c.Writer, c.Request.Body, 1024), &request); err != nil {
			common.ApiErrorT(c, "Invalid intelligence test configuration")
			return
		}
	}
	if request.Group != "" {
		config.Groups = slices.DeleteFunc(config.Groups, func(group intelligenceGroup) bool { return group.Group != request.Group })
		if len(config.Groups) == 0 {
			common.ApiErrorT(c, "Select a group and model for intelligence testing")
			return
		}
	}
	if err := config.Validate(); err != nil {
		common.ApiErrorT(c, err.Error())
		return
	}
	total := 0
	for _, group := range config.Groups {
		targets, err := intelligenceTargets(config.ForGroup(group))
		if err != nil {
			common.ApiErrorT(c, err.Error())
			return
		}
		total += len(targets) * len(config.Questions)
	}
	if total > 50 {
		common.ApiErrorT(c, "Intelligence testing supports at most 50 channel-question pairs per run")
		return
	}
	task, created, err := service.EnqueueSystemTask(intelligenceTaskType, config)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if !created {
		common.ApiErrorT(c, "An intelligence test is already running")
		return
	}
	recordManageAudit(c, "intelligence_monitor.run", map[string]any{"task_id": task.TaskID, "group": request.Group})
	c.JSON(http.StatusOK, gin.H{"success": true, "data": task.ToResponse()})
}

type intelligenceTestHandler struct{}

func (intelligenceTestHandler) Type() string { return intelligenceTaskType }

// Daily times use Beijing time independently of the host timezone. Missed
// minutes (server offline or a previous task still active) are not replayed.
func (intelligenceTestHandler) ScheduledPayload(now time.Time) (any, bool, error) {
	config := getIntelligenceConfig()
	if config.Validate() != nil {
		return nil, false, nil
	}
	due := config.DueGroups(now)
	if len(due.Groups) == 0 {
		return nil, false, nil
	}
	var tasks []*model.SystemTask
	if err := model.DB.Where("type = ? AND created_at >= ?", intelligenceTaskType, due.ScheduledAt).Find(&tasks).Error; err != nil {
		return nil, false, err
	}
	for _, task := range tasks {
		var payload intelligenceConfig
		if err := task.DecodePayload(&payload); err != nil {
			return nil, false, err
		}
		if payload.ScheduledAt == due.ScheduledAt {
			return nil, false, nil
		}
	}
	return due, true, nil
}

func (config intelligenceConfig) DueGroups(now time.Time) intelligenceConfig {
	local := now.In(time.FixedZone("Asia/Shanghai", 8*60*60))
	due := intelligenceConfig{Questions: config.Questions, ScheduledAt: now.Truncate(time.Minute).Unix()}
	for _, group := range config.Groups {
		if group.Enabled && slices.Contains(group.Times, local.Format("15:04")) {
			due.Groups = append(due.Groups, group)
		}
	}
	return due
}

type intelligenceChannelResult struct {
	Group         string `json:"group"`
	Model         string `json:"model"`
	Endpoint      string `json:"endpoint"`
	ChannelID     int    `json:"channel_id"`
	ChannelName   string `json:"channel_name"`
	QuestionIndex int    `json:"question_index"`
	QuestionName  string `json:"question_name"`
	HTML          string `json:"html,omitempty"`
	LatencyMs     int64  `json:"latency_ms"`
	Error         string `json:"error"`
}
type intelligenceResult struct {
	Channels []intelligenceChannelResult `json:"channels"`
}

func GetIntelligenceTestResult(c *gin.Context) {
	task, err := model.GetSystemTaskByTaskID(c.Param("task_id"))
	if err != nil {
		common.ApiErrorT(c, "Intelligence test request failed")
		return
	}
	if task == nil || task.Type != intelligenceTaskType {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "Intelligence test not found"})
		return
	}
	response, err := publishedIntelligenceTask(task, true)
	if err != nil {
		common.ApiErrorT(c, "Intelligence test request failed")
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": response})
}

func (intelligenceTestHandler) Run(ctx context.Context, task *model.SystemTask, runnerID string) {
	var config intelligenceConfig
	if err := task.DecodePayload(&config); err != nil {
		finishSystemTaskHandler(task, runnerID, model.SystemTaskStatusFailed, nil, err)
		return
	}
	if err := config.Validate(); err != nil {
		finishSystemTaskHandler(task, runnerID, model.SystemTaskStatusFailed, nil, err)
		return
	}
	if len(config.Groups) == 0 {
		config.Groups = []intelligenceGroup{{Group: config.Group, Model: config.Model, Endpoint: config.Endpoint, Stream: config.Stream}}
	}
	type target struct {
		channel *model.Channel
		config  intelligenceConfig
	}
	targets := []target{}
	for _, group := range config.Groups {
		single := config.ForGroup(group)
		channels, err := intelligenceTargets(single)
		if err != nil {
			finishSystemTaskHandler(task, runnerID, model.SystemTaskStatusFailed, nil, err)
			return
		}
		for _, channel := range channels {
			targets = append(targets, target{channel, single})
		}
	}
	if len(targets)*len(config.Questions) > 50 {
		finishSystemTaskHandler(task, runnerID, model.SystemTaskStatusFailed, nil, errors.New("Intelligence testing supports at most 50 channel-question pairs per run"))
		return
	}
	userID, err := resolveChannelTestUserID(nil)
	if err != nil {
		finishSystemTaskHandler(task, runnerID, model.SystemTaskStatusFailed, nil, err)
		return
	}
	total := len(targets) * len(config.Questions)
	result := intelligenceResult{Channels: make([]intelligenceChannelResult, 0, total)}
	progress := service.NewSystemTaskProgressReporter(task, runnerID)
	progress(0, total)
	valid := 0
	for _, target := range targets {
		channel, config := target.channel, target.config
		isStream := config.Stream == nil || *config.Stream
		for questionIndex, question := range config.Questions {
			if err := ctx.Err(); err != nil {
				finishSystemTaskHandler(task, runnerID, model.SystemTaskStatusFailed, result, err)
				return
			}
			started := time.Now()
			requestCtx, cancel := context.WithTimeout(ctx, 3*time.Minute)
			response := testChannelWithProbe(requestCtx, channel, userID, config.Model, config.Endpoint, isStream, &channelTestProbe{Group: config.Group, Prompt: question.Prompt})
			cancel()
			row := intelligenceChannelResult{Group: config.Group, Model: config.Model, Endpoint: config.Endpoint, ChannelID: channel.Id, ChannelName: channel.Name, QuestionIndex: questionIndex, QuestionName: question.Name, LatencyMs: time.Since(started).Milliseconds()}
			outcome := response.streamOutcome
			streamFailed := isStream && (outcome.HasErrors ||
				(outcome.EndReason != relaycommon.StreamEndReasonNone && outcome.EndReason != relaycommon.StreamEndReasonDone && outcome.EndReason != relaycommon.StreamEndReasonEOF && outcome.EndReason != relaycommon.StreamEndReasonHandlerStop) ||
				(outcome.Response != relaycommon.ResponseOutcomeUnknown && outcome.Response != relaycommon.ResponseOutcomeCompleted) ||
				(outcome.ExpectsTerminal && outcome.Response != relaycommon.ResponseOutcomeCompleted))
			if response.localErr != nil || response.newAPIError != nil || streamFailed {
				// Upstream errors can contain credentials or internal URLs. Do not persist them.
				row.Error = "Intelligence test request failed"
			} else {
				row.HTML = extractIntelligenceOutput(response.responseBody, config.Endpoint, isStream)
				if row.HTML == "" {
					row.Error = "Intelligence test returned no output"
				} else if len(row.HTML) > 131072 {
					row.HTML = ""
					row.Error = "Intelligence test output exceeded 128 KiB"
				} else {
					valid++
				}
			}
			result.Channels = append(result.Channels, row)
			progress(len(result.Channels), total)
		}
	}

	if valid == 0 {
		finishSystemTaskHandler(task, runnerID, model.SystemTaskStatusFailed, result, errors.New("No intelligence test completed successfully"))
		return
	}
	finishSystemTaskHandler(task, runnerID, model.SystemTaskStatusSucceeded, result, nil)
}

func buildIntelligenceRequest(modelName, endpoint, prompt string, isStream bool) dto.Request {
	const tokenLimit = uint(8192)
	switch constant.EndpointType(endpoint) {
	case constant.EndpointTypeOpenAIResponse:
		input, _ := common.Marshal(prompt)
		return &dto.OpenAIResponsesRequest{Model: modelName, Input: input, MaxOutputTokens: lo.ToPtr(tokenLimit), Stream: lo.ToPtr(isStream)}
	case constant.EndpointTypeAnthropic:
		return &dto.ClaudeRequest{Model: modelName, Messages: []dto.ClaudeMessage{{Role: "user", Content: prompt}}, MaxTokens: lo.ToPtr(tokenLimit), Stream: lo.ToPtr(isStream)}
	case constant.EndpointTypeGemini:
		return &dto.GeminiChatRequest{Contents: []dto.GeminiChatContent{{Role: "user", Parts: []dto.GeminiPart{{Text: prompt}}}}, GenerationConfig: dto.GeminiChatGenerationConfig{MaxOutputTokens: lo.ToPtr(tokenLimit)}}
	default:
		request := &dto.GeneralOpenAIRequest{Model: modelName, Messages: []dto.Message{{Role: "user", Content: prompt}}, MaxCompletionTokens: lo.ToPtr(tokenLimit), Stream: lo.ToPtr(isStream)}
		if isStream {
			request.StreamOptions = &dto.StreamOptions{IncludeUsage: true}
		}
		return request
	}
}

func extractIntelligenceOutput(body []byte, endpoint string, isStream bool) string {
	var answer strings.Builder
	if isStream {
		finalAnswer := ""
		for line := range bytes.SplitSeq(body, []byte{'\n'}) {
			line = bytes.TrimSpace(line)
			payload, ok := bytes.CutPrefix(line, []byte("data:"))
			if !ok {
				continue
			}
			payload = bytes.TrimSpace(payload)
			if !gjson.ValidBytes(payload) {
				continue
			}
			event := gjson.ParseBytes(payload)
			if event.Get("error").Exists() && event.Get("error").Type != gjson.Null {
				return ""
			}
			switch constant.EndpointType(endpoint) {
			case constant.EndpointTypeOpenAIResponse:
				switch event.Get("type").String() {
				case "response.output_text.delta":
					answer.WriteString(event.Get("delta").String())
				case "response.completed", "response.done":
					finalAnswer = extractIntelligenceOutput([]byte(event.Get("response").Raw), endpoint, false)
				case "response.failed", "response.incomplete", "response.cancelled", "response.error", "error":
					return ""
				}
			case constant.EndpointTypeAnthropic:
				switch event.Get("type").String() {
				case "content_block_start":
					if event.Get("content_block.type").String() == "text" {
						answer.WriteString(event.Get("content_block.text").String())
					}
				case "content_block_delta":
					if event.Get("delta.type").String() == "text_delta" {
						answer.WriteString(event.Get("delta.text").String())
					}
				case "error":
					return ""
				}
			case constant.EndpointTypeGemini:
				for _, part := range event.Get("candidates.0.content.parts").Array() {
					if !part.Get("thought").Bool() {
						answer.WriteString(part.Get("text").String())
					}
				}
			default:
				answer.WriteString(event.Get("choices.0.delta.content").String())
			}
		}
		if finalAnswer != "" {
			return finalAnswer
		}
		return strings.TrimSpace(answer.String())
	}
	switch constant.EndpointType(endpoint) {
	case constant.EndpointTypeOpenAIResponse:
		for _, output := range gjson.GetBytes(body, "output").Array() {
			if output.Get("type").String() != "message" {
				continue
			}
			for _, part := range output.Get("content").Array() {
				if part.Get("type").String() == "output_text" {
					answer.WriteString(part.Get("text").String())
				}
			}
		}
	case constant.EndpointTypeAnthropic:
		for _, part := range gjson.GetBytes(body, "content").Array() {
			if part.Get("type").String() == "text" {
				answer.WriteString(part.Get("text").String())
			}
		}
	case constant.EndpointTypeGemini:
		for _, part := range gjson.GetBytes(body, "candidates.0.content.parts").Array() {
			if !part.Get("thought").Bool() {
				answer.WriteString(part.Get("text").String())
			}
		}
	default:
		answer.WriteString(gjson.GetBytes(body, "choices.0.message.content").String())
	}
	return strings.TrimSpace(answer.String())
}
