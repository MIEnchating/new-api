package controller

import (
	"bytes"
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
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
	var responseTerminal atomic.Value
	responseTerminal.Store("response.failed")
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request map[string]any
		if !assert.NoError(t, common.DecodeJson(r.Body, &request)) {
			w.WriteHeader(400)
			return
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
	assert.Equal(t, config, getIntelligenceConfig())
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
	targets, err := intelligenceTargets(config.ForGroup(config.Groups[0]))
	require.NoError(t, err)
	require.Len(t, targets, 1)
	assert.Equal(t, 1, targets[0].Id)
	queued := call(RunIntelligenceMonitor, http.MethodPost, nil)
	require.True(t, gjson.GetBytes(queued.Body.Bytes(), "success").Bool(), queued.Body.String())
	duplicate := call(RunIntelligenceMonitor, http.MethodPost, nil)
	assert.False(t, gjson.GetBytes(duplicate.Body.Bytes(), "success").Bool())
	task, err := model.GetActiveSystemTask(intelligenceTaskType)
	require.NoError(t, err)
	require.NotNil(t, task)
	claimed, ok, err := model.ClaimSystemTask(task.ID, task.Type, "test-runner", time.Now().Add(time.Minute).Unix())
	require.NoError(t, err)
	require.True(t, ok)
	handler.Run(context.Background(), claimed, "test-runner")
	finished, err := model.GetSystemTaskByTaskID(task.TaskID)
	require.NoError(t, err)
	require.Equal(t, model.SystemTaskStatusSucceeded, finished.Status, finished.Error+finished.Result)
	assert.EqualValues(t, 1, streamRequests.Load())
	assert.EqualValues(t, 1, jsonRequests.Load())
	assert.Equal(t, output, gjson.Get(finished.Result, "channels.0.html").String())
	assert.Equal(t, "Pelican", gjson.Get(finished.Result, "channels.0.question_name").String())
	assert.Len(t, gjson.Get(finished.Result, "channels").Array(), 2)
	assert.Equal(t, "vip", gjson.Get(finished.Result, "channels.0.group").String())
	assert.Equal(t, "default", gjson.Get(finished.Result, "channels.1.group").String())
	scheduled, err := model.CreateSystemTask(intelligenceTaskType, payload, nil)
	require.NoError(t, err)
	_, due, err = handler.ScheduledPayload(now.Add(10 * time.Second))
	require.NoError(t, err)
	assert.False(t, due)
	_, claimedSchedule, err := model.ClaimSystemTask(scheduled.ID, scheduled.Type, "schedule-runner", time.Now().Add(time.Minute).Unix())
	require.NoError(t, err)
	require.True(t, claimedSchedule)
	require.NoError(t, model.FinishSystemTask(scheduled.TaskID, "schedule-runner", model.SystemTaskStatusSucceeded, nil, ""))
	_, due, err = handler.ScheduledPayload(now.Add(20 * time.Second))
	require.NoError(t, err)
	assert.False(t, due)
	_, due, err = handler.ScheduledPayload(now.Add(24 * time.Hour))
	require.NoError(t, err)
	assert.True(t, due)
	history := call(GetIntelligenceMonitor, http.MethodGet, nil)
	assert.True(t, gjson.GetBytes(history.Body.Bytes(), "success").Bool())
	assert.NotContains(t, history.Body.String(), "test-secret")
	assert.False(t, gjson.GetBytes(history.Body.Bytes(), "data.history.0.result.channels.0.html").Exists())
	publicHistory := call(GetIntelligenceResults, http.MethodGet, nil)
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
}

func TestIntelligencePublicResultHidesInternalErrors(t *testing.T) {
	config, err := common.Marshal(intelligenceConfig{Group: "vip", Model: "model", Questions: []intelligenceQuestion{{Name: "Animation", Prompt: "private prompt"}}})
	require.NoError(t, err)
	task := &model.SystemTask{TaskID: "public-id", Type: intelligenceTaskType, Status: model.SystemTaskStatusFailed, Payload: string(config), LockedBy: "private-worker", Error: "database://secret", Result: `{"channels":[{"channel_id":1,"channel_name":"private-provider","question_name":"Animation","error":"api-key=secret"}]}`}
	response, err := publishedIntelligenceTask(task, true)
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
	assert.Equal(t, intelligenceGroup{Group: "vip", Model: "model", Endpoint: "openai-response", Stream: lo.ToPtr(true), Times: []string{"09:00"}}, config.Groups[0])
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
	assert.True(t, *due.ForGroup(due.Groups[0]).Stream)
	assert.False(t, *due.ForGroup(due.Groups[1]).Stream)
}
