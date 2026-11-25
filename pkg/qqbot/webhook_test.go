package qqbot

import (
	"context"
	"crypto/ed25519"
	"encoding/hex"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/service"
	"github.com/alicebob/miniredis/v2"
	"github.com/gin-gonic/gin"
	"github.com/go-redis/redis/v8"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const (
	testAppID = "11111111"
	// QQ's documentation sample, with its published challenge signature.
	testSecret = "DG5g3B4j9X2KOErG"
)

var testTime = time.Unix(1725442341, 0)

func TestWebhookValidation(t *testing.T) {
	bot := newBot(config{appID: testAppID, appSecret: testSecret}, nil)
	t.Cleanup(bot.Close)
	bot.now = func() time.Time { return testTime }

	challenge := `{"d":{"plain_token":"Arq0D5A61EgUu4OxUvOp","event_ts":"1725442341"},"op":13}`
	w := performCallback(bot, challenge, testAppID, "", "")
	require.Equal(t, http.StatusOK, w.Code)
	assert.Equal(t, "no-store", w.Header().Get("Cache-Control"))
	assert.JSONEq(t, `{"plain_token":"Arq0D5A61EgUu4OxUvOp","signature":"87befc99c42c651b3aac0278e71ada338433ae26fcb24307bdc5ad38c1adc2d01bcfcadc0842edac85e85205028a1132afe09280305f13aa6909ffc2d652c706"}`, w.Body.String())

	// Production uses the same key for both operations. Check that only the
	// QQ token format can reach the unsigned challenge signer.
	for _, body := range []string{
		`{"op":13,"d":{"plain_token":"{\"op\":0}","event_ts":"1725442341"}}`,
		`{"op":13,"d":{"plain_token":"valid","event_ts":"1725440000"}}`,
		`{"op":13,"d":{"plain_token":"valid","event_ts":"1725442341"}}{}`,
		`{"t":"GROUP_AT_MESSAGE_CREATE","d":{}}`,
	} {
		assert.Equal(t, http.StatusBadRequest, performCallback(bot, body, testAppID, "", "").Code)
	}
	assert.Equal(t, http.StatusUnauthorized, performCallback(bot, challenge, "incorrect-app", "", "").Code)
	assert.Equal(t, http.StatusRequestEntityTooLarge, performCallback(bot, strings.Repeat(" ", 64<<10+1), testAppID, "", "").Code)
}

func TestQQBotDiscoveredGroups(t *testing.T) {
	for _, backend := range []string{"memory", "redis"} {
		t.Run(backend, func(t *testing.T) {
			var redisClient *redis.Client
			if backend == "redis" {
				server := miniredis.RunT(t)
				redisClient = redis.NewClient(&redis.Options{Addr: server.Addr()})
				t.Cleanup(func() { require.NoError(t, redisClient.Close()) })
			}
			state := &Runtime{
				env: SettingsUpdate{
					PublicSettingsFields: PublicSettingsFields{
						AppID: testAppID, Groups: "already-allowed", Enabled: true, ChatSource: ChatSourceDisabled,
					},
					AppSecret: testSecret,
				},
				state:  func() string { return "" },
				redis:  redisClient,
				claims: callbackClaims{expires: make(map[string]time.Time)},
			}
			t.Cleanup(state.Close)
			now := testTime
			bot := state.currentBot()
			require.NotNil(t, bot)
			bot.now = func() time.Time { return now }
			recipient := state
			if backend == "redis" {
				recipient = &Runtime{env: state.env, state: state.state, redis: redisClient}
				t.Cleanup(recipient.Close)
				reader := recipient.currentBot()
				require.NotNil(t, reader)
				reader.now = func() time.Time { return now }
			}

			mention := `{"op":0,"t":"GROUP_AT_MESSAGE_CREATE","d":{"id":"1","group_openid":"new-group","content":"hello","author":{"member_openid":"member"}}}`
			joined := `{"op":0,"t":"GROUP_ADD_ROBOT","d":{"group_openid":"another-group"}}`
			assert.Equal(t, http.StatusUnauthorized, performCallback(state, mention, testAppID, "", "").Code)
			groups, err := recipient.DiscoveredGroups(t.Context())
			require.NoError(t, err)
			assert.Empty(t, groups)

			for _, body := range []string{mention, joined, mention} {
				now = now.Add(time.Second)
				timestamp, signature := signCallback(body, now)
				require.Equal(t, http.StatusOK, performCallback(state, body, testAppID, timestamp, signature).Code)
			}
			groups, err = recipient.DiscoveredGroups(t.Context())
			require.NoError(t, err)
			assert.Equal(t, []string{"new-group", "another-group"}, groups)

			now = now.Add(discoveredGroupTTL - time.Second)
			groups, err = recipient.DiscoveredGroups(t.Context())
			require.NoError(t, err)
			assert.Equal(t, []string{"new-group"}, groups)
		})
	}
}

func TestWebhookRejectsUnauthenticatedEvents(t *testing.T) {
	bot := newBot(config{appID: testAppID, appSecret: testSecret, groups: map[string]struct{}{"group": {}}}, nil)
	t.Cleanup(bot.Close)
	bot.now = func() time.Time { return testTime }
	body := `{"op":0,"t":"GROUP_AT_MESSAGE_CREATE","d":{"id":"1","group_openid":"group","content":"hello","author":{"member_openid":"member"}}}`
	now, signature := signCallback(body, testTime)
	stale, staleSignature := signCallback(body, testTime.Add(-6*time.Minute))
	future, futureSignature := signCallback(body, testTime.Add(2*time.Minute))
	for _, tt := range []struct {
		name      string
		body      string
		app       string
		timestamp string
		signature string
	}{
		{"unsigned", body, testAppID, "", ""},
		{"other app", body, "another-app", now, signature},
		{"tampered body", strings.Replace(body, "hello", "different", 1), testAppID, now, signature},
		{"expired", body, testAppID, stale, staleSignature},
		{"future", body, testAppID, future, futureSignature},
	} {
		t.Run(tt.name, func(t *testing.T) {
			got := performCallback(bot, tt.body, tt.app, tt.timestamp, tt.signature)
			assert.Equal(t, http.StatusUnauthorized, got.Code)
		})
	}
}

func TestGroupReplyAndReplayProtection(t *testing.T) {
	require.NoError(t, i18n.Init())
	for _, mode := range []string{"memory", "shared Redis"} {
		t.Run(mode, func(t *testing.T) {
			type outboundReply struct {
				MsgID   string `json:"msg_id"`
				MsgSeq  int    `json:"msg_seq"`
				Content string `json:"content"`
			}
			var mu sync.Mutex
			var replies []outboundReply
			var prompts []string
			tokenRequests := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				assert.Equal(t, http.MethodPost, r.Method)
				mu.Lock()
				defer mu.Unlock()
				switch r.URL.Path {
				case "/app/getAppAccessToken":
					tokenRequests++
					var credentials map[string]string
					assert.NoError(t, common.DecodeJsonBody(r.Body, &credentials))
					assert.Equal(t, map[string]string{"appId": testAppID, "clientSecret": testSecret}, credentials)
					_, _ = io.WriteString(w, `{"access_token":"qq-token","expires_in":"7200"}`)
				case "/v2/groups/allowed/messages":
					assert.Equal(t, "QQBot qq-token", r.Header.Get("Authorization"))
					var reply outboundReply
					assert.NoError(t, common.DecodeJsonBody(r.Body, &reply))
					replies = append(replies, reply)
					_, _ = io.WriteString(w, `{"id":"qq-reply"}`)
				case "/v1/chat/completions":
					assert.Equal(t, "Bearer gateway-key", r.Header.Get("Authorization"))
					var chat struct {
						Model    string              `json:"model"`
						Messages []map[string]string `json:"messages"`
					}
					assert.NoError(t, common.DecodeJsonBody(r.Body, &chat))
					assert.Equal(t, "configured-model", chat.Model)
					if assert.Len(t, chat.Messages, 1) {
						assert.Equal(t, "user", chat.Messages[0]["role"])
						prompts = append(prompts, chat.Messages[0]["content"])
					}
					_, _ = io.WriteString(w, `{"choices":[{"message":{"content":"AI reply"}}]}`)
				default:
					t.Errorf("unexpected HTTP path %q", r.URL.Path)
					w.WriteHeader(http.StatusNotFound)
				}
			}))
			t.Cleanup(server.Close)
			var redisClient *redis.Client
			if mode == "shared Redis" {
				redisClient = redis.NewClient(&redis.Options{Addr: miniredis.RunT(t).Addr()})
				t.Cleanup(func() { require.NoError(t, redisClient.Close()) })
			}
			cfg := config{
				appID: testAppID, appSecret: testSecret, groups: map[string]struct{}{"allowed": {}},
				siteURL: "https://example.com", chatModel: "configured-model", chatKey: "gateway-key",
				chatURL: server.URL + "/v1/chat/completions",
			}
			bot := newBot(cfg, redisClient)
			t.Cleanup(bot.Close)
			bot.now, bot.qqAPI = func() time.Time { return testTime }, server.URL
			duplicateBot := bot
			if redisClient != nil {
				duplicateBot = newBot(cfg, redisClient)
				t.Cleanup(duplicateBot.Close)
				duplicateBot.now, duplicateBot.qqAPI = bot.now, bot.qqAPI
			}
			events := []struct {
				bot     *Bot
				payload string
			}{
				{bot, `{"op":0,"t":"GROUP_AT_MESSAGE_CREATE","d":{"id":"help","group_openid":"allowed","author":{"member_openid":"member"},"content":" /帮助 "}}`},
				{bot, `{"op":0,"t":"GROUP_AT_MESSAGE_CREATE","d":{"id":"site","group_openid":"allowed","author":{"member_openid":"member"},"content":"/官网"}}`},
				{bot, `{"op":0,"t":"GROUP_AT_MESSAGE_CREATE","d":{"id":"chat","group_openid":"allowed","author":{"member_openid":"member"},"content":"<@!bot> hello"}}`},
				{duplicateBot, `{"id":"retried-event","op":0,"t":"GROUP_AT_MESSAGE_CREATE","d":{"id":"chat","group_openid":"allowed","author":{"member_openid":"member"},"content":"<@!bot> hello"}}`},
				{bot, `{"op":0,"t":"GROUP_AT_MESSAGE_CREATE","d":{"id":"cooldown","group_openid":"allowed","author":{"member_openid":"member"},"content":"another question"}}`},
				{bot, `{"op":0,"t":"GROUP_AT_MESSAGE_CREATE","d":{"id":"other","group_openid":"blocked","author":{"member_openid":"member"},"content":"no reply"}}`},
				{bot, `{"op":0,"t":"GROUP_AT_MESSAGE_CREATE","d":{"id":"bot","group_openid":"allowed","author":{"member_openid":"member","bot":true},"content":"no reply"}}`},
				{bot, `{"op":0,"t":"GROUP_MESSAGE_CREATE","d":{"id":"regular","group_openid":"allowed","content":"no reply"}}`},
			}
			for _, event := range events {
				timestamp, signature := signCallback(event.payload, testTime)
				response := performCallback(event.bot, event.payload, testAppID, timestamp, signature)
				require.Equal(t, http.StatusOK, response.Code)
				assert.JSONEq(t, `{"op":12}`, response.Body.String())
				event.bot.jobs.Wait()
			}
			mu.Lock()
			defer mu.Unlock()
			require.Len(t, replies, 4)
			assert.Equal(t, []string{"hello"}, prompts)
			assert.Equal(t, 1, tokenRequests)
			assert.Equal(t, outboundReply{
				MsgID: "help", MsgSeq: 1, Content: i18n.Translate("", i18n.MsgQQBotHelp) + "\n" +
					i18n.Translate("", i18n.MsgQQBotHelpSite) + "\n" + i18n.Translate("", i18n.MsgQQBotHelpChat),
			}, replies[0])
			assert.Equal(t, outboundReply{MsgID: "site", MsgSeq: 1, Content: "https://example.com"}, replies[1])
			assert.Equal(t, outboundReply{MsgID: "chat", MsgSeq: 1, Content: "AI reply"}, replies[2])
			assert.Equal(t, outboundReply{MsgID: "cooldown", MsgSeq: 1, Content: i18n.Translate("", i18n.MsgQQBotChatCooldown)}, replies[3])
		})
	}
}

func TestQQBotPublicSiteCommands(t *testing.T) {
	require.NoError(t, i18n.Init())
	previousLanguage := common.DefaultLanguage
	common.DefaultLanguage = i18n.LangEn
	t.Cleanup(func() { common.DefaultLanguage = previousLanguage })
	common.OptionMapRWMutex.Lock()
	previousOptions := common.OptionMap
	common.OptionMap = map[string]string{"ServerAddress": "https://dashboard.example"}
	common.OptionMapRWMutex.Unlock()
	t.Cleanup(func() {
		common.OptionMapRWMutex.Lock()
		common.OptionMap = previousOptions
		common.OptionMapRWMutex.Unlock()
	})

	gateway := gin.New()
	gateway.GET("/api/pricing", middleware.HeaderNavModuleAuth("pricing"), func(c *gin.Context) {
		assert.Empty(t, c.GetHeader("Authorization"))
		assert.Empty(t, c.GetHeader("Cookie"))
		c.Data(http.StatusOK, "application/json", []byte(`{"success":true,"data":[
		    {"model_name":"text/model","quota_type":0,"model_ratio":1.5,"completion_ratio":4,"cache_ratio":0.2},
		    {"model_name":"text-tiers","quota_type":0,"model_ratio":1,"completion_ratio":2,"billing_mode":"tiered_expr"},
		    {"model_name":"image-fixed","quota_type":1,"model_price":0.04}
		]}`))
	})
	gateway.GET("/api/uptime/status", middleware.SiteStatusTabAuth("uptime"), func(c *gin.Context) {
		assert.Equal(t, "requests", c.Query("source"))
		assert.Empty(t, c.GetHeader("Authorization"))
		c.Data(http.StatusOK, "application/json", []byte(`{"success":true,"request_stats":{"1h":{"has_data":true,"request_count":10,"success_rate":90},"by_group":{"default":{"1h":{"has_data":true,"request_count":8,"success_rate":87.5}}}}}`))
	})

	replies := make(chan string, 1)
	qq := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		switch req.URL.Path {
		case "/app/getAppAccessToken":
			_, _ = io.WriteString(w, `{"access_token":"qq-token","expires_in":"7200"}`)
		case "/v2/groups/allowed/messages":
			var reply struct{ Content string }
			if assert.NoError(t, common.DecodeJsonBody(req.Body, &reply)) {
				replies <- reply.Content
			}
			_, _ = io.WriteString(w, `{"id":"reply-id"}`)
		default:
			assert.Failf(t, "unexpected request", "%s", req.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(qq.Close)
	bot := newBot(config{
		appID: testAppID, appSecret: testSecret, groups: map[string]struct{}{"allowed": {}},
		gateway: gateway, chatModel: "configured-model", chatURL: qq.URL + "/v1/chat/completions", chatKey: "model-secret",
	}, nil)
	t.Cleanup(bot.Close)
	bot.now, bot.qqAPI = func() time.Time { return testTime }, qq.URL
	for i, tc := range []struct {
		command, policy    string
		includes, excludes []string
	}{
		{"/帮助", "", []string{"/models", "/price", "/channels"}, nil},
		{"/模型　TEXT", "", []string{"(2)", "text/model", "text-tiers"}, []string{"image-fixed"}},
		{"/价格 text/model", "", []string{"USD 3 input", "USD 12 output", "USD 0.6", "/pricing/text%2Fmodel"}, nil},
		{"/price image-fixed", "", []string{"per request is USD 0.04"}, nil},
		{"/价格 text-tiers", "", []string{"full pricing rules", "/pricing/text-tiers"}, []string{"USD"}},
		{"/价格", "", []string{"<full model name>"}, nil},
		{"/价格 private-model", "", []string{"public model was not found"}, nil},
		{"渠道状态", "", []string{"All groups · 10 requests", "default · 8 requests · 87.5%"}, nil},
		{"/渠道状态 default", "", []string{"default · 8 requests"}, []string{"All groups"}},
		{"/channels no-samples", "", []string{"No request samples"}, []string{"0.0%"}},
		{"/模型", `{"pricing":{"requireAuth":true}}`, []string{"information is private"}, []string{"text/model"}},
		{"/渠道状态", `{"siteStatus":{"tabs":{"uptime":false}}}`, []string{"information is private"}, []string{"All groups"}},
	} {
		t.Run(tc.command, func(t *testing.T) {
			common.OptionMapRWMutex.Lock()
			common.OptionMap["HeaderNavModules"] = tc.policy
			common.OptionMapRWMutex.Unlock()
			data, err := common.Marshal(map[string]any{
				"op": 0, "t": groupAtMessageCreate, "d": map[string]any{
					"id": strconv.Itoa(i), "group_openid": "allowed", "content": tc.command,
					"author": map[string]string{"member_openid": "member"},
				},
			})
			require.NoError(t, err)
			body := string(data)
			ts, signature := signCallback(body, testTime)
			require.Equal(t, http.StatusOK, performCallback(bot, body, testAppID, ts, signature).Code)
			bot.jobs.Wait()
			require.Len(t, replies, 1)
			reply := <-replies
			for _, text := range tc.includes {
				assert.Contains(t, reply, text)
			}
			for _, text := range tc.excludes {
				assert.NotContains(t, reply, text)
			}
		})
	}
}

func TestQQBotPersonalRepliesAndNotificationsUseSeparateTargets(t *testing.T) {
	require.NoError(t, i18n.Init())
	type outbound struct {
		path, messageID, content string
	}
	sent := make(chan outbound, 3)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/app/getAppAccessToken" {
			_, _ = io.WriteString(w, `{"access_token":"qq-token","expires_in":"7200"}`)
			return
		}
		var request struct {
			MessageID string `json:"msg_id"`
			Content   string `json:"content"`
		}
		assert.NoError(t, common.DecodeJsonBody(r.Body, &request))
		sent <- outbound{r.URL.Path, request.MessageID, request.Content}
		_, _ = io.WriteString(w, `{"id":"qq-reply"}`)
	}))
	t.Cleanup(server.Close)
	settings := SettingsUpdate{
		PublicSettingsFields: PublicSettingsFields{
			AppID: testAppID, Enabled: true, Groups: "allowed, other", NotifyGroups: "other, other", ChatSource: ChatSourceDisabled,
		}, AppSecret: testSecret,
	}
	cfg, err := settings.compile("localhost", "3001")
	require.NoError(t, err)
	invalid := settings
	invalid.NotifyGroups = "unknown"
	_, err = invalid.compile("localhost", "3001")
	require.ErrorContains(t, err, "allowed QQ groups")
	bot := newBot(cfg, nil)
	t.Cleanup(bot.Close)
	bot.now, bot.qqAPI = func() time.Time { return testTime }, server.URL
	for _, body := range []string{
		`{"op":0,"t":"GROUP_AT_MESSAGE_CREATE","d":{"id":"group","group_openid":"allowed","content":"/余额","author":{"member_openid":"member"}}}`,
		`{"op":0,"t":"C2C_MESSAGE_CREATE","d":{"id":"private","content":"/帮助","author":{"user_openid":"private-user"}}}`,
	} {
		ts, sig := signCallback(body, testTime)
		require.Equal(t, http.StatusOK, performCallback(bot, body, testAppID, ts, sig).Code)
		bot.jobs.Wait()
	}
	bot.deliverChannelNotice(channelNotice{id: 3, name: "Test channel", status: common.ChannelStatusAutoDisabled})
	require.Len(t, sent, 3)
	assert.Equal(t, outbound{"/v2/groups/allowed/messages", "group", i18n.Translate("", i18n.MsgQQBotUsePrivateChat)}, <-sent)
	assert.Equal(t, outbound{"/v2/users/private-user/messages", "private", i18n.Translate("", i18n.MsgQQBotPrivateHelp)}, <-sent)
	assert.Equal(t, outbound{"/v2/groups/other/messages", "", i18n.Translate("", i18n.MsgQQBotChannelFault, map[string]any{"Name": "Test channel"})}, <-sent)
}

func TestNewFromEnvRequiresCompleteConfiguration(t *testing.T) {
	t.Setenv("QQ_BOT_ENABLED", "false")
	disabled := NewRuntime("", "3000", nil, func() string { return "" })
	t.Cleanup(disabled.Close)
	require.Nil(t, disabled.currentBot())

	file := filepath.Join(t.TempDir(), "qq-bot-secret")
	require.NoError(t, os.WriteFile(file, []byte(testSecret+"\n"), 0600))
	t.Setenv("QQ_BOT_ENABLED", "true")
	t.Setenv("QQ_BOT_APP_ID", testAppID)
	t.Setenv("QQ_BOT_APP_SECRET", "")
	t.Setenv("QQ_BOT_APP_SECRET_FILE", file)
	t.Setenv("QQ_BOT_GROUP_OPENIDS", "")
	t.Setenv("QQ_BOT_SITE_URL", "")
	t.Setenv("QQ_BOT_CHAT_MODEL", "example")
	t.Setenv("QQ_BOT_CHAT_API_KEY", "")
	t.Setenv("QQ_BOT_CHAT_API_KEY_FILE", "")
	draft, err := settingsFromEnv()
	require.NoError(t, err)
	_, err = draft.compile("", "3000")
	require.ErrorContains(t, err, "must be configured together")

	t.Setenv("QQ_BOT_CHAT_API_KEY", "gateway-key")
	t.Setenv("QQ_BOT_GROUP_OPENIDS", "first, second")
	runtime := NewRuntime("::", "3001", nil, func() string { return "" })
	t.Cleanup(runtime.Close)
	bot := runtime.currentBot()
	require.NotNil(t, bot)
	assert.Equal(t, "http://[::1]:3001/v1/chat/completions", bot.chatURL)
	assert.Equal(t, map[string]struct{}{"first": {}, "second": {}}, bot.groups)
	assert.Equal(t, testSecret, bot.appSecret)
}

func TestQQBotChatProtocolsAndExternalDestination(t *testing.T) {
	for _, tc := range []struct {
		protocol string
		path     string
		response string
	}{
		{ChatProtocolCompletions, "/v1/chat/completions", `{"choices":[{"message":{"content":"hello"}}]}`},
		{ChatProtocolResponses, "/v1/responses", `{"output":[{"type":"message","content":[{"type":"output_text","text":"hello"}]}]}`},
		{ChatProtocolMessages, "/v1/messages", `{"content":[{"type":"text","text":"hello"}]}`},
	} {
		t.Run(tc.protocol, func(t *testing.T) {
			server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
				assert.Equal(t, tc.path, req.URL.Path)
				if tc.protocol == ChatProtocolMessages {
					assert.Equal(t, "external-test-key", req.Header.Get("x-api-key"))
					assert.Empty(t, req.Header.Get("Authorization"))
				} else {
					assert.Equal(t, "Bearer external-test-key", req.Header.Get("Authorization"))
					assert.Empty(t, req.Header.Get("x-api-key"))
				}
				_, _ = io.WriteString(w, tc.response)
			}))
			t.Cleanup(server.Close)
			client := service.NewPublicHTTPSClient()
			_, err := client.Get(server.URL + tc.path)
			require.ErrorContains(t, err, "private IP address not allowed")

			bot := newBot(config{appSecret: testSecret, chatModel: "test-model", chatKey: "external-test-key", chatProtocol: tc.protocol, chatURL: server.URL + tc.path}, nil)
			t.Cleanup(bot.Close)
			bot.chatClient = server.Client()
			answer, err := bot.chat(context.Background(), "test prompt")
			require.NoError(t, err)
			assert.Equal(t, "hello", answer)
		})
	}
}

type modelListTransport func(*http.Request) (*http.Response, error)

func (f modelListTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}

func TestQQBotExternalModels(t *testing.T) {
	runtime := &Runtime{storeKey: "model-list-test-secret"}
	saved, err := runtime.PrepareUpdate("", SettingsUpdate{
		Revision: settingsRevision(""),
		PublicSettingsFields: PublicSettingsFields{
			ChatSource: ChatSourceExternal, ChatBaseURL: "https://provider.example/proxy/api",
			ChatModel: "old-model", ChatProtocol: ChatProtocolMessages,
		},
		ChatKey: "saved-provider-key",
	}, 1)
	require.NoError(t, err)

	t.Run("uses the unsaved OpenAI key and lists the same base path", func(t *testing.T) {
		client := &http.Client{Transport: modelListTransport(func(req *http.Request) (*http.Response, error) {
			assert.Equal(t, http.MethodGet, req.Method)
			assert.Equal(t, "https://another.example/v1/models", req.URL.String())
			assert.Equal(t, "Bearer unsaved-provider-key", req.Header.Get("Authorization"))
			assert.Empty(t, req.Header.Get("x-api-key"))
			return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(
				`{"data":[{"id":"z-model"},{"id":"a-model"},{"id":"z-model"},{"id":""},{"id":"unsaved-provider-key"}]}`,
			))}, nil
		})}
		models, err := runtime.fetchExternalModels(context.Background(), saved, ExternalModelsInput{
			ChatBaseURL: "https://another.example/", ChatProtocol: ChatProtocolResponses, ChatKey: "unsaved-provider-key",
		}, client)
		require.NoError(t, err)
		assert.Equal(t, []string{"a-model", "z-model"}, models)
	})

	t.Run("uses the saved Anthropic key and follows cursor pagination", func(t *testing.T) {
		client := &http.Client{Transport: modelListTransport(func(req *http.Request) (*http.Response, error) {
			assert.Equal(t, "/proxy/api/models", req.URL.Path)
			assert.Equal(t, "saved-provider-key", req.Header.Get("x-api-key"))
			assert.Equal(t, "2023-06-01", req.Header.Get("anthropic-version"))
			assert.Empty(t, req.Header.Get("Authorization"))
			body := `{"data":[{"id":"claude-first"}],"has_more":true,"last_id":"next/token"}`
			if req.URL.RawQuery != "" {
				assert.Equal(t, "next/token", req.URL.Query().Get("after_id"))
				body = `{"data":[{"id":"claude-second"}],"has_more":false}`
			}
			return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(body))}, nil
		})}
		models, err := runtime.fetchExternalModels(context.Background(), saved, ExternalModelsInput{
			ChatBaseURL: "https://provider.example/proxy/api/", ChatProtocol: ChatProtocolMessages,
		}, client)
		require.NoError(t, err)
		assert.Equal(t, []string{"claude-first", "claude-second"}, models)
	})

	t.Run("blocks private destinations and reusing the key with a different base", func(t *testing.T) {
		client := &http.Client{Transport: modelListTransport(func(req *http.Request) (*http.Response, error) {
			t.Fatal("must reject before contacting the provider")
			return nil, nil
		})}
		_, err := runtime.fetchExternalModels(context.Background(), saved, ExternalModelsInput{
			ChatBaseURL: "https://127.0.0.1:3001/v1", ChatProtocol: ChatProtocolMessages, ChatKey: "new-provider-key",
		}, client)
		require.ErrorContains(t, err, "public HTTPS")
		_, err = runtime.fetchExternalModels(context.Background(), saved, ExternalModelsInput{
			ChatBaseURL: "https://provider.example/other-tenant/api", ChatProtocol: ChatProtocolMessages,
		}, client)
		require.ErrorContains(t, err, "API key is required")
	})

	t.Run("returns a safe error for an invalid or unsuccessful upstream response", func(t *testing.T) {
		for _, status := range []int{http.StatusOK, http.StatusUnauthorized, http.StatusTemporaryRedirect} {
			client := &http.Client{Transport: modelListTransport(func(req *http.Request) (*http.Response, error) {
				return &http.Response{StatusCode: status, Body: io.NopCloser(strings.NewReader(
					`{"error":"should not expose upstream detail"}`,
				))}, nil
			})}
			_, err := runtime.fetchExternalModels(context.Background(), saved, ExternalModelsInput{
				ChatBaseURL: "https://provider.example/proxy/api", ChatProtocol: ChatProtocolMessages,
			}, client)
			assert.ErrorIs(t, err, ErrExternalModelFetch)
		}
	})
}

func performCallback(bot http.Handler, body, appID, timestamp, signature string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, WebhookPath, strings.NewReader(body))
	req.Header.Set("X-Bot-Appid", appID)
	req.Header.Set("X-Signature-Timestamp", timestamp)
	req.Header.Set("X-Signature-Ed25519", signature)
	w := httptest.NewRecorder()
	bot.ServeHTTP(w, req)
	return w
}

func signCallback(body string, at time.Time) (timestamp, signature string) {
	seed := []byte(testSecret + testSecret)
	timestamp = strconv.FormatInt(at.Unix(), 10)
	return timestamp, hex.EncodeToString(ed25519.Sign(ed25519.NewKeyFromSeed(seed), []byte(timestamp+body)))
}
