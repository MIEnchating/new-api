package qqbot

import (
	"context"
	"crypto/ed25519"
	"errors"
	"maps"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/service"
	"github.com/go-redis/redis/v8"
)

const (
	WebhookPath = "/api/qqbot/webhook"
	qqAPI       = "https://api.bot.qq.com"
)

var groupOpenID = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)

type config struct {
	appID        string
	appSecret    string
	groups       map[string]struct{}
	notifyGroups []string
	siteURL      string
	chatModel    string
	chatKey      string
	chatURL      string
	chatProtocol string
	chatSource   string
	chatTokenID  int
	chatOwnerID  int
	chatGroup    string
	gateway      http.Handler
}

// Bot accepts signed QQ callbacks and sends group or private messages.
type Bot struct {
	config
	qqAPI      string
	signingKey ed25519.PrivateKey
	qqClient   *http.Client
	chatClient *http.Client
	now        func() time.Time
	redis      *redis.Client

	claims    *callbackClaims
	discovery *groupDiscovery

	ctx    context.Context
	cancel context.CancelFunc
	slots  chan struct{}
	jobsMu sync.Mutex
	jobs   sync.WaitGroup

	tokenGate    chan struct{}
	accessToken  string
	tokenExpires time.Time
}

func newBot(cfg config, redisClient *redis.Client) *Bot {
	seed := make([]byte, ed25519.SeedSize)
	for i := range seed {
		seed[i] = cfg.appSecret[i%len(cfg.appSecret)]
	}
	noRedirect := func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	ctx, cancel := context.WithCancel(context.Background())
	chatClient := &http.Client{
		Timeout: 30 * time.Second, CheckRedirect: noRedirect,
		Transport: &http.Transport{MaxIdleConnsPerHost: 8, IdleConnTimeout: 30 * time.Second},
	}
	switch {
	case cfg.chatSource == ChatSourceExternal:
		chatClient = service.NewPublicHTTPSClient()
	case cfg.chatTokenID > 0:
		chatClient.Transport = builtinChatTransport{gateway: cfg.gateway, ownerID: cfg.chatOwnerID, tokenID: cfg.chatTokenID, group: cfg.chatGroup}
	}
	return &Bot{
		config:     cfg,
		qqAPI:      qqAPI,
		signingKey: ed25519.NewKeyFromSeed(seed),
		qqClient:   &http.Client{Timeout: 8 * time.Second, CheckRedirect: noRedirect},
		chatClient: chatClient,
		now:        time.Now,
		redis:      redisClient,
		claims:     &callbackClaims{expires: make(map[string]time.Time)},
		discovery:  &groupDiscovery{},
		ctx:        ctx,
		cancel:     cancel,
		slots:      make(chan struct{}, 8),
		tokenGate:  make(chan struct{}, 1),
	}
}

// Close stops accepting jobs, cancels active requests and waits for them to exit.
func (b *Bot) Close() {
	b.jobsMu.Lock()
	b.cancel()
	b.jobsMu.Unlock()
	b.jobs.Wait()
	b.chatClient.CloseIdleConnections()
}

// claim prevents two callbacks from processing the same message or passing the
// same cooldown. Redis shares the claim across replicas when configured.
type callbackClaims struct {
	mu          sync.Mutex
	expires     map[string]time.Time
	nextCleanup time.Time
}

func (b *Bot) claim(ctx context.Context, key string, ttl time.Duration) (bool, error) {
	key = "qqbot:" + b.appID + ":" + key
	if b.redis != nil {
		return b.redis.SetNX(ctx, key, "1", ttl).Result()
	}
	claims := b.claims
	claims.mu.Lock()
	defer claims.mu.Unlock()
	now := b.now()
	if now.After(claims.nextCleanup) {
		maps.DeleteFunc(claims.expires, func(_ string, expires time.Time) bool { return !now.Before(expires) })
		claims.nextCleanup = now.Add(time.Minute)
	}
	if now.Before(claims.expires[key]) {
		return false, nil
	}
	if len(claims.expires) >= 8192 {
		return false, errors.New("QQ bot callback capacity exhausted")
	}
	claims.expires[key] = now.Add(ttl)
	return true, nil
}

func (b *Bot) reply(ctx context.Context, event groupMessage, text string) {
	if err := b.sendReply(ctx, event, text); err != nil && ctx.Err() == nil {
		logger.LogWarn(ctx, common.LogText("QQ bot reply failed: %v", err))
	}
}

func (b *Bot) respond(ctx context.Context, event groupMessage) {
	text := strings.TrimSpace(event.Content)
	if event.Private {
		b.reply(ctx, event, b.privateAccountReply(ctx, event, text))
		return
	}
	// Some QQ payloads include a mention before the user's text.
	if rest, ok := strings.CutPrefix(text, "<@!"); ok {
		if _, following, ok := strings.Cut(rest, ">"); ok {
			text = strings.TrimSpace(following)
		}
	}
	command, _ := strings.CutPrefix(text, "/")
	switch strings.ToLower(command) {
	case "", "help", "帮助", "幫助", "菜单", "選單":
		help := i18n.Translate("", i18n.MsgQQBotHelp)
		if b.siteURL != "" {
			help += "\n" + i18n.Translate("", i18n.MsgQQBotHelpSite)
		}
		if b.chatModel != "" {
			help += "\n" + i18n.Translate("", i18n.MsgQQBotHelpChat)
		}
		if b.gateway != nil {
			help += "\n" + i18n.Translate("", i18n.MsgQQBotHelpSiteQueries)
			help += "\n" + i18n.Translate("", i18n.MsgQQBotUsePrivateChat)
		}
		b.reply(ctx, event, help)
	case "status", "状态", "狀態":
		b.reply(ctx, event, i18n.Translate("", i18n.MsgQQBotOnline))
	case "site", "官网", "官網":
		if b.siteURL == "" {
			b.reply(ctx, event, i18n.Translate("", i18n.MsgQQBotSiteUnavailable))
			return
		}
		b.reply(ctx, event, b.siteURL)
	default:
		if accountCommand(text) != "" {
			b.reply(ctx, event, i18n.Translate("", i18n.MsgQQBotUsePrivateChat))
			return
		}
		if reply, handled := b.siteCommand(ctx, command); handled {
			b.reply(ctx, event, reply)
			return
		}
		if b.chatModel == "" || strings.HasPrefix(text, "/") {
			b.reply(ctx, event, i18n.Translate("", i18n.MsgQQBotUnknownCommand))
			return
		}
		if len(text) > 8000 {
			b.reply(ctx, event, i18n.Translate("", i18n.MsgQQBotInputTooLong))
			return
		}
		allowed, err := b.claim(ctx, "chat:"+event.GroupID+":"+event.Author.OpenID, 8*time.Second)
		if err != nil {
			b.reply(ctx, event, i18n.Translate("", i18n.MsgQQBotChatUnavailable))
			return
		}
		if !allowed {
			b.reply(ctx, event, i18n.Translate("", i18n.MsgQQBotChatCooldown))
			return
		}
		answer, err := b.chat(ctx, text)
		if err != nil {
			logger.LogWarn(ctx, common.LogText("QQ bot chat failed: %v", err))
			answer = i18n.Translate("", i18n.MsgQQBotChatUnavailable)
		}
		b.reply(ctx, event, answer)
	}
}
