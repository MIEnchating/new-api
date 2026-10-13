package controller

import (
	"bytes"
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"testing/synctest"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/service/authz"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/gin-gonic/gin"
	"github.com/samber/lo"
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
			encoded, err := common.Marshal(buildIntelligenceRequest("model", tc.endpoint, "draw a pelican", false))
			require.NoError(t, err)
			assert.Equal(t, "draw a pelican", gjson.GetBytes(encoded, tc.promptPath).String())
			assert.EqualValues(t, 8192, gjson.GetBytes(encoded, tc.limitPath).Int())
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
	db, _ := newAuditTestDatabase(t, dialect, os.Getenv("TEST_"+strings.ToUpper(dialect)+"_DSN"))
	if dialect != "sqlite" {
		databaseName := db.Migrator().CurrentDatabase()
		t.Cleanup(func() {
			sqlDB, err := db.DB()
			require.NoError(t, err)
			require.NoError(t, sqlDB.Close())
			var driver gorm.Dialector = postgres.Open(os.Getenv("TEST_POSTGRES_DSN"))
			if dialect == "mysql" {
				driver = mysql.Open(os.Getenv("TEST_MYSQL_DSN"))
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
	require.NoError(t, db.AutoMigrate(&model.Option{}, &model.Channel{}, &model.User{}, &model.Log{}, &model.AuditLog{}, &model.SystemTask{}, &model.SystemTaskLock{}))
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
	var streamRequests, jsonRequests atomic.Int32
	var failRequests atomic.Int32
	var arrivals atomic.Int32
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
		assert.Equal(t, defaultIntelligencePrompt, gjson.GetBytes(encoded, "messages.0.content").String())
		if request["stream"] == true {
			streamRequests.Add(1)
			w.Header().Set("Content-Type", "text/event-stream")
			for _, part := range []string{output[:len(output)/2], output[len(output)/2:]} {
				text, _ := common.Marshal(part)
				fmt.Fprintf(w, "data: {\"id\":\"test\",\"model\":\"gpt-4o-mini\",\"choices\":[{\"index\":0,\"delta\":{\"content\":%s}}]}\n\n", text)
				w.(http.Flusher).Flush()
			}
			fmt.Fprint(w, "data: {\"id\":\"test\",\"model\":\"gpt-4o-mini\",\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":10,\"completion_tokens\":20,\"total_tokens\":30}}\n\ndata: [DONE]\n\n")
			return
		}
		jsonRequests.Add(1)
		response, err := common.Marshal(map[string]any{"id": "test", "object": "chat.completion", "model": "gpt-4o-mini", "choices": []any{map[string]any{"index": 0, "message": map[string]any{"role": "assistant", "content": output}, "finish_reason": "stop"}}, "usage": map[string]any{"prompt_tokens": 10, "completion_tokens": 20, "total_tokens": 30}})
		require.NoError(t, err)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(response)
	}))
	t.Cleanup(upstream.Close)
	t.Cleanup(unblockSecondModel)
	url := upstream.URL
	channels := []model.Channel{
		{Id: 1, Type: constant.ChannelTypeOpenAI, Key: "test-secret", Name: "selected", Status: common.ChannelStatusEnabled, Group: "default,vip", Models: "gpt-4o-mini", BaseURL: &url},
		{Id: 2, Type: constant.ChannelTypeOpenAI, Key: "other-secret", Name: "other-group", Status: common.ChannelStatusEnabled, Group: "other", Models: "gpt-4o-mini"},
		{Id: 3, Type: constant.ChannelTypeOpenAI, Name: "disabled", Status: common.ChannelStatusManuallyDisabled, Group: "vip", Models: "gpt-4o-mini"},
	}
	require.NoError(t, db.Create(&channels).Error)
	config := intelligenceConfig{Groups: []intelligenceGroup{{Group: "vip", Model: "gpt-4o-mini", Endpoint: "openai", Enabled: true, Stream: lo.ToPtr(true), Times: []string{"09:00", "15:00"}}, {Group: "default", Model: "gpt-4o-mini", Endpoint: "openai", Stream: lo.ToPtr(false), Times: []string{"21:00"}}}, Questions: []intelligenceQuestion{{Name: "Pelican", Prompt: defaultIntelligencePrompt}}}
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
	assert.EqualValues(t, 2, streamRequests.Load())
	assert.EqualValues(t, 2, jsonRequests.Load())
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
	multi := intelligenceConfig{Groups: []intelligenceGroup{{Group: "vip", Models: []string{"gpt-4o-mini", "second-model"}, Endpoint: "openai", Stream: lo.ToPtr(false), Times: []string{"09:00"}}}, Questions: config.Questions}
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
	assert.Equal(t, "Intelligence test exceeded the 180-second request timeout", deadlineResult.Error)
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
		streamTask, err := model.CreateSystemTask("intelligence_stream_regression", streamConfig, nil)
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
		} else {
			assert.Equal(t, model.SystemTaskStatusFailed, streamTask.Status)
			assert.Empty(t, gjson.Get(streamTask.Result, "channels.0.html").String())
		}
	}

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
	assert.Equal(t, intelligenceGroup{Group: "vip", Model: "model", Models: []string{"model"}, Endpoint: "openai-response", Stream: lo.ToPtr(true), Times: []string{"09:00"}}, config.Groups[0])
	assert.Equal(t, []intelligenceQuestion{{Name: "Custom", Prompt: "custom prompt"}}, config.Questions)
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
	for _, endpoint := range []string{"openai", "openai-response", "anthropic", "gemini"} {
		for _, stream := range []bool{true, false} {
			request := buildIntelligenceRequest("model", endpoint, "prompt", stream)
			encoded, err := common.Marshal(request)
			require.NoError(t, err)
			if endpoint != "gemini" {
				assert.Equal(t, stream, gjson.GetBytes(encoded, "stream").Bool())
			}
		}
	}
}

func TestIntelligenceStreamDefaultsAndSchedule(t *testing.T) {
	old := common.OptionMap
	t.Cleanup(func() { common.OptionMap = old })
	common.OptionMap = map[string]string{intelligenceOptionKey: `{"groups":[{"group":"a","model":"m","endpoint":"openai","enabled":true,"times":["09:00"]},{"group":"b","model":"m","endpoint":"openai-response","stream":false,"enabled":true,"times":["09:00"]}],"questions":[{"name":"Q","prompt":"P"}]}`}
	config := getIntelligenceConfig()
	require.Len(t, config.Groups, 2)
	require.NotNil(t, config.Groups[0].Stream)
	assert.True(t, *config.Groups[0].Stream)
	require.NotNil(t, config.Groups[1].Stream)
	assert.False(t, *config.Groups[1].Stream)
	due := config.DueGroups(time.Date(2026, 10, 10, 1, 0, 0, 0, time.UTC))
	require.Len(t, due.Groups, 2)
	assert.True(t, *due.ForGroup(due.Groups[0], due.Groups[0].Model).Stream)
	assert.False(t, *due.ForGroup(due.Groups[1], due.Groups[1].Model).Stream)
}

func TestIntelligenceStreamingRequestSurvivesGenerationDeadline(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		parent, stopTask := context.WithCancel(context.Background())
		defer stopTask()
		stream, cancelStream := intelligenceRequestContext(parent, true)
		defer cancelStream()
		nonStream, cancelNonStream := intelligenceRequestContext(parent, false)
		defer cancelNonStream()
		// Virtual time: long generation does not require a three-minute test.
		time.Sleep(181 * time.Second)
		require.NoError(t, stream.Err(), "an active stream must not be cut off at 180 seconds")
		require.ErrorIs(t, nonStream.Err(), context.DeadlineExceeded)
		stopTask()
		require.ErrorIs(t, stream.Err(), context.Canceled, "task cancellation must still stop the stream")
	})
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
		{"deadline", testResult{localErr: context.DeadlineExceeded}, false, "Intelligence test exceeded the 180-second request timeout"},
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
