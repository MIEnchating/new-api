package controller

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"maps"
	"net"
	"net/http"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"github.com/samber/lo"
	"github.com/tidwall/gjson"
)

const intelligenceOptionKey = "IntelligenceMonitorConfig"
const intelligenceTaskType = model.SystemTaskTypeIntelligenceTest

const defaultIntelligencePrompt = "请生成可直接运行的单文件HTML，使用内联SVG绘制鹈鹕骑自行车的二维循环动画。画面以鹈鹕和自行车为主体，展示清晰的身体结构、踩踏动作和车轮转动，配合协调的背景、配色与层次。动画应流畅自然、衔接连续，并适配不同屏幕尺寸。禁止依赖外部资源，只输出完整HTML，不要代码围栏或解释文字。"

type intelligenceQuestion struct {
	Name   string `json:"name"`
	Prompt string `json:"prompt"`
}

type intelligenceRetryTarget struct {
	ChannelID     *int   `json:"channel_id,omitempty"`
	QuestionIndex *int   `json:"question_index,omitempty"`
	Revision      string `json:"revision,omitempty"`
	Group         string `json:"group"`
	Model         string `json:"model"`
}

func (target intelligenceRetryTarget) Matches(row intelligenceChannelResult, config intelligenceConfig) bool {
	group, modelName := row.Group, row.Model
	if group == "" {
		group = config.Group
	}
	if modelName == "" {
		modelName = config.Model
	}
	return group == target.Group && modelName == target.Model && (target.ChannelID == nil || (row.ChannelID == *target.ChannelID && row.QuestionIndex == *target.QuestionIndex))
}

func (target intelligenceRetryTarget) Overlaps(other intelligenceRetryTarget) bool {
	return target.Group == other.Group && target.Model == other.Model && (target.ChannelID == nil || other.ChannelID == nil || (*target.ChannelID == *other.ChannelID && *target.QuestionIndex == *other.QuestionIndex))
}

type intelligenceConfig struct {
	QueuedRetries   []intelligenceRetryTarget `json:"queued_retries,omitempty"`
	Retry           *intelligenceRetryTarget  `json:"retry,omitempty"`
	Groups          []intelligenceGroup       `json:"groups,omitempty"`
	ScheduledAt     int64                     `json:"scheduled_at,omitempty"`
	Questions       []intelligenceQuestion    `json:"questions"`
	QuestionIndexes []int                     `json:"question_indexes"`
	Group           string                    `json:"group"`
	Model           string                    `json:"model"`
	Endpoint        string                    `json:"endpoint"`
	Stream          *bool                     `json:"stream,omitempty"`
	Enabled         bool                      `json:"enabled"`
	IntervalMinutes int                       `json:"interval_minutes"`
}

type intelligenceGroup struct {
	Group           string   `json:"group"`
	Model           string   `json:"model,omitempty"`
	Models          []string `json:"models,omitempty"`
	Endpoint        string   `json:"endpoint"`
	Stream          *bool    `json:"stream,omitempty"`
	Enabled         bool     `json:"enabled"`
	Times           []string `json:"times"`
	QuestionIndexes []int    `json:"question_indexes"`
}

func (config intelligenceConfig) SystemTaskScheduleKey() string {
	if config.ScheduledAt == 0 {
		return ""
	}
	return fmt.Sprintf("intelligence_schedule_%d", config.ScheduledAt)
}

func (group intelligenceGroup) SelectedModels() []string {
	if len(group.Models) > 0 {
		return group.Models
	}
	if group.Model != "" {
		return []string{group.Model}
	}
	return nil
}

func (config intelligenceConfig) ForGroup(group intelligenceGroup, modelName string) intelligenceConfig {
	return intelligenceConfig{Questions: config.Questions, QuestionIndexes: group.QuestionIndexes, Group: group.Group, Model: modelName, Endpoint: group.Endpoint, Stream: group.Stream, IntervalMinutes: 60}
}

func (config intelligenceConfig) SelectedQuestionIndexes() []int {
	if config.QuestionIndexes != nil {
		return config.QuestionIndexes
	}
	// Configurations saved before per-group selection run the entire question bank.
	indexes := make([]int, len(config.Questions))
	for i := range indexes {
		indexes[i] = i
	}
	return indexes
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
			models := group.SelectedModels()
			if len(models) == 0 || len(models) > 50 {
				return errors.New("Select between 1 and 50 models for intelligence testing")
			}
			seenModels := map[string]bool{}
			for _, modelName := range models {
				if seenModels[modelName] {
					return errors.New("Each intelligence test model must be unique within its group")
				}
				seenModels[modelName] = true
				if err := config.ForGroup(group, modelName).Validate(); err != nil {
					return err
				}
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
	indexes := config.SelectedQuestionIndexes()
	if len(indexes) == 0 || len(indexes) > len(config.Questions) {
		return errors.New("Select at least one valid, unique question for each group")
	}
	seenQuestions := make(map[int]bool, len(indexes))
	for _, index := range indexes {
		if index < 0 || index >= len(config.Questions) || seenQuestions[index] {
			return errors.New("Select at least one valid, unique question for each group")
		}
		seenQuestions[index] = true
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
	config := intelligenceConfig{Endpoint: string(constant.EndpointTypeOpenAIResponse), IntervalMinutes: 60, Questions: []intelligenceQuestion{{Name: "Pelican riding a bicycle", Prompt: defaultIntelligencePrompt}}}
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
		config.Groups = []intelligenceGroup{{Group: config.Group, Model: config.Model, Endpoint: config.Endpoint, Stream: config.Stream, Times: []string{"09:00"}, QuestionIndexes: config.QuestionIndexes}}
	}
	for i := range config.Groups {
		if len(config.Groups[i].Models) == 0 && config.Groups[i].Model != "" {
			config.Groups[i].Models = []string{config.Groups[i].Model}
		}
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
	if len(targets)*len(config.SelectedQuestionIndexes()) > 50 {
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
	history, err := intelligenceHistory(true)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{
		"config":      getIntelligenceConfig(),
		"catalog":     catalog,
		"group_order": service.OrderGroupNames(slices.Collect(maps.Keys(catalog))),
		"history":     history,
	}})
}

// Public responses are an allowlist: never serialize a system task or its payload.
func publishedIntelligenceTask(task *model.SystemTask, includeHTML bool, admin bool) (gin.H, error) {
	var config intelligenceConfig
	if err := task.DecodePayload(&config); err != nil {
		return nil, err
	}
	var progress intelligenceProgress
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
		row["retry_count"] = max(0, len(channel.Attempts)-1)
		row["revision"] = channel.Revision
		if admin {
			row["request_id"] = channel.RequestID
			row["upstream_request_id"] = channel.UpstreamRequestID
			row["channel_name"] = channel.ChannelName
			row["attempts"] = channel.Attempts
			row["http_status"] = channel.HTTPStatus
		}
		// Also sanitize historical errors, rather than trusting persisted strings.
		if channel.Error != "" {
			row["error"] = "Intelligence test request failed"
			if admin && len(channel.Attempts) > 0 {
				row["error"] = channel.Error
			}
		}
		if includeHTML && channel.HTML != "" {
			row["html"] = channel.HTML
		}
		channels = append(channels, row)
	}
	publicGroups := make([]gin.H, 0, len(config.Groups))
	for _, group := range config.Groups {
		for _, modelName := range group.SelectedModels() {
			publicGroups = append(publicGroups, gin.H{"group": group.Group, "model": modelName, "endpoint": group.Endpoint})
		}
	}
	errorMessage := ""
	if task.Error != "" {
		errorMessage = "Intelligence test request failed"
	}
	var retry *intelligenceRetryTarget
	if task.Status == model.SystemTaskStatusPending || task.Status == model.SystemTaskStatusRunning {
		if config.Retry != nil && !slices.Contains(progress.CompletedRetries, config.Retry.Revision) {
			retry = config.Retry
		}
	}
	queuedRetries := make([]intelligenceRetryTarget, 0)
	if task.Status == model.SystemTaskStatusRunning || task.Status == model.SystemTaskStatusPending {
		for _, queued := range config.QueuedRetries {
			if !slices.Contains(progress.CompletedRetries, queued.Revision) {
				queuedRetries = append(queuedRetries, queued)
			}
		}
	}
	return gin.H{"task_id": task.TaskID, "status": task.Status, "created_at": task.CreatedAt,
		"updated_at": task.UpdatedAt, "group": config.Group, "model": config.Model,
		"endpoint": config.Endpoint, "groups": publicGroups, "state": progress, "error": errorMessage, "retry": retry, "retries": queuedRetries,
		"result": gin.H{"channels": channels}}, nil
}

func intelligenceHistory(admin bool) ([]gin.H, error) {
	tasks, err := model.ListIntelligenceTestHistory()
	if err != nil {
		return nil, err
	}
	history := make([]gin.H, 0, len(tasks))
	for _, task := range tasks {
		response, err := publishedIntelligenceTask(task, false, admin)
		if err != nil {
			return nil, err
		}
		history = append(history, response)
	}
	return history, nil
}

func GetIntelligenceResults(c *gin.Context) {
	history, err := intelligenceHistory(false)
	if err != nil {
		common.ApiErrorT(c, "Intelligence test request failed")
		return
	}
	config := getIntelligenceConfig()
	groupOrder := make([]string, 0, len(config.Groups))
	for _, group := range config.Groups {
		if group.Group != "" {
			groupOrder = append(groupOrder, group.Group)
		}
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"history": history, "group_order": groupOrder}})
}

func UpdateIntelligenceMonitor(c *gin.Context) {
	var config intelligenceConfig
	if err := common.DecodeJson(http.MaxBytesReader(c.Writer, c.Request.Body, 65536), &config); err != nil {
		common.ApiErrorT(c, "Invalid intelligence test configuration")
		return
	}
	config.Retry = nil
	config.QueuedRetries = nil
	config.Group, config.Model = strings.TrimSpace(config.Group), strings.TrimSpace(config.Model)
	for i := range config.Groups {
		config.Groups[i].Group = strings.TrimSpace(config.Groups[i].Group)
		config.Groups[i].Model = strings.TrimSpace(config.Groups[i].Model)
		for j := range config.Groups[i].Models {
			config.Groups[i].Models[j] = strings.TrimSpace(config.Groups[i].Models[j])
		}
		if len(config.Groups[i].Models) == 0 && config.Groups[i].Model != "" {
			config.Groups[i].Models = []string{config.Groups[i].Model}
		}
		if len(config.Groups[i].Models) > 0 {
			config.Groups[i].Model = ""
		}
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
			for _, modelName := range group.SelectedModels() {
				if _, err := intelligenceTargets(config.ForGroup(group, modelName)); err != nil {
					common.ApiErrorT(c, err.Error())
					return
				}
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
		for _, modelName := range group.SelectedModels() {
			single := config.ForGroup(group, modelName)
			targets, err := intelligenceTargets(single)
			if err != nil {
				common.ApiErrorT(c, err.Error())
				return
			}
			total += len(targets) * len(single.SelectedQuestionIndexes())
		}
	}
	if total > 50 {
		common.ApiErrorT(c, "Intelligence testing supports at most 50 channel-question pairs per run")
		return
	}
	task, _, err := service.EnqueueSystemTask(intelligenceTaskType, config)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	recordManageAudit(c, "intelligence_monitor.run", map[string]any{"task_id": task.TaskID, "group": request.Group})
	c.JSON(http.StatusOK, gin.H{"success": true, "data": task.ToResponse()})
}

// Retry reuses the recorded payload and task identity, preserving the schedule key.
func RetryIntelligenceModel(c *gin.Context) {
	var request intelligenceRetryTarget
	if err := common.DecodeJson(http.MaxBytesReader(c.Writer, c.Request.Body, 1024), &request); err != nil {
		common.ApiErrorT(c, "Invalid intelligence test configuration")
		return
	}
	task, err := model.GetSystemTaskByTaskID(c.Param("task_id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if task == nil || task.Type != intelligenceTaskType || task.IntelligenceResultDeleted() {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "Intelligence test not found"})
		return
	}
	if task.Status != model.SystemTaskStatusSucceeded && task.Status != model.SystemTaskStatusFailed && task.Status != model.SystemTaskStatusRunning && task.Status != model.SystemTaskStatusPending {
		c.JSON(http.StatusConflict, gin.H{"success": false, "message": "This intelligence test cannot be retried"})
		return
	}
	var config intelligenceConfig
	if err := task.DecodePayload(&config); err != nil {
		common.ApiError(c, err)
		return
	}
	if len(config.Groups) == 0 {
		config.Groups = []intelligenceGroup{{Group: config.Group, Model: config.Model, Endpoint: config.Endpoint, Stream: config.Stream, QuestionIndexes: config.QuestionIndexes}}
	}
	selected := slices.IndexFunc(config.Groups, func(group intelligenceGroup) bool {
		return group.Group == request.Group && slices.Contains(group.SelectedModels(), request.Model)
	})
	if selected < 0 {
		common.ApiErrorT(c, "Select a group and model for intelligence testing")
		return
	}
	single := config.ForGroup(config.Groups[selected], request.Model)
	if err := single.Validate(); err != nil {
		common.ApiErrorT(c, err.Error())
		return
	}
	targets, err := intelligenceTargets(single)
	if err != nil {
		common.ApiErrorT(c, err.Error())
		return
	}
	var result intelligenceResult
	if task.Result != "" {
		if err := common.UnmarshalJsonStr(task.Result, &result); err != nil {
			common.ApiError(c, err)
			return
		}
	}
	if (request.ChannelID == nil) != (request.QuestionIndex == nil) || (request.ChannelID != nil && (*request.ChannelID <= 0 || *request.QuestionIndex < 0)) {
		common.ApiErrorT(c, "Invalid intelligence test configuration")
		return
	}
	if request.ChannelID != nil && !slices.ContainsFunc(result.Channels, func(row intelligenceChannelResult) bool { return request.Matches(row, config) }) {
		c.JSON(http.StatusConflict, gin.H{"success": false, "message": "This intelligence test cannot be retried"})
		return
	}
	if request.ChannelID != nil && (!slices.Contains(single.SelectedQuestionIndexes(), *request.QuestionIndex) || !slices.ContainsFunc(targets, func(channel *model.Channel) bool { return channel.Id == *request.ChannelID })) {
		common.ApiErrorT(c, "Invalid intelligence test configuration")
		return
	}
	request.Revision = common.NewRequestId()
	var changed bool
	if task.Status == model.SystemTaskStatusRunning || task.Status == model.SystemTaskStatusPending {
		var progress intelligenceProgress
		if err := task.DecodeState(&progress); err != nil {
			common.ApiError(c, err)
			return
		}
		// Legacy model-wide retries require all of that model's work to finish.
		// A row-specific retry only requires its own completed result above.
		if request.ChannelID == nil && !slices.ContainsFunc(progress.Models, func(row intelligenceModelProgress) bool {
			return row.Group == request.Group && row.Model == request.Model && row.Total > 0 && row.Processed == row.Total
		}) {
			c.JSON(http.StatusConflict, gin.H{"success": false, "message": "This intelligence test cannot be retried"})
			return
		}
		for _, queued := range config.QueuedRetries {
			if !slices.Contains(progress.CompletedRetries, queued.Revision) && queued.Overlaps(request) {
				c.JSON(http.StatusConflict, gin.H{"success": false, "message": "This intelligence test cannot be retried"})
				return
			}
		}
		config.QueuedRetries = append(config.QueuedRetries, request)
		changed, err = model.QueueIntelligenceRetry(task, config)
	} else {
		result.Channels = slices.DeleteFunc(result.Channels, func(row intelligenceChannelResult) bool { return request.Matches(row, config) })
		config.Retry = &request
		config.QueuedRetries = nil
		total := len(targets) * len(single.SelectedQuestionIndexes())
		if request.ChannelID != nil {
			total = 1
		}
		state := intelligenceProgress{Models: []intelligenceModelProgress{{Group: request.Group, Model: request.Model, Total: total}}}
		state.Total = total
		changed, err = service.RequeueIntelligenceTest(task, config, state, result)
	}
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if !changed {
		c.JSON(http.StatusConflict, gin.H{"success": false, "message": "This intelligence test cannot be retried"})
		return
	}
	recordManageAudit(c, "intelligence_monitor.retry", map[string]any{"task_id": task.TaskID, "group": request.Group, "model": request.Model})
	response, err := publishedIntelligenceTask(task, false, true)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": response})
}

type intelligenceTestHandler struct{}

func (intelligenceTestHandler) Type() string { return intelligenceTaskType }

// Daily times use Beijing time independently of the host timezone. Missed
// minutes while the server is offline are not replayed. Active runs do not block scheduling.
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

type intelligenceAttempt struct {
	RequestID         string `json:"request_id"`
	UpstreamRequestID string `json:"upstream_request_id,omitempty"`
	LatencyMs         int64  `json:"latency_ms"`
	Error             string `json:"error"`
	HTTPStatus        int    `json:"http_status,omitempty"`
}

type intelligenceChannelResult struct {
	Revision   string `json:"revision,omitempty"`
	noRetry    bool
	Attempts   []intelligenceAttempt `json:"attempts,omitempty"`
	HTTPStatus int                   `json:"http_status,omitempty"`

	RequestID         string `json:"request_id,omitempty"`
	UpstreamRequestID string `json:"upstream_request_id,omitempty"`
	Group             string `json:"group"`
	Model             string `json:"model"`
	Endpoint          string `json:"endpoint"`
	ChannelID         int    `json:"channel_id"`
	ChannelName       string `json:"channel_name"`
	QuestionIndex     int    `json:"question_index"`
	QuestionName      string `json:"question_name"`
	HTML              string `json:"html,omitempty"`
	LatencyMs         int64  `json:"latency_ms"`
	Error             string `json:"error"`
}
type intelligenceResult struct {
	Channels []intelligenceChannelResult `json:"channels"`
}

type intelligenceModelProgress struct {
	Group     string `json:"group"`
	Model     string `json:"model"`
	Total     int    `json:"total"`
	Processed int    `json:"processed"`
	Failed    int    `json:"failed"`
}

type intelligenceProgress struct {
	CompletedRetries []string `json:"completed_retries,omitempty"`
	service.SystemTaskProgress
	Models []intelligenceModelProgress `json:"models,omitempty"`
}

func GetIntelligenceTestResult(c *gin.Context) {
	task, err := model.GetSystemTaskByTaskID(c.Param("task_id"))
	if err != nil {
		common.ApiErrorT(c, "Intelligence test request failed")
		return
	}
	if task == nil || task.Type != intelligenceTaskType || task.IntelligenceResultDeleted() {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "Intelligence test not found"})
		return
	}
	response, err := publishedIntelligenceTask(task, true, false)
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
	var retained intelligenceResult
	if config.Retry != nil && task.Result != "" {
		if err := common.UnmarshalJsonStr(task.Result, &retained); err != nil {
			finishSystemTaskHandler(task, runnerID, model.SystemTaskStatusFailed, retained, err)
			return
		}
	}
	if err := config.Validate(); err != nil {
		finishSystemTaskHandler(task, runnerID, model.SystemTaskStatusFailed, retained, err)
		return
	}
	if len(config.Groups) == 0 {
		config.Groups = []intelligenceGroup{{Group: config.Group, Model: config.Model, Endpoint: config.Endpoint, Stream: config.Stream, QuestionIndexes: config.QuestionIndexes}}
	}
	type target struct {
		channel       *model.Channel
		config        intelligenceConfig
		progressIndex int
		questionIndex int
	}
	targets := []target{}
	state := intelligenceProgress{}
	for _, row := range retained.Channels {
		group, modelName := row.Group, row.Model
		if group == "" {
			group = config.Group
		}
		if modelName == "" {
			modelName = config.Model
		}
		index := slices.IndexFunc(state.Models, func(progress intelligenceModelProgress) bool {
			return progress.Group == group && progress.Model == modelName
		})
		if index < 0 {
			state.Models = append(state.Models, intelligenceModelProgress{Group: group, Model: modelName})
			index = len(state.Models) - 1
		}
		state.Models[index].Total++
		state.Models[index].Processed++
		if row.Error != "" {
			state.Models[index].Failed++
		}
	}

	for _, group := range config.Groups {
		for _, modelName := range group.SelectedModels() {
			if config.Retry != nil && (group.Group != config.Retry.Group || modelName != config.Retry.Model) {
				continue
			}
			single := config.ForGroup(group, modelName)
			channels, err := intelligenceTargets(single)
			if err != nil {
				finishSystemTaskHandler(task, runnerID, model.SystemTaskStatusFailed, retained, err)
				return
			}
			progressIndex := slices.IndexFunc(state.Models, func(progress intelligenceModelProgress) bool {
				return progress.Group == group.Group && progress.Model == modelName
			})
			if progressIndex < 0 {
				progressIndex = len(state.Models)
				state.Models = append(state.Models, intelligenceModelProgress{Group: group.Group, Model: modelName})
			}
			for _, channel := range channels {
				for _, questionIndex := range single.SelectedQuestionIndexes() {
					if config.Retry != nil && config.Retry.ChannelID != nil && (channel.Id != *config.Retry.ChannelID || questionIndex != *config.Retry.QuestionIndex) {
						continue
					}
					state.Models[progressIndex].Total++
					targets = append(targets, target{channel, single, progressIndex, questionIndex})
				}
			}
		}
	}
	if len(targets) > 50 {
		finishSystemTaskHandler(task, runnerID, model.SystemTaskStatusFailed, retained, errors.New("Intelligence testing supports at most 50 channel-question pairs per run"))
		return
	}
	if len(targets) == 0 {
		finishSystemTaskHandler(task, runnerID, model.SystemTaskStatusFailed, retained, errors.New("Intelligence test request failed"))
		return
	}
	userID, err := resolveChannelTestUserID(nil)
	if err != nil {
		finishSystemTaskHandler(task, runnerID, model.SystemTaskStatusFailed, retained, err)
		return
	}
	total := len(targets)
	offset := len(retained.Channels)
	result := intelligenceResult{Channels: append(slices.Clone(retained.Channels), make([]intelligenceChannelResult, total)...)}
	state.Total = total + offset
	state.Processed = offset
	if err := model.UpdateSystemTaskState(task.TaskID, runnerID, state); err != nil {
		return
	}
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	type requestJob struct {
		target        target
		index         int
		revision      string
		queueRevision string
		channelID     int
	}
	type completedRequest struct {
		job requestJob
		row intelligenceChannelResult
	}
	jobs := make(chan requestJob, 50)
	completed := make(chan completedRequest, 50)
	var workers sync.WaitGroup
	for range 4 {
		workers.Go(func() {
			for job := range jobs {
				if ctx.Err() != nil {
					return
				}
				selected := job.target
				var row intelligenceChannelResult
				if selected.channel == nil {
					row = intelligenceChannelResult{RequestID: common.NewRequestId(), Group: selected.config.Group, Model: selected.config.Model, Endpoint: selected.config.Endpoint, ChannelID: job.channelID, QuestionIndex: selected.questionIndex, QuestionName: selected.config.Questions[selected.questionIndex].Name, Error: "Intelligence test request failed"}
				} else {
					channel := *selected.channel
					row = retryIntelligenceRequest(ctx, time.Second, func() intelligenceChannelResult {
						return runIntelligenceRequest(ctx, &channel, userID, selected.config, selected.questionIndex)
					})
				}
				row.Revision = job.revision
				select {
				case completed <- completedRequest{job, row}:
				case <-ctx.Done():
					return
				}
			}
		})
	}
	defer func() { cancel(); close(jobs); workers.Wait() }()
	for index, selected := range targets {
		revision := ""
		if config.Retry != nil {
			revision = config.Retry.Revision
		}
		jobs <- requestJob{target: selected, index: offset + index, revision: revision, queueRevision: revision}
	}
	outstanding := total
	dirty := true
	queuedCount := 0
	retryRemaining := map[string]int{}
	if config.Retry != nil {
		retryRemaining[config.Retry.Revision] = total
	}
	ticker := time.NewTicker(200 * time.Millisecond)
	defer ticker.Stop()
	for {
		// Only this runner writes results. HTTP requests append to the payload;
		// polling lets a retry start even while all other responses are blocked.
		current, err := model.GetIntelligenceTaskExecution(task.TaskID)
		if err != nil || current == nil || current.Status != model.SystemTaskStatusRunning || current.LockedBy != runnerID {
			return
		}
		var latest intelligenceConfig
		if err := current.DecodePayload(&latest); err != nil {
			return
		}
		for _, retry := range latest.QueuedRetries[queuedCount:] {
			groupIndex := slices.IndexFunc(config.Groups, func(group intelligenceGroup) bool { return group.Group == retry.Group })
			single := config.ForGroup(config.Groups[groupIndex], retry.Model)
			channels, _ := intelligenceTargets(single)
			progressIndex := slices.IndexFunc(state.Models, func(progress intelligenceModelProgress) bool {
				return progress.Group == retry.Group && progress.Model == retry.Model
			})
			for index, row := range result.Channels {
				if !retry.Matches(row, config) {
					continue
				}
				var channel *model.Channel
				for _, candidate := range channels {
					if candidate.Id == row.ChannelID {
						channel = candidate
						break
					}
				}
				// Keep the previous result viewable until its replacement arrives.
				state.Processed--
				state.Models[progressIndex].Processed--
				if row.Error != "" {
					state.Models[progressIndex].Failed--
				}
				jobs <- requestJob{target: target{channel, single, progressIndex, row.QuestionIndex}, index: index, revision: retry.Revision, queueRevision: retry.Revision, channelID: row.ChannelID}
				outstanding++
				retryRemaining[retry.Revision]++
			}
			queuedCount++
			dirty = true
		}
		partial := intelligenceResult{Channels: make([]intelligenceChannelResult, 0, len(result.Channels))}
		valid := 0
		for i, row := range result.Channels {
			if i < offset || row.RequestID != "" {
				partial.Channels = append(partial.Channels, row)
				if row.Error == "" {
					valid++
				}
			}
		}
		if state.Total > 0 {
			state.Progress = state.Processed * 100 / state.Total
		}
		if dirty {
			if err := model.UpdateSystemTaskStateAndResult(task.TaskID, runnerID, state, partial); err != nil {
				return
			}
			dirty = false
		}
		if outstanding == 0 {
			status, message := model.SystemTaskStatusSucceeded, ""
			if valid == 0 {
				status, message = model.SystemTaskStatusFailed, "No intelligence test completed successfully"
			}
			finished, err := model.FinishIntelligenceTest(current, runnerID, status, partial, message)
			if err != nil || finished {
				return
			}
			continue // A concurrent retry won the finalization race.
		}
		select {
		case <-ctx.Done():
			finishSystemTaskHandler(task, runnerID, model.SystemTaskStatusFailed, partial, ctx.Err())
			return
		case <-ticker.C:
		case done := <-completed:
			dirty = true
			result.Channels[done.job.index] = done.row
			outstanding--
			state.Processed++
			progress := &state.Models[done.job.target.progressIndex]
			progress.Processed++
			if done.row.Error != "" {
				progress.Failed++
			}
			if done.job.queueRevision != "" {
				retryRemaining[done.job.queueRevision]--
				if retryRemaining[done.job.queueRevision] == 0 {
					state.CompletedRetries = append(state.CompletedRetries, done.job.queueRevision)
				}
			}
		}
	}
}

// Retry failed requests up to five times (six attempts total). Backoff remains
// inside the worker slot so retries cannot exceed the request concurrency limit.
func retryIntelligenceRequest(ctx context.Context, delay time.Duration, attempt func() intelligenceChannelResult) intelligenceChannelResult {
	started := time.Now()
	var row intelligenceChannelResult
	var attempts []intelligenceAttempt
	for index := range 6 {
		if ctx.Err() != nil {
			break
		}
		if index > 0 {
			timer := time.NewTimer(delay * time.Duration(1<<(index-1)))
			select {
			case <-ctx.Done():
				timer.Stop()
			case <-timer.C:
			}
			if ctx.Err() != nil {
				break
			}
		}
		row = attempt()
		attempts = append(attempts, intelligenceAttempt{RequestID: row.RequestID, UpstreamRequestID: row.UpstreamRequestID, LatencyMs: row.LatencyMs, Error: row.Error, HTTPStatus: row.HTTPStatus})
		if row.Error == "" || row.noRetry {
			break
		}
	}
	if ctx.Err() != nil {
		row.Error = "Intelligence test was cancelled"
		row.HTML = ""
	}
	row.Attempts = attempts
	row.LatencyMs = time.Since(started).Milliseconds()
	return row
}

// Persist diagnostic facts, never raw upstream messages, URLs or credentials.
func intelligenceFailureReason(ctx context.Context, response testResult, streamFailed bool) string {
	var networkError net.Error
	switch {
	case errors.Is(ctx.Err(), context.DeadlineExceeded), errors.Is(response.localErr, context.DeadlineExceeded):
		return "Intelligence test exceeded the 180-second request timeout"
	case errors.Is(ctx.Err(), context.Canceled), errors.Is(response.localErr, context.Canceled):
		return "Intelligence test was cancelled"
	case errors.As(response.localErr, &networkError) && networkError.Timeout():
		return "Upstream connection timed out"
	case response.upstreamStatus >= 400:
		return "Upstream returned an HTTP error"
	case response.streamOutcome.EndReason == relaycommon.StreamEndReasonTimeout:
		return "Upstream stream timed out while waiting for data"
	case response.streamOutcome.IncompleteReason == "max_output_tokens":
		return "Upstream reached the output token limit"
	case response.streamOutcome.IncompleteReason == "content_filter":
		return "Upstream blocked the response with a content filter"
	case response.streamOutcome.Response == relaycommon.ResponseOutcomeIncomplete:
		return "Upstream response was incomplete"
	case response.streamOutcome.HasErrors || response.streamOutcome.Response == relaycommon.ResponseOutcomeFailed:
		return "Upstream reported a stream error"
	case streamFailed:
		return "Upstream stream ended before completion"
	case response.newAPIError != nil && response.newAPIError.GetErrorCode() == types.ErrorCodeDoRequestFailed:
		return "Could not connect to the upstream service"
	case response.newAPIError != nil && response.newAPIError.GetErrorCode() == types.ErrorCodeBadResponseBody:
		return "Upstream returned an invalid response body"
	default:
		return "Intelligence test request failed"
	}
}

// Each request owns its context and result; only the coordinator persists progress.
func runIntelligenceRequest(ctx context.Context, channel *model.Channel, userID int, config intelligenceConfig, questionIndex int) (row intelligenceChannelResult) {
	question := config.Questions[questionIndex]
	row = intelligenceChannelResult{RequestID: common.NewRequestId(), Group: config.Group, Model: config.Model, Endpoint: config.Endpoint, ChannelID: channel.Id, ChannelName: channel.Name, QuestionIndex: questionIndex, QuestionName: question.Name}
	started := time.Now()
	defer func() {
		row.LatencyMs = time.Since(started).Milliseconds()
		if recover() != nil {
			row.HTML = ""
			row.Error = "Intelligence test encountered an internal error"
		}
	}()
	isStream := config.Stream == nil || *config.Stream
	requestCtx, cancel := intelligenceRequestContext(ctx, isStream)
	defer cancel()
	if requestCtx.Err() != nil {
		row.Error = intelligenceFailureReason(requestCtx, testResult{}, false)
		row.noRetry = true
		return row
	}
	response := testChannelWithProbe(requestCtx, channel, userID, config.Model, config.Endpoint, isStream, &channelTestProbe{RequestID: row.RequestID, Group: config.Group, Prompt: question.Prompt})
	if response.context != nil {
		row.UpstreamRequestID = response.context.GetString(common.UpstreamRequestIdKey)
	}
	row.HTTPStatus = response.upstreamStatus
	outcome := response.streamOutcome
	streamFailed := isStream && (outcome.HasErrors ||
		(outcome.EndReason != relaycommon.StreamEndReasonNone && outcome.EndReason != relaycommon.StreamEndReasonDone && outcome.EndReason != relaycommon.StreamEndReasonEOF && outcome.EndReason != relaycommon.StreamEndReasonHandlerStop) ||
		(outcome.Response != relaycommon.ResponseOutcomeUnknown && outcome.Response != relaycommon.ResponseOutcomeCompleted) ||
		(outcome.ExpectsTerminal && outcome.Response != relaycommon.ResponseOutcomeCompleted))
	if requestCtx.Err() != nil || response.localErr != nil || response.newAPIError != nil || streamFailed {
		// Never persist upstream errors, which may contain credentials or internal URLs.
		row.Error = intelligenceFailureReason(requestCtx, response, streamFailed)
		row.noRetry = requestCtx.Err() != nil ||
			errors.Is(response.localErr, context.DeadlineExceeded) ||
			errors.Is(response.localErr, context.Canceled)
		return row
	}
	row.HTML = extractIntelligenceOutput(response.responseBody, config.Endpoint, isStream)
	if row.HTML == "" {
		row.Error = "Intelligence test returned no output"
	} else if len(row.HTML) > 131072 {
		row.HTML = ""
		row.Error = "Intelligence test output exceeded 128 KiB"
	}
	return row
}

// Active streams use the relay's idle timeout rather than a fixed generation
// deadline. Parent cancellation still stops work when the task loses its lease.
func intelligenceRequestContext(parent context.Context, isStream bool) (context.Context, context.CancelFunc) {
	if isStream {
		return context.WithCancel(parent)
	}
	return context.WithTimeout(parent, 3*time.Minute)
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

func DeleteIntelligenceRecord(c *gin.Context) {
	deleted, err := model.DeleteIntelligenceTestResult(c.Param("task_id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if !deleted {
		common.ApiErrorT(c, "Only completed intelligence test records can be deleted")
		return
	}
	recordManageAudit(c, "intelligence_monitor.delete", map[string]any{"task_id": c.Param("task_id")})
	common.ApiSuccessT(c, "Deleted successfully", nil)
}
