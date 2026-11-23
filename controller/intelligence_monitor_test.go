package controller

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/service/authz"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/tidwall/gjson"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestIntelligenceProtocolRequestsAndOutput(t *testing.T) {
	for _, tc := range []struct{ endpoint, promptPath, limitPath, body string }{
		{"openai", "messages.0.content", "max_completion_tokens", `{"choices":[{"message":{"content":"<html>custom</html>"}}]}`},
		{"openai-response", "input", "max_output_tokens", `{"output":[{"type":"reasoning","content":[{"text":"secret reasoning"}]},{"type":"message","content":[{"type":"output_text","text":"<html>custom</html>"}]}]}`},
		{"anthropic", "messages.0.content", "max_tokens", `{"content":[{"type":"thinking","thinking":"hidden"},{"type":"text","text":"<html>custom</html>"}]}`},
		{"gemini", "contents.0.parts.0.text", "generationConfig.maxOutputTokens", `{"candidates":[{"content":{"parts":[{"thought":true,"text":"hidden"},{"text":"<html>custom</html>"}]}}]}`},
	} {
		t.Run(tc.endpoint, func(t *testing.T) {
			encoded, err := common.Marshal(buildIntelligenceRequest("model", tc.endpoint, "draw a pelican", "high"))
			require.NoError(t, err)
			assert.Equal(t, "draw a pelican", gjson.GetBytes(encoded, tc.promptPath).String())
			assert.EqualValues(t, 8192, gjson.GetBytes(encoded, tc.limitPath).Int())
			switch tc.endpoint {
			case "openai":
				assert.Equal(t, "high", gjson.GetBytes(encoded, "reasoning_effort").String())
			case "openai-response":
				assert.Equal(t, "high", gjson.GetBytes(encoded, "reasoning.effort").String())
			}
			if tc.endpoint != "gemini" {
				assert.True(t, gjson.GetBytes(encoded, "stream").Bool())
			}
			assert.Equal(t, "<html>custom</html>", extractIntelligenceOutput([]byte(tc.body), tc.endpoint, false))
			assert.Empty(t, extractIntelligenceOutput([]byte(`{"error":"unavailable"}`), tc.endpoint, false))
		})
	}
}

func TestIntelligenceConfigValidation(t *testing.T) {
	valid := intelligenceConfig{Group: "default", Model: "gpt-4o-mini", Endpoint: "openai", IntervalMinutes: 60, Questions: []intelligenceQuestion{{Name: "Animation", Prompt: defaultIntelligencePrompt}}}
	require.NoError(t, valid.Validate())
	for _, change := range []func(*intelligenceConfig){
		func(c *intelligenceConfig) { c.Group = "" },
		func(c *intelligenceConfig) { c.Model = "" },
		func(c *intelligenceConfig) { c.Endpoint = "image-generation" },
		func(c *intelligenceConfig) { c.ReasoningEffort = "invalid" },
		func(c *intelligenceConfig) { c.IntervalMinutes = 4 },
		func(c *intelligenceConfig) { c.IntervalMinutes = 10081 },
		func(c *intelligenceConfig) { c.Questions = nil },
		func(c *intelligenceConfig) {
			c.Questions = []intelligenceQuestion{{Name: "x", Prompt: strings.Repeat("中", 2667)}}
		},
	} {
		config := valid
		change(&config)
		require.Error(t, config.Validate())
	}
	multi := intelligenceConfig{Groups: []intelligenceGroup{{Group: "default", Models: []string{"first", "second"}, Endpoint: "openai"}}, Questions: valid.Questions}
	require.NoError(t, multi.Validate())
	for _, models := range [][]string{nil, {"first", "first"}, {"first", ""}, {strings.Repeat("x", 256)}} {
		invalid := multi
		invalid.Groups = []intelligenceGroup{{Group: "default", Models: models, Endpoint: "openai"}}
		require.Error(t, invalid.Validate())
	}
}

func TestExternalIntelligenceMigratesLegacySettingsWithoutCredentials(t *testing.T) {
	var config intelligenceConfig
	require.NoError(t, common.UnmarshalJsonStr(`{
		"questions":[{"name":"Pelican","prompt":"Draw a pelican"}],
		"groups":[{"group":"default","models":["gpt-4o-mini"],"endpoint":"openai","mode":"external","question_indexes":[],"external_api":{"base_url":"https://other.example/v1","api_key":"upstream-secret","benchmark":"creative","reasoning_effort":"high"}}]
	}`, &config))
	require.NoError(t, config.Validate())
	single := config.ForGroup(config.Groups[0], "gpt-4o-mini")
	assert.Equal(t, "high", single.ReasoningEffort)
	assert.Equal(t, []int{0}, single.SelectedQuestionIndexes())
	encoded, err := common.Marshal(config)
	require.NoError(t, err)
	assert.NotContains(t, string(encoded), "upstream-secret")
	assert.NotContains(t, string(encoded), "other.example")
	assert.NotContains(t, string(encoded), "external_api")
}

func TestIntelligenceGroupQuestionSelection(t *testing.T) {
	for _, tc := range []struct {
		name    string
		indexes []int
		want    []int
		invalid bool
	}{
		{"legacy selects entire bank", nil, []int{0, 1}, false},
		{"subset preserves original index", []int{1}, []int{1}, false},
		{"explicit empty is rejected", []int{}, nil, true},
		{"duplicate is rejected", []int{1, 1}, nil, true},
		{"deleted question is rejected", []int{2}, nil, true},
		{"negative index is rejected", []int{-1}, nil, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			config := intelligenceConfig{
				Groups:    []intelligenceGroup{{Group: "default", Models: []string{"model"}, Endpoint: "openai", Enabled: true, Times: []string{"09:00"}, QuestionIndexes: tc.indexes}},
				Questions: []intelligenceQuestion{{Name: "First", Prompt: "First prompt"}, {Name: "Second", Prompt: "Second prompt"}},
			}
			encoded, err := common.Marshal(config)
			require.NoError(t, err)
			var decoded intelligenceConfig
			require.NoError(t, common.Unmarshal(encoded, &decoded))
			if tc.invalid {
				require.EqualError(t, decoded.Validate(), "Select at least one valid, unique question for each group")
				return
			}
			require.NoError(t, decoded.Validate())
			single := decoded.ForGroup(decoded.Groups[0], "model")
			assert.Equal(t, "low", single.ReasoningEffort)
			assert.Equal(t, tc.want, single.SelectedQuestionIndexes())
			due := decoded.DueGroups(time.Date(2026, 10, 16, 1, 0, 0, 0, time.UTC))
			require.Len(t, due.Groups, 1)
			assert.Equal(t, tc.want, due.ForGroup(due.Groups[0], "model").SelectedQuestionIndexes())
			assert.Equal(t, config.Questions, single.Questions)
		})
	}
}

func TestIntelligenceCatalogGroupOrder(t *testing.T) {
	db, _ := newAuditTestDatabase(t, "sqlite", "")
	require.NoError(t, db.AutoMigrate(&model.Channel{}, &model.SystemTask{}))
	oldDB, oldOptions := model.DB, common.OptionMap
	oldOrder := setting.GroupOrder2JSONString()
	model.DB, common.OptionMap = db, map[string]string{}
	t.Cleanup(func() {
		model.DB, common.OptionMap = oldDB, oldOptions
		require.NoError(t, setting.UpdateGroupOrderByJSONString(oldOrder))
		sqlDB, err := db.DB()
		require.NoError(t, err)
		require.NoError(t, sqlDB.Close())
	})
	require.NoError(t, db.Create(&[]model.Channel{
		{Status: common.ChannelStatusEnabled, Group: "default,vip,other", Models: "test-model"},
		{Status: common.ChannelStatusEnabled, Group: "vip", Models: "test-model"},
		{Status: common.ChannelStatusManuallyDisabled, Group: "disabled", Models: "test-model"},
	}).Error)
	for _, tc := range []struct {
		name  string
		order string
		want  []string
	}{
		{"configured order excludes unavailable groups and appends unconfigured groups", `["vip","disabled","missing","default"]`, []string{"vip", "default", "other"}},
		{"unconfigured order falls back to names", `[]`, []string{"default", "other", "vip"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			require.NoError(t, setting.UpdateGroupOrderByJSONString(tc.order))
			recorder := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(recorder)
			c.Request = httptest.NewRequest(http.MethodGet, "/api/status-monitor/intelligence", nil)
			GetIntelligenceMonitor(c)
			require.Equal(t, http.StatusOK, recorder.Code)
			var response struct {
				Success bool `json:"success"`
				Data    struct {
					GroupOrder []string `json:"group_order"`
				} `json:"data"`
			}
			require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
			require.True(t, response.Success, recorder.Body.String())
			assert.Equal(t, tc.want, response.Data.GroupOrder)
		})
	}
	common.OptionMap[intelligenceOptionKey] = `{"groups":[{"group":"other"},{"group":"vip"},{"group":"default"}],"questions":[{"name":"private","prompt":"private prompt"}]}`
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/status-monitor/intelligence/results", nil)
	GetIntelligenceResults(c)
	require.Equal(t, http.StatusOK, recorder.Code)
	require.True(t, gjson.GetBytes(recorder.Body.Bytes(), "success").Bool())
	assert.JSONEq(t, `["other","vip","default"]`, gjson.GetBytes(recorder.Body.Bytes(), "data.group_order").Raw)
	assert.NotContains(t, recorder.Body.String(), "private prompt")

}

// Uses real engines and isolated databases; no production tables are touched.
func TestIntelligenceMonitorDatabase(t *testing.T) {
	oldStreamTimeout := constant.StreamingTimeout
	constant.StreamingTimeout = 30
	t.Cleanup(func() { constant.StreamingTimeout = oldStreamTimeout })
	require.NoError(t, i18n.Init())
	oldRatios := ratio_setting.ModelRatio2JSONString()
	require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(`{"gpt-4o-mini":0.15}`))
	t.Cleanup(func() { require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(oldRatios)) })

	dialect := os.Getenv("TEST_INTELLIGENCE_DIALECT")
	if dialect == "" {
		dialect = "sqlite"
	}
	db := newIntelligenceTestDatabase(t, dialect)
	require.NoError(t, db.AutoMigrate(&model.Option{}, &model.Channel{}, &model.User{}, &model.Log{}, &model.AuditLog{}, &model.SystemTask{}, &model.SystemTaskLock{}, &model.Token{}))
	oldDB, oldLogDB := model.DB, model.LOG_DB
	oldMain, oldLog := common.MainDatabaseType(), common.LogDatabaseType()
	oldRedis, oldMemory, oldConsume := common.RedisEnabled, common.MemoryCacheEnabled, common.LogConsumeEnabled
	oldOptions := common.OptionMap
	model.DB, model.LOG_DB = db, db
	common.SetDatabaseTypes(common.DatabaseType(dialect), common.DatabaseType(dialect))
	common.RedisEnabled, common.MemoryCacheEnabled, common.LogConsumeEnabled = false, false, false
	common.OptionMap = map[string]string{}
	t.Cleanup(func() {
		model.DB, model.LOG_DB = oldDB, oldLogDB
		common.SetDatabaseTypes(oldMain, oldLog)
		common.RedisEnabled, common.MemoryCacheEnabled, common.LogConsumeEnabled = oldRedis, oldMemory, oldConsume
		common.OptionMap = oldOptions
	})
	require.NoError(t, db.Create(&model.User{Id: 1, Username: "intelligence-test", Role: common.RoleRootUser, Status: common.UserStatusEnabled, Group: "default", Quota: 1000000}).Error)
	output := "<!DOCTYPE html><html><body><svg viewBox=\"0 0 10 10\">" + strings.Repeat("<!-- frame -->", 900) + "</svg></body></html>"
	var streamRequests, highEffortRequests atomic.Int32
	var failRequests atomic.Int32
	var arrivals atomic.Int32
	var blockSecondQuestion atomic.Bool
	releaseQuestion := make(chan struct{})
	unblockQuestion := sync.OnceFunc(func() { close(releaseQuestion) })
	var checkParallel atomic.Bool
	checkParallel.Store(true)
	releaseRequests := make(chan struct{})
	var responseTerminal atomic.Value
	responseTerminal.Store("response.failed")
	releaseSecondModel := make(chan struct{})
	unblockSecondModel := sync.OnceFunc(func() { close(releaseSecondModel) })
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if checkParallel.Load() {
			if arrivals.Add(1) == 4 {
				close(releaseRequests)
			}
			select {
			case <-releaseRequests:
			case <-time.After(5 * time.Second):
				assert.Fail(t, "two runs with two requests each must execute concurrently")
				w.WriteHeader(http.StatusGatewayTimeout)
				return
			}
		}
		if failRequests.Add(-1) >= 0 {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusServiceUnavailable)
			fmt.Fprint(w, `{"error":{"message":"private credential test-secret","type":"server_error"}}`)
			return
		}
		var request map[string]any
		if !assert.NoError(t, common.DecodeJson(r.Body, &request)) {
			w.WriteHeader(400)
			return
		}
		if request["model"] == "second-model" {
			select {
			case <-releaseSecondModel:
			case <-r.Context().Done():
				return
			}
		}
		if r.URL.Path == "/v1/responses" {
			assert.Equal(t, true, request["stream"])
			w.Header().Set("Content-Type", "text/event-stream")
			text, _ := common.Marshal(output)
			fmt.Fprintf(w, "data: {\"type\":\"response.output_text.delta\",\"delta\":%s}\n\n", text)
			switch responseTerminal.Load().(string) {
			case "response.completed":
				fmt.Fprintf(w, "data: {\"type\":\"response.completed\",\"response\":{\"status\":\"completed\",\"output\":[{\"type\":\"message\",\"content\":[{\"type\":\"output_text\",\"text\":%s}]}],\"usage\":{\"input_tokens\":10,\"output_tokens\":20,\"total_tokens\":30}}}\n\n", text)
			case "response.failed":
				fmt.Fprint(w, "data: {\"type\":\"response.failed\",\"response\":{\"status\":\"failed\",\"error\":{\"type\":\"server_error\",\"message\":\"upstream failed\"}}}\n\n")
			}
			return
		}
		assert.Equal(t, "/v1/chat/completions", r.URL.Path)
		encoded, err := common.Marshal(request)
		require.NoError(t, err)
		responseOutput := output
		prompt := gjson.GetBytes(encoded, "messages.0.content").String()
		switch prompt {
		case "first selection prompt":
			responseOutput = "<html>first selection</html>"
		case "second selection prompt":
			if blockSecondQuestion.Load() {
				select {
				case <-releaseQuestion:
				case <-r.Context().Done():
					return
				}
			}
			responseOutput = "<html>second selection</html>"
		default:
			assert.Equal(t, defaultIntelligencePrompt, prompt)
		}
		assert.Equal(t, true, request["stream"])
		streamRequests.Add(1)
		if request["reasoning_effort"] == "high" {
			highEffortRequests.Add(1)
		}
		w.Header().Set("Content-Type", "text/event-stream")
		for _, part := range []string{responseOutput[:len(responseOutput)/2], responseOutput[len(responseOutput)/2:]} {
			text, _ := common.Marshal(part)
			fmt.Fprintf(w, "data: {\"id\":\"test\",\"model\":\"gpt-4o-mini\",\"choices\":[{\"index\":0,\"delta\":{\"content\":%s}}]}\n\n", text)
			w.(http.Flusher).Flush()
		}
		fmt.Fprint(w, "data: {\"id\":\"test\",\"model\":\"gpt-4o-mini\",\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":10,\"completion_tokens\":20,\"total_tokens\":30}}\n\ndata: [DONE]\n\n")
	}))
	t.Cleanup(upstream.Close)
	t.Cleanup(unblockSecondModel)
	t.Cleanup(unblockQuestion)
	url := upstream.URL
	channels := []model.Channel{
		{Id: 1, Type: constant.ChannelTypeOpenAI, Key: "test-secret", Name: "selected", Status: common.ChannelStatusEnabled, Group: "default,vip", Models: "gpt-4o-mini", BaseURL: &url},
		{Id: 2, Type: constant.ChannelTypeOpenAI, Key: "other-secret", Name: "other-group", Status: common.ChannelStatusEnabled, Group: "other", Models: "gpt-4o-mini"},
		{Id: 3, Type: constant.ChannelTypeOpenAI, Name: "disabled", Status: common.ChannelStatusManuallyDisabled, Group: "vip", Models: "gpt-4o-mini"},
	}
	require.NoError(t, db.Create(&channels).Error)
	config := intelligenceConfig{Groups: []intelligenceGroup{{Group: "vip", Model: "gpt-4o-mini", Endpoint: "openai", Enabled: true, ReasoningEffort: "high", Times: []string{"09:00", "15:00"}}, {Group: "default", Model: "gpt-4o-mini", Endpoint: "openai", Times: []string{"21:00"}}}, Questions: []intelligenceQuestion{{Name: "Pelican", Prompt: defaultIntelligencePrompt}}}
	call := func(handler gin.HandlerFunc, method string, body any) *httptest.ResponseRecorder {
		encoded, err := common.Marshal(body)
		require.NoError(t, err)
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Request = httptest.NewRequest(method, "/api/status-monitor/intelligence", bytes.NewReader(encoded))
		c.Set("id", 1)
		c.Set("role", common.RoleRootUser)
		handler(c)
		return w
	}
	retryCall := func(taskID string, target any) *httptest.ResponseRecorder {
		recorder := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(recorder)
		encoded, err := common.Marshal(target)
		require.NoError(t, err)
		c.Request = httptest.NewRequest(http.MethodPost, "/api/status-monitor/intelligence/results/"+taskID+"/retry", bytes.NewReader(encoded))
		c.Params = gin.Params{{Key: "task_id", Value: taskID}}
		c.Set("id", 1)
		RetryIntelligenceModel(c)
		return recorder
	}
	saved := call(UpdateIntelligenceMonitor, http.MethodPut, config)
	require.True(t, gjson.GetBytes(saved.Body.Bytes(), "success").Bool(), saved.Body.String())
	config = getIntelligenceConfig()
	assert.Equal(t, []string{"gpt-4o-mini"}, config.Groups[0].Models)
	var stored model.Option
	require.NoError(t, db.First(&stored, model.Option{Key: intelligenceOptionKey}).Error)
	var persisted intelligenceConfig
	require.NoError(t, common.UnmarshalJsonStr(stored.Value, &persisted))
	assert.Equal(t, config, persisted)
	handler := intelligenceTestHandler{}
	now := time.Date(2026, 10, 10, 1, 0, 15, 0, time.UTC)
	payload, due, err := handler.ScheduledPayload(now)
	require.NoError(t, err)
	require.True(t, due)
	assert.Len(t, payload.(intelligenceConfig).Groups, 1)
	targets, err := intelligenceTargets(config.ForGroup(config.Groups[0], config.Groups[0].SelectedModels()[0]))
	require.NoError(t, err)
	require.Len(t, targets, 1)
	assert.Equal(t, 1, targets[0].Id)
	queued := call(RunIntelligenceMonitor, http.MethodPost, nil)
	require.True(t, gjson.GetBytes(queued.Body.Bytes(), "success").Bool(), queued.Body.String())
	duplicate := call(RunIntelligenceMonitor, http.MethodPost, nil)
	require.True(t, gjson.GetBytes(duplicate.Body.Bytes(), "success").Bool())
	task, err := model.GetSystemTaskByTaskID(gjson.GetBytes(queued.Body.Bytes(), "data.task_id").String())
	require.NoError(t, err)
	require.NotNil(t, task)
	claimed, ok, err := model.ClaimSystemTask(task.ID, task.Type, "test-runner", time.Now().Add(time.Minute).Unix())
	require.NoError(t, err)
	require.True(t, ok)
	second, err := model.GetSystemTaskByTaskID(gjson.GetBytes(duplicate.Body.Bytes(), "data.task_id").String())
	require.NoError(t, err)
	require.NotEqual(t, task.TaskID, second.TaskID)
	second, ok, err = model.ClaimSystemTask(second.ID, second.Type, "second-runner", time.Now().Add(time.Minute).Unix())
	require.NoError(t, err)
	require.True(t, ok)
	var runs sync.WaitGroup
	runs.Go(func() { handler.Run(context.Background(), claimed, "test-runner") })
	runs.Go(func() { handler.Run(context.Background(), second, "second-runner") })
	runs.Wait()
	checkParallel.Store(false)
	second, err = model.GetSystemTaskByTaskID(second.TaskID)
	require.NoError(t, err)
	require.Equal(t, model.SystemTaskStatusSucceeded, second.Status, second.Result)

	finished, err := model.GetSystemTaskByTaskID(task.TaskID)
	require.NoError(t, err)
	require.Equal(t, model.SystemTaskStatusSucceeded, finished.Status, finished.Error+finished.Result)
	assert.EqualValues(t, 4, streamRequests.Load())
	assert.EqualValues(t, 2, highEffortRequests.Load())
	assert.Equal(t, output, gjson.Get(finished.Result, "channels.0.html").String())
	assert.Equal(t, "Pelican", gjson.Get(finished.Result, "channels.0.question_name").String())
	assert.Len(t, gjson.Get(finished.Result, "channels").Array(), 2)
	firstRequestID := gjson.Get(finished.Result, "channels.0.request_id").String()
	secondRequestID := gjson.Get(finished.Result, "channels.1.request_id").String()
	require.NotEmpty(t, firstRequestID)
	require.NotEmpty(t, secondRequestID)
	assert.NotEqual(t, firstRequestID, secondRequestID)
	assert.Equal(t, "vip", gjson.Get(finished.Result, "channels.0.group").String())
	assert.Equal(t, "default", gjson.Get(finished.Result, "channels.1.group").String())
	checkParallel.Store(false)
	require.NoError(t, db.Model(&channels[0]).Update("models", "gpt-4o-mini,second-model").Error)
	multi := intelligenceConfig{Groups: []intelligenceGroup{{Group: "vip", Models: []string{"gpt-4o-mini", "second-model"}, Endpoint: "openai", Times: []string{"09:00"}}}, Questions: config.Questions}
	updated := call(UpdateIntelligenceMonitor, http.MethodPut, multi)
	require.True(t, gjson.GetBytes(updated.Body.Bytes(), "success").Bool(), updated.Body.String())
	assert.Equal(t, multi.Groups[0].Models, getIntelligenceConfig().Groups[0].Models)
	queuedMulti := call(RunIntelligenceMonitor, http.MethodPost, map[string]string{"group": "vip"})
	require.True(t, gjson.GetBytes(queuedMulti.Body.Bytes(), "success").Bool(), queuedMulti.Body.String())
	multiTask, err := model.GetSystemTaskByTaskID(gjson.GetBytes(queuedMulti.Body.Bytes(), "data.task_id").String())
	require.NoError(t, err)
	multiTask, ok, err = model.ClaimSystemTask(multiTask.ID, multiTask.Type, "multi-runner", time.Now().Add(time.Minute).Unix())
	require.NoError(t, err)
	require.True(t, ok)
	multiFinished := make(chan struct{})
	go func() {
		handler.Run(context.Background(), multiTask, "multi-runner")
		close(multiFinished)
	}()
	t.Cleanup(func() {
		unblockSecondModel()
		<-multiFinished
	})
	// One model must publish completion while the other upstream is still blocked.
	require.Eventually(t, func() bool {
		active, err := model.GetSystemTaskByTaskID(multiTask.TaskID)
		if err != nil {
			return false
		}
		return gjson.Get(active.State, "models.0.processed").Int() == 1
	}, 5*time.Second, 10*time.Millisecond)
	active, err := model.GetSystemTaskByTaskID(multiTask.TaskID)
	require.NoError(t, err)
	activePublic, err := publishedIntelligenceTask(active, false, false)
	require.NoError(t, err)
	activeJSON, err := common.Marshal(activePublic)
	require.NoError(t, err)
	assert.Equal(t, model.SystemTaskStatusRunning, active.Status)
	assert.EqualValues(t, 1, gjson.GetBytes(activeJSON, "state.models.0.processed").Int())
	assert.EqualValues(t, 0, gjson.GetBytes(activeJSON, "state.models.1.processed").Int())
	assert.EqualValues(t, 50, gjson.GetBytes(activeJSON, "state.progress").Int())
	assert.EqualValues(t, 1, gjson.GetBytes(activeJSON, "result.channels.#").Int())
	assert.Equal(t, "gpt-4o-mini", gjson.GetBytes(activeJSON, "result.channels.0.model").String())
	assert.False(t, gjson.GetBytes(activeJSON, "result.channels.0.html").Exists())
	assert.False(t, gjson.GetBytes(activeJSON, "result.channels.0.request_id").Exists())
	activePreview, err := publishedIntelligenceTask(active, true, false)
	require.NoError(t, err)
	previewJSON, err := common.Marshal(activePreview)
	require.NoError(t, err)
	assert.Equal(t, output, gjson.GetBytes(previewJSON, "result.channels.0.html").String())

	// Completed subrequests can be retried and previewed while a sibling is blocked.
	oldRequestID := gjson.Get(active.Result, "channels.0.request_id").String()
	rowTarget := map[string]any{"group": "vip", "model": "gpt-4o-mini", "channel_id": 1, "question_index": 0}
	assert.Equal(t, http.StatusConflict, retryCall(multiTask.TaskID, map[string]any{"group": "vip", "model": "second-model", "channel_id": 1, "question_index": 0}).Code)
	queuedPartial := retryCall(multiTask.TaskID, rowTarget)
	require.True(t, gjson.GetBytes(queuedPartial.Body.Bytes(), "success").Bool(), queuedPartial.Body.String())
	assert.Equal(t, http.StatusConflict, retryCall(multiTask.TaskID, rowTarget).Code)
	ended, err := model.FinishIntelligenceTest(active, "multi-runner", model.SystemTaskStatusSucceeded, intelligenceResult{}, "")
	require.NoError(t, err)
	assert.False(t, ended, "a stale completion must not discard an accepted retry")
	require.Eventually(t, func() bool {
		current, err := model.GetSystemTaskByTaskID(multiTask.TaskID)
		return err == nil && current.Status == model.SystemTaskStatusRunning && gjson.Get(current.Result, "channels.0.request_id").String() != oldRequestID
	}, 5*time.Second, 10*time.Millisecond)
	partial, err := model.GetSystemTaskByTaskID(multiTask.TaskID)
	require.NoError(t, err)
	assert.Equal(t, output, gjson.Get(partial.Result, "channels.0.html").String())
	assert.EqualValues(t, 0, gjson.Get(partial.State, "models.1.processed").Int())
	unblockSecondModel()
	<-multiFinished
	multiTask, err = model.GetSystemTaskByTaskID(multiTask.TaskID)
	require.NoError(t, err)
	require.Equal(t, model.SystemTaskStatusSucceeded, multiTask.Status, multiTask.Error)
	assert.EqualValues(t, 1, gjson.Get(multiTask.State, "models.1.processed").Int())
	assert.EqualValues(t, 100, gjson.Get(multiTask.State, "progress").Int())
	assert.Equal(t, "gpt-4o-mini", gjson.Get(multiTask.Result, "channels.0.model").String())
	assert.Equal(t, "second-model", gjson.Get(multiTask.Result, "channels.1.model").String())
	publicMulti, err := publishedIntelligenceTask(multiTask, false, false)
	require.NoError(t, err)
	assert.Equal(t, []gin.H{{"group": "vip", "model": "gpt-4o-mini", "endpoint": "openai"}, {"group": "vip", "model": "second-model", "endpoint": "openai"}}, publicMulti["groups"])

	t.Run("a completed question can retry while another question of the same model runs", func(t *testing.T) {
		blockSecondQuestion.Store(true)
		defer blockSecondQuestion.Store(false)
		cfg := intelligenceConfig{Groups: []intelligenceGroup{{Group: "vip", Models: []string{"gpt-4o-mini"}, Endpoint: "openai"}}, Questions: []intelligenceQuestion{{Name: "First", Prompt: "first selection prompt"}, {Name: "Second", Prompt: "second selection prompt"}}}
		queued, err := model.CreateSystemTask(intelligenceTaskType, cfg, nil)
		require.NoError(t, err)
		claimed, acquired, err := model.ClaimSystemTask(queued.ID, queued.Type, "question-runner", time.Now().Add(time.Minute).Unix())
		require.NoError(t, err)
		require.True(t, acquired)
		done := make(chan struct{})
		go func() { handler.Run(context.Background(), claimed, "question-runner"); close(done) }()
		defer func() { unblockQuestion(); <-done }()
		require.Eventually(t, func() bool {
			task, err := model.GetSystemTaskByTaskID(queued.TaskID)
			return err == nil && gjson.Get(task.Result, "channels.#").Int() == 1
		}, 5*time.Second, 10*time.Millisecond)
		original, err := model.GetSystemTaskByTaskID(queued.TaskID)
		require.NoError(t, err)
		requestID := gjson.Get(original.Result, "channels.0.request_id").String()
		target := map[string]any{"group": "vip", "model": "gpt-4o-mini", "channel_id": 1, "question_index": 0}
		assert.Equal(t, http.StatusConflict, retryCall(queued.TaskID, map[string]string{"group": "vip", "model": "gpt-4o-mini"}).Code)
		response := retryCall(queued.TaskID, target)
		require.True(t, gjson.GetBytes(response.Body.Bytes(), "success").Bool(), response.Body.String())
		require.Eventually(t, func() bool {
			task, err := model.GetSystemTaskByTaskID(queued.TaskID)
			return err == nil && gjson.Get(task.Result, "channels.0.request_id").String() != requestID
		}, 5*time.Second, 10*time.Millisecond)
		active, err := model.GetSystemTaskByTaskID(queued.TaskID)
		require.NoError(t, err)
		assert.Equal(t, model.SystemTaskStatusRunning, active.Status)
		assert.Equal(t, "<html>first selection</html>", gjson.Get(active.Result, "channels.0.html").String())
		assert.EqualValues(t, 1, gjson.Get(active.State, "models.0.processed").Int())
		assert.EqualValues(t, 2, gjson.Get(active.State, "models.0.total").Int())
		unblockQuestion()
		<-done
		finished, err := model.GetSystemTaskByTaskID(queued.TaskID)
		require.NoError(t, err)
		assert.Equal(t, model.SystemTaskStatusSucceeded, finished.Status)
		assert.Equal(t, "<html>second selection</html>", gjson.Get(finished.Result, "channels.1.html").String())
		secondID := gjson.Get(finished.Result, "channels.1.request_id").String()
		// The same row-specific contract also applies to an already finished run.
		require.True(t, gjson.GetBytes(retryCall(queued.TaskID, target).Body.Bytes(), "success").Bool())
		claimed, acquired, err = model.ClaimSystemTask(queued.ID, queued.Type, "finished-question-runner", time.Now().Add(time.Minute).Unix())
		require.NoError(t, err)
		require.True(t, acquired)
		handler.Run(context.Background(), claimed, "finished-question-runner")
		finished, err = model.GetSystemTaskByTaskID(queued.TaskID)
		require.NoError(t, err)
		assert.Equal(t, model.SystemTaskStatusSucceeded, finished.Status)
		assert.EqualValues(t, 2, gjson.Get(finished.Result, "channels.#").Int())
		assert.Equal(t, secondID, gjson.Get(finished.Result, "channels.0.request_id").String())
		assert.EqualValues(t, 2, gjson.Get(finished.State, "models.0.processed").Int())
		// Completed siblings are independently retryable even before the runner claims the batch.
		require.True(t, gjson.GetBytes(retryCall(queued.TaskID, target).Body.Bytes(), "success").Bool())
		secondTarget := map[string]any{"group": "vip", "model": "gpt-4o-mini", "channel_id": 1, "question_index": 1}
		require.True(t, gjson.GetBytes(retryCall(queued.TaskID, secondTarget).Body.Bytes(), "success").Bool())
		assert.Equal(t, http.StatusConflict, retryCall(queued.TaskID, secondTarget).Code)
		claimed, acquired, err = model.ClaimSystemTask(queued.ID, queued.Type, "pending-question-runner", time.Now().Add(time.Minute).Unix())
		require.NoError(t, err)
		require.True(t, acquired)
		handler.Run(context.Background(), claimed, "pending-question-runner")
		finished, err = model.GetSystemTaskByTaskID(queued.TaskID)
		require.NoError(t, err)
		assert.Equal(t, model.SystemTaskStatusSucceeded, finished.Status)
		assert.NotEqual(t, secondID, gjson.Get(finished.Result, "channels.0.request_id").String())
		assert.EqualValues(t, 2, gjson.Get(finished.State, "models.0.processed").Int())
	})

	t.Run("retry replaces only the recorded model and rejects duplicate or invalid retries", func(t *testing.T) {
		var original intelligenceResult
		require.NoError(t, common.UnmarshalJsonStr(multiTask.Result, &original))
		require.Len(t, original.Channels, 2)
		originalID, originalCreatedAt := multiTask.TaskID, multiTask.CreatedAt
		// A failed model can be retried using its recorded prompt even after settings change.
		original.Channels[0].Error, original.Channels[0].HTML = "Intelligence test request failed", ""
		encoded, err := common.Marshal(original)
		require.NoError(t, err)
		require.NoError(t, db.Model(&model.SystemTask{}).Where("task_id = ?", multiTask.TaskID).Update("result", string(encoded)).Error)
		common.OptionMap[intelligenceOptionKey] = `{"groups":[],"questions":[]}`

		for _, target := range []any{map[string]string{"group": "vip", "model": "missing"}, map[string]string{"group": "default", "model": "gpt-4o-mini"}, map[string]string{}} {
			response := retryCall(originalID, target)
			assert.False(t, gjson.GetBytes(response.Body.Bytes(), "success").Bool(), response.Body.String())
		}
		target := map[string]string{"group": "vip", "model": "gpt-4o-mini"}
		queued := retryCall(originalID, target)
		require.True(t, gjson.GetBytes(queued.Body.Bytes(), "success").Bool(), queued.Body.String())
		assert.Equal(t, originalID, gjson.GetBytes(queued.Body.Bytes(), "data.task_id").String())
		assert.Equal(t, "pending", gjson.GetBytes(queued.Body.Bytes(), "data.status").String())
		assert.NotContains(t, queued.Body.String(), defaultIntelligencePrompt)
		require.NotEmpty(t, gjson.GetBytes(queued.Body.Bytes(), "data.retry.revision").String())
		duplicate := retryCall(originalID, target)
		assert.Equal(t, http.StatusConflict, duplicate.Code)
		pending, err := model.GetSystemTaskByTaskID(originalID)
		require.NoError(t, err)
		var pendingResult intelligenceResult
		require.NoError(t, common.UnmarshalJsonStr(pending.Result, &pendingResult))
		assert.Equal(t, original.Channels[1:], pendingResult.Channels)
		claimed, acquired, err := model.ClaimSystemTask(pending.ID, intelligenceTaskType, "model-retry", time.Now().Add(time.Minute).Unix())
		require.NoError(t, err)
		require.True(t, acquired)
		assert.Equal(t, http.StatusConflict, retryCall(originalID, target).Code)
		beforeRequests := streamRequests.Load()
		handler.Run(context.Background(), claimed, "model-retry")
		finished, err := model.GetSystemTaskByTaskID(originalID)
		require.NoError(t, err)
		require.Equal(t, model.SystemTaskStatusSucceeded, finished.Status, finished.Error)
		assert.EqualValues(t, 1, streamRequests.Load()-beforeRequests)
		assert.Equal(t, originalCreatedAt, finished.CreatedAt)
		var replaced intelligenceResult
		require.NoError(t, common.UnmarshalJsonStr(finished.Result, &replaced))
		require.Len(t, replaced.Channels, 2)
		assert.Equal(t, original.Channels[1], replaced.Channels[0])
		assert.Equal(t, "gpt-4o-mini", replaced.Channels[1].Model)
		assert.Equal(t, output, replaced.Channels[1].HTML)
		assert.Empty(t, replaced.Channels[1].Error)
		assert.NotEqual(t, original.Channels[0].RequestID, replaced.Channels[1].RequestID)
		// A stale snapshot cannot overwrite the completed retry or erase a deletion.
		changed, err := model.RequeueIntelligenceTest(multiTask, multi, nil, nil)
		require.NoError(t, err)
		assert.False(t, changed)
		// Failure before any new output still preserves the other model's result.
		require.True(t, gjson.GetBytes(retryCall(originalID, target).Body.Bytes(), "success").Bool())
		pending, err = model.GetSystemTaskByTaskID(originalID)
		require.NoError(t, err)
		claimed, acquired, err = model.ClaimSystemTask(pending.ID, intelligenceTaskType, "retry-unavailable", time.Now().Add(time.Minute).Unix())
		require.NoError(t, err)
		require.True(t, acquired)
		require.NoError(t, db.Model(&channels[0]).Update("status", common.ChannelStatusManuallyDisabled).Error)
		handler.Run(context.Background(), claimed, "retry-unavailable")
		require.NoError(t, db.Model(&channels[0]).Update("status", common.ChannelStatusEnabled).Error)
		failed, err := model.GetSystemTaskByTaskID(originalID)
		require.NoError(t, err)
		assert.Equal(t, model.SystemTaskStatusFailed, failed.Status)
		require.NoError(t, common.UnmarshalJsonStr(failed.Result, &replaced))
		assert.Equal(t, original.Channels[1:], replaced.Channels)
		deleted, err := model.DeleteIntelligenceTestResult(originalID)
		require.NoError(t, err)
		require.True(t, deleted)
		assert.Equal(t, http.StatusNotFound, retryCall(originalID, target).Code)
		changed, err = model.RequeueIntelligenceTest(failed, multi, nil, nil)
		require.NoError(t, err)
		assert.False(t, changed)
		assert.Equal(t, http.StatusNotFound, retryCall("missing", target).Code)
	})

	restored := call(UpdateIntelligenceMonitor, http.MethodPut, config)
	require.True(t, gjson.GetBytes(restored.Body.Bytes(), "success").Bool(), restored.Body.String())
	failRequests.Store(5)
	recovered := retryIntelligenceRequest(context.Background(), 0, func() intelligenceChannelResult {
		return runIntelligenceRequest(context.Background(), &channels[0], 1, config.ForGroup(config.Groups[1], config.Groups[1].SelectedModels()[0]), 0)
	})
	require.Len(t, recovered.Attempts, 6)
	assert.Empty(t, recovered.Error)
	assert.Equal(t, output, recovered.HTML)
	ids := map[string]bool{}
	for i, attempt := range recovered.Attempts {
		assert.False(t, ids[attempt.RequestID])
		ids[attempt.RequestID] = true
		if i < 5 {
			assert.Equal(t, http.StatusServiceUnavailable, attempt.HTTPStatus)
			assert.Equal(t, "Upstream returned an HTTP error", attempt.Error)
		}
	}
	serialized, err := common.Marshal(recovered)
	require.NoError(t, err)
	assert.NotContains(t, string(serialized), "test-secret")
	failRequests.Store(0)
	expiredRequest, cancelExpired := context.WithDeadline(context.Background(), time.Unix(1, 0))
	defer cancelExpired()
	deadlineAttempts := 0
	deadlineResult := retryIntelligenceRequest(context.Background(), 0, func() intelligenceChannelResult {
		deadlineAttempts++
		return runIntelligenceRequest(expiredRequest, &channels[0], 1, config.ForGroup(config.Groups[1], config.Groups[1].SelectedModels()[0]), 0)
	})
	assert.Equal(t, 1, deadlineAttempts, "local deadlines must not start five more upstream requests")
	require.Len(t, deadlineResult.Attempts, 1)
	assert.Equal(t, "Upstream connection timed out", deadlineResult.Error)
	scheduled, err := model.CreateSystemTask(intelligenceTaskType, payload, nil)
	require.NoError(t, err)
	_, due, err = handler.ScheduledPayload(now.Add(10 * time.Second))
	require.NoError(t, err)
	assert.False(t, due)
	_, claimedSchedule, err := model.ClaimSystemTask(scheduled.ID, scheduled.Type, "schedule-runner", time.Now().Add(time.Minute).Unix())
	require.NoError(t, err)
	require.True(t, claimedSchedule)
	require.NoError(t, model.FinishSystemTask(scheduled.TaskID, "schedule-runner", model.SystemTaskStatusSucceeded, nil, ""))
	_, err = model.CreateSystemTask(intelligenceTaskType, payload, nil)
	require.Error(t, err, "a completed scheduled run must still deduplicate concurrent schedulers")

	_, due, err = handler.ScheduledPayload(now.Add(20 * time.Second))
	require.NoError(t, err)
	assert.False(t, due)
	_, due, err = handler.ScheduledPayload(now.Add(24 * time.Hour))
	require.NoError(t, err)
	assert.True(t, due)
	history := call(GetIntelligenceMonitor, http.MethodGet, nil)
	assert.True(t, gjson.GetBytes(history.Body.Bytes(), "success").Bool())
	assert.NotContains(t, history.Body.String(), "test-secret")
	assert.Contains(t, history.Body.String(), firstRequestID)
	assert.Contains(t, history.Body.String(), secondRequestID)
	assert.False(t, gjson.GetBytes(history.Body.Bytes(), "data.history.0.result.channels.0.html").Exists())
	publicHistory := call(GetIntelligenceResults, http.MethodGet, nil)
	assert.NotContains(t, publicHistory.Body.String(), firstRequestID)
	assert.NotContains(t, publicHistory.Body.String(), "attempts")
	assert.Contains(t, history.Body.String(), "attempts")
	assert.NotContains(t, publicHistory.Body.String(), secondRequestID)
	assert.True(t, gjson.GetBytes(publicHistory.Body.Bytes(), "success").Bool())
	assert.False(t, gjson.GetBytes(publicHistory.Body.Bytes(), "data.config").Exists())
	assert.False(t, gjson.GetBytes(publicHistory.Body.Bytes(), "data.catalog").Exists())
	assert.False(t, gjson.GetBytes(publicHistory.Body.Bytes(), "data.history.0.payload").Exists())
	assert.False(t, gjson.GetBytes(publicHistory.Body.Bytes(), "data.history.0.result.channels.0.html").Exists())
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Params = gin.Params{{Key: "task_id", Value: task.TaskID}}
	GetIntelligenceTestResult(c)
	assert.Equal(t, output, gjson.GetBytes(w.Body.Bytes(), "data.result.channels.0.html").String())
	assert.False(t, gjson.GetBytes(w.Body.Bytes(), "data.payload").Exists())
	assert.False(t, gjson.GetBytes(w.Body.Bytes(), "data.locked_by").Exists())
	assert.False(t, gjson.GetBytes(w.Body.Bytes(), "data.result.channels.0.channel_name").Exists())
	assert.NotContains(t, w.Body.String(), defaultIntelligencePrompt)
	assert.NotContains(t, w.Body.String(), firstRequestID)
	// A cancelled scheduled run fails without issuing another upstream request.
	next, err := model.CreateSystemTask(intelligenceTaskType, config, nil)
	require.NoError(t, err)
	next, ok, err = model.ClaimSystemTask(next.ID, next.Type, "test-runner", time.Now().Add(time.Minute).Unix())
	require.NoError(t, err)
	require.True(t, ok)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	handler.Run(ctx, next, "test-runner")
	next, err = model.GetSystemTaskByTaskID(next.TaskID)
	require.NoError(t, err)
	assert.Equal(t, model.SystemTaskStatusFailed, next.Status)
	single := call(RunIntelligenceMonitor, http.MethodPost, map[string]string{"group": "default"})
	require.True(t, gjson.GetBytes(single.Body.Bytes(), "success").Bool(), single.Body.String())
	assert.Equal(t, "default", gjson.GetBytes(single.Body.Bytes(), "data.payload.groups.0.group").String())
	assert.Len(t, gjson.GetBytes(single.Body.Bytes(), "data.payload.groups").Array(), 1)
	missing := call(RunIntelligenceMonitor, http.MethodPost, map[string]string{"group": "missing"})
	assert.False(t, gjson.GetBytes(missing.Body.Bytes(), "success").Bool())
	config.Groups[0].Enabled = false
	require.True(t, gjson.GetBytes(call(UpdateIntelligenceMonitor, http.MethodPut, config).Body.Bytes(), "success").Bool())
	_, due, err = handler.ScheduledPayload(now)
	require.NoError(t, err)
	assert.False(t, due)

	// Full Responses output survives the log cap; partial output without success must never be published.
	for _, terminal := range []string{"response.completed", "response.failed", "missing"} {
		responseTerminal.Store(terminal)
		streamConfig := intelligenceConfig{Groups: []intelligenceGroup{{Group: "vip", Model: "gpt-4o-mini", Endpoint: "openai-response"}}, Questions: config.Questions}
		streamTask, err := model.CreateSystemTask(intelligenceTaskType, streamConfig, nil)
		require.NoError(t, err)
		streamTask, ok, err = model.ClaimSystemTask(streamTask.ID, streamTask.Type, "stream-runner", time.Now().Add(time.Minute).Unix())
		require.NoError(t, err)
		require.True(t, ok)
		handler.Run(context.Background(), streamTask, "stream-runner")
		streamTask, err = model.GetSystemTaskByTaskID(streamTask.TaskID)
		require.NoError(t, err)
		if terminal == "response.completed" {
			assert.Equal(t, model.SystemTaskStatusSucceeded, streamTask.Status, streamTask.Result)
			assert.Equal(t, output, gjson.Get(streamTask.Result, "channels.0.html").String())
			assert.Greater(t, gjson.Get(streamTask.Result, "channels.0.tokens_per_second").Float(), float64(0))
			assert.False(t, gjson.Get(streamTask.Result, "channels.0.average_tps").Bool())
		} else {
			assert.Equal(t, model.SystemTaskStatusFailed, streamTask.Status)
			assert.Empty(t, gjson.Get(streamTask.Result, "channels.0.html").String())
		}
	}

	// Persist selections and execute only the requested question/channel pairs.
	selectedConfig := intelligenceConfig{
		Questions: []intelligenceQuestion{{Name: "First", Prompt: "first selection prompt"}, {Name: "Second", Prompt: "second selection prompt"}},
		Groups: []intelligenceGroup{
			{Group: "vip", Models: []string{"gpt-4o-mini"}, Endpoint: "openai", QuestionIndexes: []int{1}},
			{Group: "default", Models: []string{"gpt-4o-mini"}, Endpoint: "openai", QuestionIndexes: []int{0, 1}},
		},
	}
	selectedSave := call(UpdateIntelligenceMonitor, http.MethodPut, selectedConfig)
	require.True(t, gjson.GetBytes(selectedSave.Body.Bytes(), "success").Bool(), selectedSave.Body.String())
	selectedRun := call(RunIntelligenceMonitor, http.MethodPost, nil)
	require.True(t, gjson.GetBytes(selectedRun.Body.Bytes(), "success").Bool(), selectedRun.Body.String())
	selectedTask, err := model.GetSystemTaskByTaskID(gjson.GetBytes(selectedRun.Body.Bytes(), "data.task_id").String())
	require.NoError(t, err)
	selectedTask, ok, err = model.ClaimSystemTask(selectedTask.ID, selectedTask.Type, "selection-runner", time.Now().Add(time.Minute).Unix())
	require.NoError(t, err)
	require.True(t, ok)
	beforeSelected := streamRequests.Load()
	handler.Run(context.Background(), selectedTask, "selection-runner")
	selectedTask, err = model.GetSystemTaskByTaskID(selectedTask.TaskID)
	require.NoError(t, err)
	require.Equal(t, model.SystemTaskStatusSucceeded, selectedTask.Status, selectedTask.Result)
	assert.EqualValues(t, 3, streamRequests.Load()-beforeSelected)
	var selectedResult intelligenceResult
	require.NoError(t, common.UnmarshalJsonStr(selectedTask.Result, &selectedResult))
	require.Len(t, selectedResult.Channels, 3)
	assert.Equal(t, "vip", selectedResult.Channels[0].Group)
	assert.Equal(t, 1, selectedResult.Channels[0].QuestionIndex)
	assert.Equal(t, "Second", selectedResult.Channels[0].QuestionName)
	assert.Equal(t, "<html>second selection</html>", selectedResult.Channels[0].HTML)
	assert.Equal(t, "default", selectedResult.Channels[1].Group)
	assert.Equal(t, 0, selectedResult.Channels[1].QuestionIndex)
	assert.Equal(t, "<html>first selection</html>", selectedResult.Channels[1].HTML)
	assert.Equal(t, 1, selectedResult.Channels[2].QuestionIndex)
	assert.Equal(t, "<html>second selection</html>", selectedResult.Channels[2].HTML)
	var selectedProgress intelligenceProgress
	require.NoError(t, common.UnmarshalJsonStr(selectedTask.State, &selectedProgress))
	assert.Equal(t, 3, selectedProgress.Total)
	assert.Equal(t, 3, selectedProgress.Processed)
	require.Len(t, selectedProgress.Models, 2)
	assert.Equal(t, 1, selectedProgress.Models[0].Total)
	assert.Equal(t, 1, selectedProgress.Models[0].Processed)
	assert.Equal(t, 2, selectedProgress.Models[1].Total)
	assert.Equal(t, 2, selectedProgress.Models[1].Processed)

	// The 50-pair limit counts selected questions, including totals across groups.
	limitChannels := make([]model.Channel, 26)
	for i := range limitChannels {
		limitChannels[i] = model.Channel{Id: 100 + i, Status: common.ChannelStatusEnabled, Group: "limit-a,limit-b", Models: "gpt-4o-mini"}
	}
	require.NoError(t, db.Create(&limitChannels).Error)
	limitConfig := intelligenceConfig{
		Questions: selectedConfig.Questions,
		Groups: []intelligenceGroup{
			{Group: "limit-a", Models: []string{"gpt-4o-mini"}, Endpoint: "openai", QuestionIndexes: []int{0}},
			{Group: "limit-b", Models: []string{"gpt-4o-mini"}, Endpoint: "openai", QuestionIndexes: []int{1}},
		},
	}
	limitSave := call(UpdateIntelligenceMonitor, http.MethodPut, limitConfig)
	require.True(t, gjson.GetBytes(limitSave.Body.Bytes(), "success").Bool(), limitSave.Body.String())
	allowed := call(RunIntelligenceMonitor, http.MethodPost, map[string]string{"group": "limit-a"})
	assert.True(t, gjson.GetBytes(allowed.Body.Bytes(), "success").Bool(), allowed.Body.String())
	rejected := call(RunIntelligenceMonitor, http.MethodPost, nil)
	assert.False(t, gjson.GetBytes(rejected.Body.Bytes(), "success").Bool())
	assert.Equal(t, "Intelligence testing supports at most 50 channel-question pairs per run", gjson.GetBytes(rejected.Body.Bytes(), "message").String())
	limitTask, err := model.CreateSystemTask(intelligenceTaskType, limitConfig, nil)
	require.NoError(t, err)
	limitTask, ok, err = model.ClaimSystemTask(limitTask.ID, limitTask.Type, "limit-runner", time.Now().Add(time.Minute).Unix())
	require.NoError(t, err)
	require.True(t, ok)
	beforeLimit := streamRequests.Load()
	handler.Run(context.Background(), limitTask, "limit-runner")
	limitTask, err = model.GetSystemTaskByTaskID(limitTask.TaskID)
	require.NoError(t, err)
	assert.Equal(t, model.SystemTaskStatusFailed, limitTask.Status)
	assert.Equal(t, beforeLimit, streamRequests.Load())

	// Anonymous visitors and ordinary accounts can only read published results.
	require.NoError(t, model.EnsureLegacyAccessTokenRetireAt(time.Now().Unix()))
	user := model.User{Id: 2, Username: "viewer", AffCode: "viewer", Role: common.RoleCommonUser, Status: common.UserStatusEnabled, Group: "default", AuthVersion: 1}
	user.SetAccessToken("intelligence-viewer-test-token")
	require.NoError(t, db.Create(&user).Error)
	engine := gin.New()
	engine.GET("/api/status-monitor/intelligence/results", middleware.HeaderNavModulePublicOrUserAuth("siteStatus"), GetIntelligenceResults)
	engine.GET("/api/status-monitor/intelligence/results/:task_id", middleware.HeaderNavModulePublicOrUserAuth("siteStatus"), GetIntelligenceTestResult)
	engine.GET("/api/status-monitor/intelligence", middleware.AdminAuth(), middleware.RequirePermission(authz.ChannelOperate), GetIntelligenceMonitor)
	engine.PUT("/api/status-monitor/intelligence", middleware.AdminAuth(), middleware.RequirePermission(authz.ChannelOperate), UpdateIntelligenceMonitor)
	engine.POST("/api/status-monitor/intelligence/run", middleware.AdminAuth(), middleware.RequirePermission(authz.ChannelOperate), RunIntelligenceMonitor)
	engine.POST("/api/status-monitor/intelligence/results/:task_id/retry", middleware.AdminAuth(), middleware.RequirePermission(authz.ChannelOperate), RetryIntelligenceModel)
	engine.DELETE("/api/status-monitor/intelligence/results/:task_id", middleware.AdminAuth(), middleware.RequirePermission(authz.ChannelOperate), DeleteIntelligenceRecord)
	for _, authenticated := range []bool{false, true} {
		for _, route := range []struct {
			method, path string
			public       bool
		}{
			{http.MethodGet, "/api/status-monitor/intelligence/results", true},
			{http.MethodGet, "/api/status-monitor/intelligence/results/" + task.TaskID, true},
			{http.MethodGet, "/api/status-monitor/intelligence", false},
			{http.MethodPut, "/api/status-monitor/intelligence", false},
			{http.MethodPost, "/api/status-monitor/intelligence/run", false},
			{http.MethodPost, "/api/status-monitor/intelligence/results/" + task.TaskID + "/retry", false},
			{http.MethodDelete, "/api/status-monitor/intelligence/results/" + task.TaskID, false},
		} {
			request := httptest.NewRequest(route.method, route.path, nil)
			if authenticated {
				request.Header.Set("Authorization", "Bearer intelligence-viewer-test-token")
			}
			recorder := httptest.NewRecorder()
			engine.ServeHTTP(recorder, request)
			want := http.StatusUnauthorized
			if authenticated {
				want = http.StatusForbidden
			}
			if route.public {
				want = http.StatusOK
			}
			assert.Equal(t, want, recorder.Code, "%s %s authenticated=%v: %s", route.method, route.path, authenticated, recorder.Body.String())
		}
	}

	t.Run("Manxue uses a temporary Responses key for the selected benchmark", func(t *testing.T) {
		common.OptionMap["ServerAddress"] = "https://gateway.example"
		t.Cleanup(func() { delete(common.OptionMap, "ServerAddress") })
		router := gin.New()
		accepted := func(c *gin.Context) {
			assert.Equal(t, "default", common.GetContextKeyString(c, constant.ContextKeyUsingGroup))
			c.Status(http.StatusNoContent)
		}
		router.Use(func(c *gin.Context) { defer common.CleanupBodyStorage(c); c.Next() })
		router.POST("/v1/responses", middleware.TokenAuth(), accepted)
		router.GET("/v1/responses", middleware.TokenAuth(), accepted)
		router.GET("/v1/models", middleware.TokenAuthReadOnly(), accepted)
		useKey := func(method, path, key, modelName string) int {
			w := httptest.NewRecorder()
			r := httptest.NewRequest(method, path, strings.NewReader(fmt.Sprintf(`{"model":%q}`, modelName)))
			r.Header.Set("Content-Type", "application/json")
			r.Header.Set("Authorization", "Bearer "+key)
			router.ServeHTTP(w, r)
			return w.Code
		}
		keys := make(chan string, 4)
		var fail atomic.Bool
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			switch r.Method + " " + r.URL.Path {
			case "POST /api/v1/tests":
				var payload map[string]any
				if !assert.NoError(t, common.DecodeJson(r.Body, &payload)) {
					w.WriteHeader(http.StatusBadRequest)
					return
				}
				assert.Equal(t, "candy", payload["benchmark"])
				assert.Equal(t, "high", payload["reasoning_effort"])
				assert.Equal(t, "https://gateway.example/v1", payload["base_url"])
				assert.NotContains(t, payload, "public")
				assert.NotContains(t, payload, "html")
				key, _ := payload["api_key"].(string)
				keys <- key
				if !assert.True(t, strings.HasPrefix(key, "sk-"+model.ManxueTestTokenPrefix)) {
					w.WriteHeader(http.StatusBadRequest)
					return
				}
				assert.Equal(t, http.StatusNoContent, useKey(http.MethodPost, "/v1/responses", key, "gpt-4o-mini"))
				assert.Equal(t, http.StatusForbidden, useKey(http.MethodPost, "/v1/responses", key, "other-model"))
				assert.Equal(t, http.StatusForbidden, useKey(http.MethodPost, "/v1/responses", key+"-1", "gpt-4o-mini"))
				assert.Equal(t, http.StatusForbidden, useKey(http.MethodGet, "/v1/responses", key, "gpt-4o-mini"))
				assert.Equal(t, http.StatusUnauthorized, useKey(http.MethodGet, "/v1/models", key, "gpt-4o-mini"))
				if fail.Load() {
					w.WriteHeader(http.StatusServiceUnavailable)
					return
				}
				_, _ = io.WriteString(w, `{"id":"task-id","benchmark":"candy","status":"running"}`)
			case "GET /api/v1/tests/task-id":
				_, _ = io.WriteString(w, `{"id":"task-id","benchmark":"candy","status":"succeeded","candy":{"status":"passed","answer":"21","duration_ms":2100,"output_tokens":21}}`)
			default:
				w.WriteHeader(http.StatusNotFound)
			}
		}))
		t.Cleanup(server.Close)
		previousURL, previousClient, previousPollInterval := manxueTestAPI, manxueHTTPClient, manxuePollInterval
		manxueTestAPI, manxueHTTPClient, manxuePollInterval = server.URL+"/api/v1/tests", server.Client(), time.Millisecond
		t.Cleanup(func() {
			manxueTestAPI, manxueHTTPClient, manxuePollInterval = previousURL, previousClient, previousPollInterval
		})
		external := config.Groups[1]
		external.Mode = "external"
		external.Benchmark = "candy"
		external.ReasoningEffort = "high"
		external.Enabled = true
		updated := call(UpdateIntelligenceMonitor, http.MethodPut, intelligenceConfig{Groups: []intelligenceGroup{external}, Questions: config.Questions})
		require.True(t, gjson.GetBytes(updated.Body.Bytes(), "success").Bool(), updated.Body.String())
		for _, failing := range []bool{false, true} {
			fail.Store(failing)
			queued := call(RunIntelligenceMonitor, http.MethodPost, nil)
			require.True(t, gjson.GetBytes(queued.Body.Bytes(), "success").Bool(), queued.Body.String())
			taskID := gjson.GetBytes(queued.Body.Bytes(), "data.task_id").String()
			task, err := model.GetSystemTaskByTaskID(taskID)
			require.NoError(t, err)
			require.NotNil(t, task)
			task, acquired, err := model.ClaimSystemTask(task.ID, task.Type, "manxue-runner", time.Now().Add(time.Minute).Unix())
			require.NoError(t, err)
			require.True(t, acquired)
			handler.Run(context.Background(), task, "manxue-runner")
			task, err = model.GetSystemTaskByTaskID(taskID)
			require.NoError(t, err)
			if failing {
				assert.Equal(t, model.SystemTaskStatusFailed, task.Status)
			} else {
				assert.Equal(t, model.SystemTaskStatusSucceeded, task.Status, task.Result)
				assert.Equal(t, "21", gjson.Get(task.Result, "channels.0.external_result.answer").String())
				assert.InDelta(t, 10, gjson.Get(task.Result, "channels.0.tokens_per_second").Float(), 0.01)
				assert.True(t, gjson.Get(task.Result, "channels.0.average_tps").Bool())
			}
			select {
			case key := <-keys:
				assert.Equal(t, http.StatusUnauthorized, useKey(http.MethodPost, "/v1/responses", key, "gpt-4o-mini"))
				assert.NotContains(t, task.Payload, key)
				assert.NotContains(t, task.Result, key)
			default:
				t.Fatal("expected a Manxue request")
			}
		}
		expired := model.Token{UserId: 1, Key: model.ManxueTestTokenPrefix + strings.Repeat("x", 48), Name: "expired fixture", Status: common.TokenStatusEnabled, Group: "default", ExpiredTime: common.GetTimestamp(), ModelLimitsEnabled: true, ModelLimits: "gpt-4o-mini", UnlimitedQuota: true}
		require.NoError(t, expired.Insert())
		assert.Equal(t, http.StatusUnauthorized, useKey(http.MethodPost, "/v1/responses", "sk-"+expired.Key, "gpt-4o-mini"))
	})

	// Execution slots limit concurrency across independent runners. Extra tasks stay queued.
	var slotTasks []*model.SystemTask
	for index := range 5 {
		queuedTask, err := model.CreateSystemTask(intelligenceTaskType, config, nil)
		require.NoError(t, err)
		slotTasks = append(slotTasks, queuedTask)
		_, acquired, err := model.ClaimSystemTask(queuedTask.ID, queuedTask.Type, fmt.Sprintf("slot-runner-%d", index), time.Now().Add(time.Minute).Unix())
		require.NoError(t, err)
		assert.Equal(t, index < 4, acquired)
	}
	require.NoError(t, model.RenewSystemTaskLock(slotTasks[1].TaskID, "slot-runner-1", time.Now().Add(2*time.Minute).Unix()))
	require.NoError(t, model.FinishSystemTask(slotTasks[0].TaskID, "slot-runner-0", model.SystemTaskStatusSucceeded, nil, ""))
	_, acquired, err := model.ClaimSystemTask(slotTasks[4].ID, intelligenceTaskType, "queued-runner", time.Now().Add(time.Minute).Unix())
	require.NoError(t, err)
	require.True(t, acquired, "a released slot must admit queued work")
	require.NoError(t, db.Model(&model.SystemTaskLock{}).Where("task_id = ?", slotTasks[1].TaskID).Update("locked_until", time.Now().Add(-time.Minute).Unix()).Error)
	require.NoError(t, model.ExpireStaleSystemTaskLocks(time.Now().Unix()))
	expired, err := model.GetSystemTaskByTaskID(slotTasks[1].TaskID)
	require.NoError(t, err)
	assert.Equal(t, model.SystemTaskStatusFailed, expired.Status)
	require.ErrorIs(t, model.UpdateSystemTaskState(expired.TaskID, "slot-runner-1", nil), model.ErrSystemTaskLockLost)
	live, err := model.GetSystemTaskByTaskID(slotTasks[2].TaskID)
	require.NoError(t, err)
	assert.Equal(t, model.SystemTaskStatusRunning, live.Status, "expiring one slot must not affect another")
	for _, tc := range []struct {
		name     string
		status   model.SystemTaskStatus
		taskType string
		allowed  bool
	}{
		{"success", model.SystemTaskStatusSucceeded, intelligenceTaskType, true},
		{"failure", model.SystemTaskStatusFailed, intelligenceTaskType, true},
		{"pending", model.SystemTaskStatusPending, intelligenceTaskType, false},
		{"running", model.SystemTaskStatusRunning, intelligenceTaskType, false},
		{"other", model.SystemTaskStatusSucceeded, "other", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			task := model.SystemTask{TaskID: tc.name, Type: tc.taskType, Status: tc.status, Payload: `{"scheduled_at":123}`, Result: `{"channels":[{"html":"private generated content","request_id":"request-123"}]}`, Error: "old error"}
			require.NoError(t, db.Create(&task).Error)
			deleted, err := model.DeleteIntelligenceTestResult(task.TaskID)
			require.NoError(t, err)
			assert.Equal(t, tc.allowed, deleted)
			stored, err := model.GetSystemTaskByTaskID(task.TaskID)
			require.NoError(t, err)
			assert.Equal(t, task.Payload, stored.Payload, "preserve schedule deduplication payload")
			if !tc.allowed {
				assert.Equal(t, task.Result, stored.Result)
				return
			}
			assert.Empty(t, stored.Error)
			assert.NotContains(t, stored.Result, "private generated content")
			assert.NotContains(t, stored.Result, "request-123")
			deleted, err = model.DeleteIntelligenceTestResult(task.TaskID)
			require.NoError(t, err)
			assert.False(t, deleted)
			history, err := model.ListIntelligenceTestHistory()
			require.NoError(t, err)
			for _, row := range history {
				assert.NotEqual(t, task.TaskID, row.TaskID)
			}
			recorder := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(recorder)
			c.Params = gin.Params{{Key: "task_id", Value: task.TaskID}}
			GetIntelligenceTestResult(c)
			assert.Equal(t, http.StatusNotFound, recorder.Code)
		})
	}
	deleted, err := model.DeleteIntelligenceTestResult("missing")
	require.NoError(t, err)
	assert.False(t, deleted)
}

func newIntelligenceTestDatabase(t *testing.T, dialect string) *gorm.DB {
	t.Helper()
	dsn := os.Getenv("TEST_" + strings.ToUpper(dialect) + "_DSN")
	db, _ := newAuditTestDatabase(t, dialect, dsn)
	if dialect != "sqlite" {
		databaseName := db.Migrator().CurrentDatabase()
		t.Cleanup(func() {
			sqlDB, err := db.DB()
			require.NoError(t, err)
			require.NoError(t, sqlDB.Close())
			var driver gorm.Dialector = postgres.Open(dsn)
			if dialect == "mysql" {
				driver = mysql.Open(dsn)
			}
			admin, err := gorm.Open(driver, &gorm.Config{})
			require.NoError(t, err)
			require.NoError(t, admin.Exec("DROP DATABASE "+databaseName).Error)
			connection, err := admin.DB()
			require.NoError(t, err)
			require.NoError(t, connection.Close())
		})
	}
	var version string
	query := "SELECT version()"
	if dialect == "sqlite" {
		query = "SELECT sqlite_version()"
	}
	require.NoError(t, db.Raw(query).Scan(&version).Error)
	t.Logf("database: %s %s", dialect, version)
	return db
}

func TestIntelligenceHistoryRetention(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			if dialect != "sqlite" && os.Getenv("TEST_"+strings.ToUpper(dialect)+"_DSN") == "" {
				t.Skip("database DSN is not configured")
			}
			db := newIntelligenceTestDatabase(t, dialect)
			require.NoError(t, db.AutoMigrate(&model.SystemTask{}, &model.SystemTaskLock{}))
			oldDB := model.DB
			model.DB = db
			t.Cleanup(func() { model.DB = oldDB })
			now := time.Now().Truncate(time.Minute)
			create := func(id string, status model.SystemTaskStatus, config intelligenceConfig, channels ...intelligenceChannelResult) {
				t.Helper()
				encoded, err := common.Marshal(config)
				require.NoError(t, err)
				result, err := common.Marshal(intelligenceResult{Channels: channels})
				require.NoError(t, err)
				require.NoError(t, db.Create(&model.SystemTask{
					TaskID: id, Type: intelligenceTaskType, Status: status,
					Payload: string(encoded), Result: string(result), CreatedAt: now.Unix(),
				}).Error)
			}
			legacy := intelligenceConfig{Group: "regular", Model: "model", Endpoint: "openai"}
			legacyRow := intelligenceChannelResult{HTML: "<html>legacy result</html>"}
			create("oldest", model.SystemTaskStatusSucceeded, legacy, legacyRow)
			for i := range 8 {
				create(fmt.Sprintf("expired-%02d", i), model.SystemTaskStatusSucceeded, legacy, legacyRow)
			}
			create("current-schedule", model.SystemTaskStatusSucceeded, intelligenceConfig{
				Group: "regular", Model: "model", ScheduledAt: now.Unix(),
			}, legacyRow)
			create("manually-deleted", model.SystemTaskStatusSucceeded, legacy, legacyRow)
			deleted, err := model.DeleteIntelligenceTestResult("manually-deleted")
			require.NoError(t, err)
			require.True(t, deleted)
			create("mixed", model.SystemTaskStatusSucceeded, intelligenceConfig{Groups: []intelligenceGroup{
				{Group: "regular", Models: []string{"model", "expired-model"}},
				{Group: "infrequent", Model: "other"},
			}}, intelligenceChannelResult{Group: "regular", Model: "model", ChannelID: 7, HTML: "<html>keep regular</html>"},
				intelligenceChannelResult{Group: "regular", Model: "expired-model", ChannelID: 8, HTML: "<html>drop regular</html>"},
				intelligenceChannelResult{Group: "infrequent", Model: "other", HTML: "<html>keep other group</html>"})
			for i := range 18 {
				create(fmt.Sprintf("regular-%02d", i), model.SystemTaskStatusSucceeded, legacy, legacyRow)
			}
			create("failed-before-response", model.SystemTaskStatusFailed, legacy)
			for i := range 5 {
				create(fmt.Sprintf("other-%02d", i), model.SystemTaskStatusSucceeded,
					intelligenceConfig{Group: "infrequent", Model: "other"}, legacyRow)
			}
			create("pending", model.SystemTaskStatusPending, legacy, legacyRow)
			create("running", model.SystemTaskStatusRunning, legacy, legacyRow)

			removed, err := pruneIntelligenceHistory(context.Background(), now)
			require.NoError(t, err)
			assert.EqualValues(t, 10, removed)
			for _, id := range []string{"oldest", "manually-deleted"} {
				task, err := model.GetSystemTaskByTaskID(id)
				require.NoError(t, err)
				assert.Nil(t, task)
			}
			marker, err := model.GetSystemTaskByTaskID("current-schedule")
			require.NoError(t, err)
			require.NotNil(t, marker)
			assert.True(t, marker.IntelligenceResultDeleted())
			assert.NotContains(t, marker.Result, "legacy result")

			mixed, err := model.GetSystemTaskByTaskID("mixed")
			require.NoError(t, err)
			require.NotNil(t, mixed)
			assert.NotContains(t, mixed.Result, "drop regular")
			view, err := publishedIntelligenceTask(mixed, true, true)
			require.NoError(t, err)
			rows := view["result"].(gin.H)["channels"].([]gin.H)
			require.Len(t, rows, 2)
			assert.Equal(t, "<html>keep regular</html>", rows[0]["html"])
			assert.Equal(t, "<html>keep other group</html>", rows[1]["html"])
			assert.Len(t, view["groups"], 2, "the expired model must not reappear as a fallback card")
			tasks, err := model.ListIntelligenceTestHistory()
			require.NoError(t, err)
			require.Len(t, tasks, 27)
			assert.Equal(t, "running", tasks[0].TaskID)
			assert.Equal(t, "pending", tasks[1].TaskID)
			assert.Equal(t, "mixed", tasks[len(tasks)-1].TaskID)

			removed, err = pruneIntelligenceHistory(context.Background(), now.Add(time.Minute))
			require.NoError(t, err)
			assert.EqualValues(t, 1, removed)
			removed, err = pruneIntelligenceHistory(context.Background(), now.Add(time.Minute))
			require.NoError(t, err)
			assert.Zero(t, removed)
		})
	}
}

func TestIntelligencePublicResultHidesInternalErrors(t *testing.T) {
	config, err := common.Marshal(intelligenceConfig{Group: "vip", Model: "model", Questions: []intelligenceQuestion{{Name: "Animation", Prompt: "private prompt"}}})
	require.NoError(t, err)
	task := &model.SystemTask{TaskID: "public-id", Type: intelligenceTaskType, Status: model.SystemTaskStatusFailed, Payload: string(config), LockedBy: "private-worker", Error: "database://secret", Result: `{"channels":[{"channel_id":1,"channel_name":"private-provider","question_name":"Animation","error":"api-key=secret"}]}`}
	response, err := publishedIntelligenceTask(task, true, false)
	require.NoError(t, err)
	encoded, err := common.Marshal(response)
	require.NoError(t, err)
	assert.Equal(t, "Intelligence test request failed", gjson.GetBytes(encoded, "error").String())
	assert.Equal(t, "Intelligence test request failed", gjson.GetBytes(encoded, "result.channels.0.error").String())
	for _, private := range []string{"private prompt", "private-worker", "private-provider", "database://secret", "api-key=secret"} {
		assert.NotContains(t, string(encoded), private)
	}
}

func TestIntelligencePublishedRetryCount(t *testing.T) {
	for _, tc := range []struct {
		name     string
		attempts int
		want     int
	}{
		{"legacy record", 0, 0},
		{"first attempt", 1, 0},
		{"retried twice", 3, 2},
		{"retry limit", 6, 5},
	} {
		t.Run(tc.name, func(t *testing.T) {
			result, err := common.Marshal(intelligenceResult{Channels: []intelligenceChannelResult{{
				Attempts: make([]intelligenceAttempt, tc.attempts),
			}}})
			require.NoError(t, err)
			task := &model.SystemTask{Payload: `{}`, Result: string(result)}
			for _, admin := range []bool{false, true} {
				response, err := publishedIntelligenceTask(task, false, admin)
				require.NoError(t, err)
				encoded, err := common.Marshal(response)
				require.NoError(t, err)
				count := gjson.GetBytes(encoded, "result.channels.0.retry_count")
				assert.True(t, count.Exists())
				assert.EqualValues(t, tc.want, count.Int())
				if !admin {
					assert.False(t, gjson.GetBytes(encoded, "result.channels.0.attempts").Exists())
				}
			}
		})
	}
}

func TestIntelligenceDailySchedule(t *testing.T) {
	config := intelligenceConfig{Questions: []intelligenceQuestion{{Name: "test", Prompt: "test"}}, Groups: []intelligenceGroup{
		{Group: "a", Model: "m", Endpoint: "openai", Enabled: true, Times: []string{"09:00", "15:00", "21:00"}},
		{Group: "b", Model: "m", Endpoint: "openai-response", Enabled: true, Times: []string{"15:00", "00:00"}},
		{Group: "c", Model: "m", Endpoint: "gemini", Times: []string{"15:00"}},
	}}
	require.NoError(t, config.Validate())
	for _, tc := range []struct {
		utc    string
		groups []string
	}{
		{"2026-10-10T01:00:00Z", []string{"a"}}, {"2026-10-10T07:00:59Z", []string{"a", "b"}},
		{"2026-10-10T13:00:00Z", []string{"a"}}, {"2026-10-10T16:00:00Z", []string{"b"}}, {"2026-10-10T07:01:00Z", []string{}},
	} {
		now, err := time.Parse(time.RFC3339, tc.utc)
		require.NoError(t, err)
		got := []string{}
		for _, group := range config.DueGroups(now).Groups {
			got = append(got, group.Group)
		}
		assert.Equal(t, tc.groups, got)
	}
	for _, times := range [][]string{{"24:00"}, {"9:00"}, {"09:00", "09:00"}, {}} {
		invalid := config
		invalid.Groups = append([]intelligenceGroup(nil), config.Groups...)
		invalid.Groups[0].Times = times
		require.Error(t, invalid.Validate())
	}
	config.Groups[1].Group = "a"
	require.Error(t, config.Validate())
}

func TestIntelligenceLegacyConfigurationPreservesQuestionsAndTargets(t *testing.T) {
	old := common.OptionMap
	t.Cleanup(func() { common.OptionMap = old })
	common.OptionMap = map[string]string{intelligenceOptionKey: ` {"group":"vip","model":"model","endpoint":"openai-response","enabled":true,"interval_minutes":30,"questions":[{"name":"Custom","prompt":"custom prompt"}]} `}
	config := getIntelligenceConfig()
	require.Len(t, config.Groups, 1)
	assert.Equal(t, intelligenceGroup{Group: "vip", Model: "model", Models: []string{"model"}, Endpoint: "openai-response", Times: []string{"09:00"}}, config.Groups[0])
	assert.Equal(t, []intelligenceQuestion{{Name: "Custom", Prompt: "custom prompt"}}, config.Questions)
}

func TestManxueTemporaryTokenAccess(t *testing.T) {
	for _, dialect := range []struct{ kind, env string }{{"sqlite", ""}, {"mysql", "TEST_MYSQL_DSN"}, {"postgres", "TEST_POSTGRES_DSN"}} {
		t.Run(dialect.kind, func(t *testing.T) {
			if dialect.env != "" && os.Getenv(dialect.env) == "" {
				t.Skip("set " + dialect.env + " to run this database")
			}
			db := modelManagementDB(t, dialect.kind, os.Getenv(dialect.env))
			require.NoError(t, db.AutoMigrate(&model.Token{}))
			user := model.User{Username: "benchmark-owner", Role: common.RoleRootUser, Status: common.UserStatusEnabled, Group: "default"}
			require.NoError(t, db.Create(&user).Error)
			regular := model.Token{UserId: user.Id, Name: "regular", Key: model.ManxueTestTokenPrefix + strings.Repeat("b", 38), UnlimitedQuota: true}
			temporary := model.Token{UserId: user.Id, Name: "benchmark", Key: model.ManxueTestTokenPrefix + strings.Repeat("a", 48), ExpiredTime: time.Now().Add(time.Minute).Unix(), ModelLimitsEnabled: true, ModelLimits: "gpt-4o-mini", UnlimitedQuota: true}
			require.NoError(t, db.Create(&regular).Error)
			require.NoError(t, db.Create(&temporary).Error)

			tokens, err := model.GetAllUserTokens(user.Id, 0, 10)
			require.NoError(t, err)
			require.Len(t, tokens, 1)
			assert.Equal(t, regular.Id, tokens[0].Id)
			count, err := model.CountUserTokens(user.Id)
			require.NoError(t, err)
			assert.EqualValues(t, 1, count)
			_, err = model.GetTokenByIds(temporary.Id, user.Id)
			assert.ErrorIs(t, err, gorm.ErrRecordNotFound)
			keys, err := model.GetTokenKeysByIds([]int{temporary.Id, regular.Id}, user.Id)
			require.NoError(t, err)
			require.Len(t, keys, 1)
			assert.Equal(t, regular.Id, keys[0].Id)
			_, err = model.BatchUpdateTokens([]int{temporary.Id}, user.Id, map[string]any{"expired_time": int64(-1)})
			assert.Error(t, err)

			router := gin.New()
			router.Use(func(c *gin.Context) { defer common.CleanupBodyStorage(c); c.Next() })
			accept := func(c *gin.Context) { c.Status(http.StatusNoContent) }
			router.POST("/v1/responses", middleware.TokenAuth(), accept)
			router.GET("/api/usage/token/", middleware.TokenAuthReadOnly(), accept)
			for _, tc := range []struct {
				method, path, credential, model string
				status                          int
			}{
				{http.MethodPost, "/v1/responses", temporary.Key, "gpt-4o-mini", http.StatusNoContent},
				{http.MethodPost, "/v1/responses", temporary.Key, "other-model", http.StatusForbidden},
				{http.MethodPost, "/v1/responses", strings.ToUpper(temporary.Key), "gpt-4o-mini", http.StatusUnauthorized},
				{http.MethodGet, "/api/usage/token/", temporary.Key, "", http.StatusUnauthorized},
				{http.MethodGet, "/api/usage/token/", strings.ToUpper(temporary.Key), "", http.StatusUnauthorized},
				{http.MethodGet, "/api/usage/token/", regular.Key, "", http.StatusNoContent},
			} {
				req := httptest.NewRequest(tc.method, tc.path, strings.NewReader(fmt.Sprintf(`{"model":%q}`, tc.model)))
				req.Header.Set("Content-Type", "application/json")
				req.Header.Set("Authorization", "Bearer sk-"+tc.credential)
				response := httptest.NewRecorder()
				router.ServeHTTP(response, req)
				assert.Equal(t, tc.status, response.Code, "%s %s", tc.method, tc.path)
			}
			require.NoError(t, db.Model(&temporary).Update("expired_time", -1).Error)
			_, err = model.ValidateUserToken(temporary.Key)
			assert.ErrorIs(t, err, model.ErrTokenInvalid)
		})
	}
}

func TestIntelligenceStreamOutput(t *testing.T) {
	for _, tc := range []struct{ name, endpoint, body, want string }{
		{"chat", "openai", `data: {"choices":[{"delta":{"reasoning_content":"private","content":"<html>"}}]}

data: {"choices":[{"delta":{"content":"中文</html>"}}]}

data: [DONE]
`, "<html>中文</html>"},
		{"responses", "openai-response", `data: {"type":"response.reasoning_text.delta","delta":"private"}

data: {"type":"response.output_text.delta","delta":"<html>"}

data: {"type":"response.output_text.delta","delta":"中文</html>"}

data: {"type":"response.completed","response":{"output":[{"type":"message","content":[{"type":"output_text","text":"<html>中文</html>"}]}]}}
`, "<html>中文</html>"},
		{"responses final only", "openai-response", `data: {"type":"response.completed","response":{"output":[{"type":"message","content":[{"type":"output_text","text":"<html>中文</html>"}]}]}}
`, "<html>中文</html>"},
		{"claude", "anthropic", `data: {"type":"content_block_start","content_block":{"type":"text","text":"<html>"}}

data: {"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"private"}}

data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"中文</html>"}}
`, "<html>中文</html>"},
		{"gemini", "gemini", `data: {"candidates":[{"content":{"parts":[{"thought":true,"text":"private"},{"text":"<html>"}]}}]}

data: {"candidates":[{"content":{"parts":[{"text":"中文</html>"}]}}]}
`, "<html>中文</html>"},
		{"failed", "openai-response", `data: {"type":"response.output_text.delta","delta":"partial"}

data: {"type":"response.failed","response":{"error":{"message":"private"}}}
`, ""},
		{"incomplete", "openai-response", `data: {"type":"response.output_text.delta","delta":"partial"}

data: {"type":"response.incomplete"}
`, ""},
		{"chat error", "openai", `data: {"choices":[{"delta":{"content":"partial"}}]}

data: {"error":{"message":"private"}}
`, ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.want, extractIntelligenceOutput([]byte(tc.body), tc.endpoint, true))
		})
	}
}

func TestIntelligenceScheduleIgnoresLegacyStreamOption(t *testing.T) {
	old := common.OptionMap
	t.Cleanup(func() { common.OptionMap = old })
	common.OptionMap = map[string]string{intelligenceOptionKey: `{"groups":[{"group":"a","model":"m","endpoint":"openai","enabled":true,"times":["09:00"]},{"group":"b","model":"m","endpoint":"openai-response","stream":false,"enabled":true,"times":["09:00"]}],"questions":[{"name":"Q","prompt":"P"}]}`}
	config := getIntelligenceConfig()
	require.Len(t, config.Groups, 2)
	due := config.DueGroups(time.Date(2026, 10, 10, 1, 0, 0, 0, time.UTC))
	require.Len(t, due.Groups, 2)
	encoded, err := common.Marshal(due)
	require.NoError(t, err)
	assert.False(t, gjson.GetBytes(encoded, "groups.1.stream").Exists())
}

func TestIntelligenceRetryAttempts(t *testing.T) {
	for _, tc := range []struct {
		name            string
		succeedAt, want int
	}{{"immediate", 1, 1}, {"recovers", 3, 3}, {"exhausts five retries", 0, 6}} {
		t.Run(tc.name, func(t *testing.T) {
			calls := 0
			row := retryIntelligenceRequest(context.Background(), 0, func() intelligenceChannelResult {
				calls++
				result := intelligenceChannelResult{RequestID: fmt.Sprintf("request-%d", calls), Error: "Upstream returned an HTTP error", HTTPStatus: 503}
				if calls == tc.succeedAt {
					result.Error = ""
					result.HTML = "<html>success</html>"
					result.HTTPStatus = 200
				}
				return result
			})
			assert.Equal(t, tc.want, calls)
			require.Len(t, row.Attempts, tc.want)
			assert.Equal(t, fmt.Sprintf("request-%d", tc.want), row.RequestID)
			if tc.succeedAt > 0 {
				assert.Empty(t, row.Error)
				assert.Equal(t, "<html>success</html>", row.HTML)
			} else {
				assert.NotEmpty(t, row.Error)
			}
		})
	}
	ctx, cancel := context.WithCancel(context.Background())
	calls := 0
	row := retryIntelligenceRequest(ctx, time.Hour, func() intelligenceChannelResult {
		calls++
		cancel()
		return intelligenceChannelResult{RequestID: "cancelled", Error: "failure"}
	})
	assert.Equal(t, 1, calls)
	assert.Equal(t, "Intelligence test was cancelled", row.Error)
}

func TestIntelligenceFailureDiagnostics(t *testing.T) {
	for _, tc := range []struct {
		name     string
		response testResult
		stream   bool
		want     string
	}{
		{"deadline", testResult{localErr: context.DeadlineExceeded}, false, "Upstream connection timed out"},
		{"cancelled", testResult{localErr: context.Canceled}, false, "Intelligence test was cancelled"},
		{"http", testResult{upstreamStatus: 503, localErr: fmt.Errorf("secret-key https://private")}, false, "Upstream returned an HTTP error"},
		{"stream timeout", testResult{streamOutcome: relaycommon.StreamOutcome{EndReason: relaycommon.StreamEndReasonTimeout}}, true, "Upstream stream timed out while waiting for data"},
		{"truncated", testResult{streamOutcome: relaycommon.StreamOutcome{ExpectsTerminal: true}}, true, "Upstream stream ended before completion"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.want, intelligenceFailureReason(context.Background(), tc.response, tc.stream))
		})
	}
}
