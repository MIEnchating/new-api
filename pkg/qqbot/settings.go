package qqbot

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hkdf"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"maps"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/go-redis/redis/v8"
)

var (
	ErrSettingsConflict = errors.New("QQ bot settings changed. Reload them and try again.")
	ErrSettingsKey      = errors.New("Set a persistent CRYPTO_SECRET or SESSION_SECRET to save QQ bot settings.")
)

// SettingsUpdate contains the fields accepted from the root settings form.
// Empty credentials preserve the current values unless their corresponding
// App ID or model is cleared.
type SettingsUpdate struct {
	PublicSettingsFields
	Revision    string `json:"revision,omitempty"`
	AppSecret   string `json:"app_secret,omitempty"`
	ChatKey     string `json:"chat_key,omitempty"`
	ChatOwnerID int    `json:"chat_owner_id,omitempty"`
}

type PublicSettingsFields struct {
	Enabled      bool   `json:"enabled"`
	AppID        string `json:"app_id"`
	Groups       string `json:"groups"`
	NotifyGroups string `json:"notify_groups"`
	SiteURL      string `json:"site_url"`
	ChatModel    string `json:"chat_model"`
	ChatSource   string `json:"chat_source"`
	ChatProtocol string `json:"chat_protocol"`
	ChatBaseURL  string `json:"chat_base_url"`
	ChatTokenID  int    `json:"chat_token_id"`
	ChatGroup    string `json:"chat_group"`
}

type PublicSettings struct {
	PublicSettingsFields
	Revision            string `json:"revision"`
	AppSecretConfigured bool   `json:"app_secret_configured"`
	ChatKeyConfigured   bool   `json:"chat_key_configured"`
	LegacyChatKey       bool   `json:"legacy_chat_key"`
	CallbackPath        string `json:"callback_path"`
}

// Runtime swaps callback configuration when the persisted option changes.
// Replay and rate-limit claims survive replacements of the bot instance.
type Runtime struct {
	host, port  string
	state       func() string
	storeKey    string
	env         SettingsUpdate
	envErr      error
	redis       *redis.Client
	claims      callbackClaims
	discovery   groupDiscovery
	mu          sync.Mutex
	bot         *Bot
	revision    string
	loaded      bool
	closed      bool
	gateway     http.Handler
	noticeQueue chan channelNotice
	stopNotices func()
	noticeJobs  sync.WaitGroup
}

func NewRuntime(host, port string, redisClient *redis.Client, state func() string) *Runtime {
	env, err := settingsFromEnv()
	r := &Runtime{
		host: host, port: port, redis: redisClient, state: state, env: env, envErr: err,
		claims: callbackClaims{expires: make(map[string]time.Time)},
	}
	if os.Getenv("CRYPTO_SECRET") != "" || os.Getenv("SESSION_SECRET") != "" {
		r.storeKey = common.CryptoSecret
	}
	return r
}

// AttachGateway connects built-in chat to the host's ordinary relay routes.
// It is set during router initialization before requests are served.
func (r *Runtime) AttachGateway(gateway http.Handler) {
	r.gateway = gateway
}

func (r *Runtime) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	bot := r.currentBot()
	if bot == nil {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	bot.ServeHTTP(w, req)
}

func (r *Runtime) currentBot() *Bot {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed {
		return nil
	}
	encoded := r.state()
	if r.loaded && encoded == r.revision {
		return r.bot
	}
	r.loaded, r.revision = true, encoded
	if r.bot != nil {
		r.bot.Close()
		r.bot = nil
	}
	settings, err := r.read(encoded)
	if err == nil && settings.Enabled {
		var cfg config
		cfg, err = settings.compile(r.host, r.port)
		if err == nil {
			cfg.gateway = r.gateway
			r.bot = newBot(cfg, r.redis)
			r.bot.claims = &r.claims
			r.bot.discovery = &r.discovery
		}
	}
	if err != nil {
		common.SysError(common.LogText("QQ bot configuration failed: %v", err))
	}
	return r.bot
}

func (r *Runtime) Close() {
	if r.stopNotices != nil {
		r.stopNotices()
	}
	r.mu.Lock()
	r.closed = true
	if r.bot != nil {
		r.bot.Close()
		r.bot = nil
	}
	r.mu.Unlock()
	r.noticeJobs.Wait()
}

// Refresh applies settings saved on this node before returning to the console.
func (r *Runtime) Refresh() {
	r.currentBot()
}

func (r *Runtime) ActiveAppID() string {
	if bot := r.currentBot(); bot != nil {
		return bot.appID
	}
	return ""
}

func (r *Runtime) ActiveGroups(appID string) map[string]struct{} {
	if bot := r.currentBot(); bot != nil && bot.appID == appID {
		return maps.Clone(bot.groups)
	}
	return nil
}

func (r *Runtime) Settings(encoded string) (PublicSettings, error) {
	settings, err := r.read(encoded)
	if err != nil && encoded != "" {
		return PublicSettings{}, err
	}
	return PublicSettings{
		PublicSettingsFields: settings.PublicSettingsFields,
		Revision:             settingsRevision(encoded),
		AppSecretConfigured:  settings.AppSecret != "",
		ChatKeyConfigured:    settings.ChatSource == ChatSourceExternal && settings.ChatKey != "",
		LegacyChatKey:        settings.ChatSource == ChatSourceBuiltin && settings.ChatTokenID == 0 && settings.ChatKey != "",
		CallbackPath:         WebhookPath,
	}, nil
}

func (r *Runtime) PrepareUpdate(encoded string, input SettingsUpdate, ownerID int) (string, error) {
	if input.Revision != settingsRevision(encoded) {
		return "", ErrSettingsConflict
	}
	if r.storeKey == "" {
		return "", ErrSettingsKey
	}
	previous, err := r.read(encoded)
	if err != nil && encoded != "" {
		return "", err
	}
	input.Revision = ""
	legacyRequest := input.ChatSource == ""
	input.normalize()
	switch {
	case input.AppID == "":
		input.AppSecret = ""
	case input.AppID == previous.AppID && input.AppSecret == "":
		input.AppSecret = previous.AppSecret
	}
	input.ChatOwnerID = 0
	switch input.ChatSource {
	case ChatSourceDisabled:
		input.ChatModel, input.ChatBaseURL, input.ChatKey, input.ChatGroup = "", "", "", ""
		input.ChatTokenID = 0
	case ChatSourceBuiltin:
		input.ChatBaseURL = ""
		switch {
		case input.ChatTokenID > 0:
			input.ChatKey = ""
			input.ChatOwnerID = ownerID
		case previous.ChatSource == ChatSourceBuiltin && previous.ChatTokenID == 0 && previous.ChatKey != "":
			input.ChatGroup = ""
			if !legacyRequest || input.ChatKey == "" {
				input.ChatKey = previous.ChatKey
			}
		case legacyRequest && input.ChatKey != "":
			input.ChatGroup = ""
		default:
			input.ChatKey = ""
		}
	case ChatSourceExternal:
		input.ChatTokenID = 0
		input.ChatGroup = ""
		if input.ChatKey == "" && previous.ChatSource == ChatSourceExternal && previous.ChatBaseURL == input.ChatBaseURL {
			input.ChatKey = previous.ChatKey
		}
	}
	if _, err := input.compile(r.host, r.port); err != nil {
		return "", err
	}
	raw, err := common.Marshal(input)
	if err != nil {
		return "", err
	}
	box, err := r.settingsCipher()
	if err != nil {
		return "", err
	}
	return "v1:" + hex.EncodeToString(box.Seal(nil, nil, raw, []byte("qqbot.settings.v1"))), nil
}

func (r *Runtime) read(encoded string) (SettingsUpdate, error) {
	if encoded == "" {
		return r.env, r.envErr
	}
	payload, ok := strings.CutPrefix(encoded, "v1:")
	if !ok {
		return SettingsUpdate{}, errors.New("Could not read the saved QQ bot settings.")
	}
	box, err := r.settingsCipher()
	if err != nil {
		return SettingsUpdate{}, err
	}
	ciphertext, err := hex.DecodeString(payload)
	if err == nil {
		var data []byte
		data, err = box.Open(nil, nil, ciphertext, []byte("qqbot.settings.v1"))
		if err == nil {
			var settings SettingsUpdate
			if common.Unmarshal(data, &settings) == nil {
				settings.normalize()
				return settings, nil
			}
		}
	}
	return SettingsUpdate{}, errors.New("Could not read the saved QQ bot settings.")
}

func (r *Runtime) settingsCipher() (cipher.AEAD, error) {
	if r.storeKey == "" {
		return nil, ErrSettingsKey
	}
	key, err := hkdf.Key(sha256.New, []byte(r.storeKey), nil, "qqbot.settings.v1", 32)
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	return cipher.NewGCMWithRandomNonce(block)
}

func settingsRevision(encoded string) string {
	digest := sha256.Sum256([]byte(encoded))
	return hex.EncodeToString(digest[:])
}

func (s *SettingsUpdate) normalize() {
	s.AppID = strings.TrimSpace(s.AppID)
	s.AppSecret = strings.TrimSpace(s.AppSecret)
	s.Groups = strings.TrimSpace(s.Groups)
	s.NotifyGroups = strings.TrimSpace(s.NotifyGroups)
	s.SiteURL = strings.TrimSpace(s.SiteURL)
	s.ChatModel = strings.TrimSpace(s.ChatModel)
	s.ChatKey = strings.TrimSpace(s.ChatKey)
	s.ChatGroup = strings.TrimSpace(s.ChatGroup)
	s.ChatBaseURL = strings.TrimRight(strings.TrimSpace(s.ChatBaseURL), "/")
	if s.ChatSource == "" {
		s.ChatSource = ChatSourceDisabled
		if s.ChatModel != "" || s.ChatKey != "" {
			s.ChatSource = ChatSourceBuiltin
		}
	}
	if s.ChatProtocol == "" {
		s.ChatProtocol = ChatProtocolCompletions
	}
}

func (s SettingsUpdate) compile(host, port string) (config, error) {
	cfg := config{
		appID: s.AppID, appSecret: s.AppSecret, groups: make(map[string]struct{}),
		siteURL: s.SiteURL, chatModel: s.ChatModel, chatKey: s.ChatKey,
		chatProtocol: s.ChatProtocol, chatSource: s.ChatSource,
		chatTokenID: s.ChatTokenID, chatOwnerID: s.ChatOwnerID, chatGroup: s.ChatGroup,
	}
	if s.ChatTokenID < 0 || len(s.AppSecret) > 1024 || len(s.ChatKey) > 1024 || len(s.Groups) > 8192 || len(s.NotifyGroups) > 2048 || len(s.SiteURL) > 2048 || len(s.ChatModel) > 256 {
		return config{}, common.NewMessage("Invalid parameters")
	}
	if s.AppID != "" && !groupOpenID.MatchString(s.AppID) {
		return config{}, common.NewMessage("Invalid QQ bot App ID")
	}
	if s.Enabled && (s.AppID == "" || s.AppSecret == "") {
		return config{}, common.NewMessage("Enter the QQ bot App ID and App Secret before enabling it.")
	}
	for group := range strings.SplitSeq(s.Groups, ",") {
		group = strings.TrimSpace(group)
		if group == "" {
			continue
		}
		if !groupOpenID.MatchString(group) {
			return config{}, common.NewMessage("Enter valid group OpenIDs separated by commas.")
		}
		cfg.groups[group] = struct{}{}
	}
	notifyGroups := make(map[string]struct{})
	for group := range strings.SplitSeq(s.NotifyGroups, ",") {
		group = strings.TrimSpace(group)
		if group == "" {
			continue
		}
		if _, allowed := cfg.groups[group]; !allowed {
			return config{}, common.NewMessage("Channel notification groups must be in the allowed QQ groups.")
		}
		if _, exists := notifyGroups[group]; !exists {
			notifyGroups[group] = struct{}{}
			cfg.notifyGroups = append(cfg.notifyGroups, group)
		}
	}
	if s.SiteURL != "" {
		site, err := url.Parse(s.SiteURL)
		if err != nil || site.Scheme != "https" || site.Hostname() == "" || site.User != nil {
			return config{}, common.NewMessage("The website URL must use HTTPS.")
		}
	}
	path := ChatPath(s.ChatProtocol)
	if path == "" {
		return config{}, common.NewMessage("Invalid parameters")
	}
	switch s.ChatSource {
	case ChatSourceDisabled:
		cfg.chatModel = ""
		return cfg, nil
	case ChatSourceBuiltin:
		if s.ChatTokenID > 0 {
			if s.ChatGroup == "" || len(s.ChatGroup) > 64 || s.ChatModel == "" || s.ChatOwnerID <= 0 {
				return config{}, common.NewMessage("Select an API key, group, and model.")
			}
			cfg.chatURL = "http://localhost" + path
			return cfg, nil
		}
		if s.ChatModel == "" || s.ChatKey == "" {
			return config{}, common.NewMessage("The chat model and API key must be configured together.")
		}
	case ChatSourceExternal:
		base, err := parseExternalBaseURL(s.ChatBaseURL)
		if err != nil {
			return config{}, err
		}
		if s.ChatModel == "" || s.ChatKey == "" {
			return config{}, common.NewMessage("The chat model and API key must be configured together.")
		}
		cfg.chatURL = base.JoinPath(strings.TrimPrefix(path, "/v1/")).String()
		return cfg, nil
	default:
		return config{}, common.NewMessage("Invalid parameters")
	}
	switch host {
	case "", "0.0.0.0":
		host = "127.0.0.1"
	case "::":
		host = "::1"
	}
	if ip := net.ParseIP(host); host != "localhost" && (ip == nil || !ip.IsLoopback()) {
		// A listener bound to an explicit interface IP is also local.
		addrs, _ := net.InterfaceAddrs()
		local := false
		for _, addr := range addrs {
			if addr, ok := addr.(*net.IPNet); ok && addr.IP.Equal(ip) {
				local = true
				break
			}
		}
		if !local {
			return config{}, common.NewMessage("QQ bot chat requires a local gateway listener.")
		}
	}
	cfg.chatURL = "http://" + net.JoinHostPort(host, port) + path
	return cfg, nil
}

func settingsFromEnv() (SettingsUpdate, error) {
	settings := SettingsUpdate{
		PublicSettingsFields: PublicSettingsFields{
			Enabled: common.GetEnvOrDefaultBool("QQ_BOT_ENABLED", false), AppID: os.Getenv("QQ_BOT_APP_ID"),
			Groups: os.Getenv("QQ_BOT_GROUP_OPENIDS"), SiteURL: os.Getenv("QQ_BOT_SITE_URL"),
			ChatModel: os.Getenv("QQ_BOT_CHAT_MODEL"),
		},
	}
	appSecret, err := configuredSecret("QQ_BOT_APP_SECRET")
	if err != nil {
		return settings, err
	}
	chatKey, err := configuredSecret("QQ_BOT_CHAT_API_KEY")
	settings.AppSecret, settings.ChatKey = appSecret, chatKey
	settings.normalize()
	return settings, err
}

func configuredSecret(name string) (string, error) {
	value := strings.TrimSpace(os.Getenv(name))
	if path := os.Getenv(name + "_FILE"); path != "" {
		if value != "" {
			return "", fmt.Errorf("configure only one of %s and %s_FILE", name, name)
		}
		raw, err := os.ReadFile(path)
		if err != nil {
			return "", fmt.Errorf("could not read %s_FILE", name)
		}
		value = strings.TrimSpace(string(raw))
		if value == "" {
			return "", fmt.Errorf("%s_FILE is empty", name)
		}
	}
	return value, nil
}
