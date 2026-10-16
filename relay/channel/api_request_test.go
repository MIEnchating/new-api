package channel

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/gorilla/websocket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/schema"
)

func TestNewTaskAPIRequestInheritsClientCancellation(t *testing.T) {
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	requestContext, cancel := context.WithCancel(context.Background())
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", nil).WithContext(requestContext)

	upstream, err := newTaskAPIRequest(c, "https://provider.example/tasks", nil)
	require.NoError(t, err)
	cancel()

	require.ErrorIs(t, upstream.Context().Err(), context.Canceled)
}

func TestProcessHeaderOverride_ChannelTestSkipsPassthroughRules(t *testing.T) {
	t.Parallel()

	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	ctx.Request.Header.Set("X-Trace-Id", "trace-123")

	info := &relaycommon.RelayInfo{
		IsChannelTest: true,
		ChannelMeta: &relaycommon.ChannelMeta{
			HeadersOverride: map[string]any{
				"*": "",
			},
		},
	}

	headers, err := processHeaderOverride(info, ctx)
	require.NoError(t, err)
	require.Empty(t, headers)
}

func TestProcessHeaderOverride_ChannelTestSkipsClientHeaderPlaceholder(t *testing.T) {
	t.Parallel()

	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	ctx.Request.Header.Set("X-Trace-Id", "trace-123")

	info := &relaycommon.RelayInfo{
		IsChannelTest: true,
		ChannelMeta: &relaycommon.ChannelMeta{
			HeadersOverride: map[string]any{
				"X-Upstream-Trace": "{client_header:X-Trace-Id}",
			},
		},
	}

	headers, err := processHeaderOverride(info, ctx)
	require.NoError(t, err)
	_, ok := headers["x-upstream-trace"]
	require.False(t, ok)
}

func TestProcessHeaderOverride_NonTestKeepsClientHeaderPlaceholder(t *testing.T) {
	t.Parallel()

	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	ctx.Request.Header.Set("X-Trace-Id", "trace-123")

	info := &relaycommon.RelayInfo{
		IsChannelTest: false,
		ChannelMeta: &relaycommon.ChannelMeta{
			HeadersOverride: map[string]any{
				"X-Upstream-Trace": "{client_header:X-Trace-Id}",
			},
		},
	}

	headers, err := processHeaderOverride(info, ctx)
	require.NoError(t, err)
	require.Equal(t, "trace-123", headers["x-upstream-trace"])
}

func TestProcessHeaderOverride_RuntimeOverrideIsFinalHeaderMap(t *testing.T) {
	t.Parallel()

	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)

	info := &relaycommon.RelayInfo{
		IsChannelTest:             false,
		UseRuntimeHeadersOverride: true,
		RuntimeHeadersOverride: map[string]any{
			"x-static":  "runtime-value",
			"x-runtime": "runtime-only",
		},
		ChannelMeta: &relaycommon.ChannelMeta{
			HeadersOverride: map[string]any{
				"X-Static": "legacy-value",
				"X-Legacy": "legacy-only",
			},
		},
	}

	headers, err := processHeaderOverride(info, ctx)
	require.NoError(t, err)
	require.Equal(t, "runtime-value", headers["x-static"])
	require.Equal(t, "runtime-only", headers["x-runtime"])
	_, exists := headers["x-legacy"]
	require.False(t, exists)
}

func TestProcessHeaderOverride_PassthroughSkipsAcceptEncoding(t *testing.T) {
	t.Parallel()

	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	ctx.Request.Header.Set("X-Trace-Id", "trace-123")
	ctx.Request.Header.Set("Accept-Encoding", "gzip")

	info := &relaycommon.RelayInfo{
		IsChannelTest: false,
		ChannelMeta: &relaycommon.ChannelMeta{
			HeadersOverride: map[string]any{
				"*": "",
			},
		},
	}

	headers, err := processHeaderOverride(info, ctx)
	require.NoError(t, err)
	require.Equal(t, "trace-123", headers["x-trace-id"])

	_, hasAcceptEncoding := headers["accept-encoding"]
	require.False(t, hasAcceptEncoding)
}

func TestProcessHeaderOverride_PassHeadersTemplateSetsRuntimeHeaders(t *testing.T) {
	t.Parallel()

	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", nil)
	ctx.Request.Header.Set("Originator", "Codex CLI")
	ctx.Request.Header.Set("Session_id", "sess-123")

	info := &relaycommon.RelayInfo{
		IsChannelTest: false,
		RequestHeaders: map[string]string{
			"Originator": "Codex CLI",
			"Session_id": "sess-123",
		},
		ChannelMeta: &relaycommon.ChannelMeta{
			ParamOverride: map[string]any{
				"operations": []any{
					map[string]any{
						"mode":  "pass_headers",
						"value": []any{"Originator", "Session_id", "X-Codex-Beta-Features"},
					},
				},
			},
			HeadersOverride: map[string]any{
				"X-Static": "legacy-value",
			},
		},
	}

	_, err := relaycommon.ApplyParamOverrideWithRelayInfo([]byte(`{"model":"gpt-4.1"}`), info)
	require.NoError(t, err)
	require.True(t, info.UseRuntimeHeadersOverride)
	require.Equal(t, "Codex CLI", info.RuntimeHeadersOverride["originator"])
	require.Equal(t, "sess-123", info.RuntimeHeadersOverride["session_id"])
	_, exists := info.RuntimeHeadersOverride["x-codex-beta-features"]
	require.False(t, exists)
	require.Equal(t, "legacy-value", info.RuntimeHeadersOverride["x-static"])

	headers, err := processHeaderOverride(info, ctx)
	require.NoError(t, err)
	require.Equal(t, "Codex CLI", headers["originator"])
	require.Equal(t, "sess-123", headers["session_id"])
	_, exists = headers["x-codex-beta-features"]
	require.False(t, exists)

	upstreamReq := httptest.NewRequest(http.MethodPost, "https://example.com/v1/responses", nil)
	applyHeaderOverrideToRequest(upstreamReq, headers)
	require.Equal(t, "Codex CLI", upstreamReq.Header.Get("Originator"))
	require.Equal(t, "sess-123", upstreamReq.Header.Get("Session_id"))
	require.Empty(t, upstreamReq.Header.Get("X-Codex-Beta-Features"))
}

func TestToWebSocketURL(t *testing.T) {
	for input, want := range map[string]string{
		"https://api.openai.com/v1/responses":             "wss://api.openai.com/v1/responses",
		"http://127.0.0.1:3000/v1/responses":              "ws://127.0.0.1:3000/v1/responses",
		"wss://chatgpt.com/backend-api/codex/responses":   "wss://chatgpt.com/backend-api/codex/responses",
		"ws://127.0.0.1:3000/backend-api/codex/responses": "ws://127.0.0.1:3000/backend-api/codex/responses",
	} {
		assert.Equal(t, want, toWebSocketURL(input), input)
	}
}

// Only URL and header setup are involved in transport correlation tests.
type requestIDTestAdaptor struct {
	Adaptor
	url string
}

func (a requestIDTestAdaptor) GetRequestURL(_ *relaycommon.RelayInfo) (string, error) {
	return a.url, nil
}

func (a requestIDTestAdaptor) SetupRequestHeader(_ *gin.Context, _ *http.Header, _ *relaycommon.RelayInfo) error {
	return nil
}

func TestUpstreamRequestIDsHTTP(t *testing.T) {
	service.InitHttpClient()
	for _, tc := range []struct {
		name    string
		status  int
		stream  bool
		header  http.Header
		primary string
		ids     []string
	}{
		{"success", http.StatusOK, false, http.Header{"X-Client-Request-Id": {"client-id"}, "X-Request-Id": {"provider-id"}}, "client-id", []string{"client-id", "provider-id"}},
		{"stream", http.StatusOK, true, http.Header{"X-Client-Request-Id": {"client-id"}, "X-Request-Id": {"provider-id"}}, "client-id", []string{"client-id", "provider-id"}},
		{"error", http.StatusBadGateway, false, http.Header{"X-Client-Request-Id": {"error-id"}, "X-Request-Id": {"error-provider"}}, "error-id", []string{"error-id", "error-provider"}},
		{"stream error", http.StatusBadGateway, true, http.Header{"X-Client-Request-Id": {"error-id"}, "X-Request-Id": {"error-provider"}}, "error-id", []string{"error-id", "error-provider"}},
		{"provider only", http.StatusOK, false, http.Header{"X-Request-Id": {"provider-id"}}, "provider-id", []string{"provider-id"}},
		{"no headers", http.StatusOK, false, http.Header{}, "", nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				for key, values := range tc.header {
					w.Header()[key] = values
				}
				if tc.stream {
					w.Header().Set("Content-Type", "text/event-stream")
				}
				w.WriteHeader(tc.status)
				_, _ = io.WriteString(w, "response body")
			}))
			defer upstream.Close()
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			c.Request = httptest.NewRequest(http.MethodPost, "/relay", nil)
			c.Set(common.RequestIdKey, "local-id")
			service.CaptureUpstreamRequestId(c, http.Header{"X-Request-Id": {"previous-id"}})
			info := &relaycommon.RelayInfo{IsStream: tc.stream, ChannelMeta: &relaycommon.ChannelMeta{ChannelId: 177, ChannelType: constant.ChannelTypeSub2API}}
			req, err := http.NewRequest(http.MethodPost, upstream.URL, strings.NewReader("request"))
			require.NoError(t, err)
			resp, err := DoRequest(c, req, info)
			require.NoError(t, err)
			defer resp.Body.Close()
			assert.Equal(t, tc.status, resp.StatusCode)
			assert.Equal(t, tc.primary, c.GetString(common.UpstreamRequestIdKey))
			wantIDs := append([]string{"previous-id"}, tc.ids...)
			assert.Equal(t, wantIDs, c.GetStringSlice(common.UpstreamRequestIdsKey))
			assert.Equal(t, "local-id", c.GetString(common.RequestIdKey))
			chain := c.MustGet(common.UpstreamRequestChainKey).([]common.UpstreamRequestAttempt)
			require.Len(t, chain, 1)
			assert.Equal(t, 177, chain[0].ChannelID)
			assert.Equal(t, "sub2api", chain[0].ChannelType)

			// A subsequent transport failure must clear the primary ID, retaining history.
			cancelled, cancel := context.WithCancel(context.Background())
			cancel()
			retry, err := http.NewRequestWithContext(cancelled, http.MethodPost, upstream.URL, strings.NewReader("retry"))
			require.NoError(t, err)
			_, err = DoRequest(c, retry, info)
			require.Error(t, err)
			chain = c.MustGet(common.UpstreamRequestChainKey).([]common.UpstreamRequestAttempt)
			require.Len(t, chain, 2)
			assert.Equal(t, 2, chain[1].Attempt)
			assert.Empty(t, chain[1].Nodes)
			assert.Empty(t, c.GetString(common.UpstreamRequestIdKey))
			assert.Equal(t, wantIDs, c.GetStringSlice(common.UpstreamRequestIdsKey))
		})
	}
}

func TestUpstreamRequestIDsWebSocket(t *testing.T) {
	for _, status := range []int{http.StatusSwitchingProtocols, http.StatusBadGateway} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				header := http.Header{"X-Client-Request-Id": {"client-id"}, "X-Request-Id": {"provider-id"}}
				if status != http.StatusSwitchingProtocols {
					for key, values := range header {
						w.Header()[key] = values
					}
					w.WriteHeader(status)
					return
				}
				upgrader := websocket.Upgrader{}
				conn, err := upgrader.Upgrade(w, r, header)
				if err == nil {
					_ = conn.Close()
				}
			}))
			defer upstream.Close()
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			c.Request = httptest.NewRequest(http.MethodGet, "/relay", nil)
			c.Set(common.RequestIdKey, "local-id")
			info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{ChannelId: 177, ChannelType: constant.ChannelTypeSub2API}}
			adaptor := requestIDTestAdaptor{url: upstream.URL}
			conn, err := DoWssRequest(adaptor, c, info, nil)
			if status == http.StatusSwitchingProtocols {
				require.NoError(t, err)
				require.NoError(t, conn.Close())
			} else {
				require.Error(t, err)
			}
			assert.Equal(t, "client-id", c.GetString(common.UpstreamRequestIdKey))
			assert.Equal(t, []string{"client-id", "provider-id"}, c.GetStringSlice(common.UpstreamRequestIdsKey))
			assert.Equal(t, "local-id", c.GetString(common.RequestIdKey))
			chain := c.MustGet(common.UpstreamRequestChainKey).([]common.UpstreamRequestAttempt)
			require.Len(t, chain, 1)
			assert.Equal(t, 177, chain[0].ChannelID)
			assert.Equal(t, "sub2api", chain[0].ChannelType)

			cancelled, cancel := context.WithCancel(context.Background())
			cancel()
			c.Request = c.Request.WithContext(cancelled)
			_, err = DoWssRequest(adaptor, c, info, nil)
			require.Error(t, err)
			chain = c.MustGet(common.UpstreamRequestChainKey).([]common.UpstreamRequestAttempt)
			require.Len(t, chain, 2)
			assert.Equal(t, 2, chain[1].Attempt)
			assert.Empty(t, chain[1].Nodes)
			assert.Empty(t, c.GetString(common.UpstreamRequestIdKey))
			assert.Equal(t, []string{"client-id", "provider-id"}, c.GetStringSlice(common.UpstreamRequestIdsKey))
		})
	}
}

func TestUpstreamRequestIDsPersistLogs(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			var driver gorm.Dialector = sqlite.Open(":memory:")
			if dialect != "sqlite" {
				dsn := os.Getenv("REQUEST_ID_" + strings.ToUpper(dialect) + "_DSN")
				if dsn == "" {
					t.Skip("request ID test database DSN is not configured")
				}
				if dialect == "mysql" {
					driver = mysql.Open(dsn)
				} else {
					driver = postgres.Open(dsn)
				}
			}
			db, err := gorm.Open(driver, &gorm.Config{NamingStrategy: schema.NamingStrategy{TablePrefix: fmt.Sprintf("request_id_%d_", time.Now().UnixNano())}})
			require.NoError(t, err)
			sqlDB, err := db.DB()
			require.NoError(t, err)
			sqlDB.SetMaxOpenConns(1)
			t.Cleanup(func() { require.NoError(t, sqlDB.Close()) })
			var version string
			query := "SELECT VERSION()"
			if dialect == "sqlite" {
				query = "SELECT sqlite_version()"
			}
			require.NoError(t, db.Raw(query).Scan(&version).Error)
			t.Logf("%s version: %s", dialect, version)
			require.NoError(t, db.AutoMigrate(&model.Log{}, &model.User{}))
			t.Cleanup(func() { require.NoError(t, db.Migrator().DropTable(&model.Log{}, &model.User{})) })
			require.NoError(t, db.Create(&model.User{Id: 1, Username: "request-id-test"}).Error)
			oldDB, oldLogDB := model.DB, model.LOG_DB
			oldRedis, oldConsume, oldExport := common.RedisEnabled, common.LogConsumeEnabled, common.DataExportEnabled
			model.DB, model.LOG_DB = db, db
			common.RedisEnabled, common.LogConsumeEnabled, common.DataExportEnabled = false, true, false
			t.Cleanup(func() {
				model.DB, model.LOG_DB = oldDB, oldLogDB
				common.RedisEnabled, common.LogConsumeEnabled, common.DataExportEnabled = oldRedis, oldConsume, oldExport
			})
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			c.Request = httptest.NewRequest(http.MethodPost, "/relay", nil)
			c.Set(common.RequestIdKey, "local-id")
			c.Set("username", "request-id-test")
			service.CaptureUpstreamRequestChain(c, http.Header{"X-Client-Request-Id": {"first-client"}, "X-Request-Id": {"first-request"}}, service.BeginUpstreamRequestAttempt(c, 177, constant.ChannelTypeSub2API))
			intermediate := model.NewLogOther()
			intermediate.SetAdmin("retry_intermediate", true)
			model.RecordErrorLog(c, 1, 1, "test-model", "", "", "upstream error", 0, 0, false, "default", intermediate)
			service.CaptureUpstreamRequestChain(c, http.Header{"X-Client-Request-Id": {"second-client"}, "X-Request-Id": {"second-request"}}, service.BeginUpstreamRequestAttempt(c, 177, constant.ChannelTypeSub2API))
			model.RecordConsumeLog(c, 1, model.RecordConsumeLogParams{ModelName: "test-model"})
			service.BeginUpstreamRequestAttempt(c, 178, constant.ChannelTypeSub2API)
			model.RecordErrorLog(c, 1, 1, "test-model", "", "", "network error", 0, 0, false, "default", model.NewLogOther())
			var logs []model.Log
			require.NoError(t, db.Order("id ASC").Find(&logs).Error)
			require.Len(t, logs, 3)
			for i, primary := range []string{"first-client", "second-client", ""} {
				assert.Equal(t, "local-id", logs[i].RequestId)
				assert.Equal(t, primary, logs[i].UpstreamRequestId)
				var other struct {
					AdminInfo struct {
						Chain        []common.UpstreamRequestAttempt `json:"upstream_request_chain"`
						IDs          []string                        `json:"upstream_request_ids"`
						Sources      map[string]string               `json:"upstream_request_id_sources"`
						Intermediate bool                            `json:"retry_intermediate"`
					} `json:"admin_info"`
				}
				require.NoError(t, common.UnmarshalJsonStr(logs[i].Other, &other))
				expectedIDs := []string{"first-client", "first-request"}
				expectedSources := map[string]string{"first-client": "x-client-request-id", "first-request": "x-request-id"}
				if i > 0 {
					expectedIDs = append(expectedIDs, "second-client", "second-request")
					expectedSources["second-request"] = "x-request-id"
					expectedSources["second-client"] = "x-client-request-id"
				}
				require.Len(t, other.AdminInfo.Chain, i+1)
				for j, attempt := range other.AdminInfo.Chain {
					assert.Equal(t, j+1, attempt.Attempt)
					if j == 2 {
						assert.Equal(t, 178, attempt.ChannelID)
						assert.Empty(t, attempt.Nodes)
						continue
					}
					assert.Equal(t, 177, attempt.ChannelID)
					require.Len(t, attempt.Nodes, 2)
					assert.Equal(t, expectedIDs[j*2], attempt.Nodes[0].ID)
					assert.Equal(t, expectedIDs[j*2+1], attempt.Nodes[1].ID)
					assert.Equal(t, "client_correlation", attempt.Nodes[0].Role)
					assert.Equal(t, "provider_request", attempt.Nodes[1].Role)
				}
				assert.Equal(t, expectedIDs, other.AdminInfo.IDs)
				assert.Equal(t, expectedSources, other.AdminInfo.Sources)
				assert.Equal(t, i == 0, other.AdminInfo.Intermediate)
			}
		})
	}
}
