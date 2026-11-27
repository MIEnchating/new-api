package qqbot

import (
	"context"
	"math"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	perfmetrics "github.com/QuantumNous/new-api/pkg/perf_metrics"
	"github.com/shopspring/decimal"
)

const siteResultLimit = 6

func (b *Bot) siteCommand(ctx context.Context, text string) (string, bool) {
	command, argument := text, ""
	if i := strings.IndexFunc(text, unicode.IsSpace); i >= 0 {
		command, argument = text[:i], strings.TrimSpace(text[i:])
	}
	switch strings.ToLower(command) {
	case "models", "模型":
		return b.modelList(ctx, argument), true
	case "price", "价格", "價格":
		if argument == "" {
			return botText(i18n.MsgQQBotPriceUsage), true
		}
		return b.modelPrice(ctx, argument), true
	case "channels", "渠道状态", "渠道狀態":
		return b.channelStatus(ctx, argument), true
	default:
		return "", false
	}
}

// publicSiteResponse uses the ordinary dashboard endpoints as a guest. Bot
// credentials, model API keys and incoming QQ headers never reach these routes.
func (b *Bot) publicSiteResponse(ctx context.Context, path string, data any) (bool, string) {
	unavailable := botText(i18n.MsgQQBotSiteQueryUnavailable)
	if b.gateway == nil {
		return false, unavailable
	}
	ctx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "http://localhost"+path, nil)
	if err != nil {
		return false, unavailable
	}
	req.RemoteAddr = "127.0.0.1:0"
	req.RequestURI = req.URL.RequestURI()
	response := &gatewayResponseWriter{header: make(http.Header), limit: 8 << 20}
	b.gateway.ServeHTTP(response, req)
	switch response.status {
	case http.StatusUnauthorized, http.StatusForbidden:
		return false, botText(i18n.MsgQQBotSiteQueryPrivate)
	case http.StatusOK:
		if !response.truncated && common.Unmarshal(response.body.Bytes(), data) == nil {
			return true, ""
		}
	}
	return false, unavailable
}

type sitePricing struct {
	Data    []siteModelPrice `json:"data"`
	Success bool             `json:"success"`
}

type siteModelPrice struct {
	Name            string              `json:"model_name"`
	QuotaType       int                 `json:"quota_type"`
	ModelPrice      *float64            `json:"model_price"`
	ModelRatio      *float64            `json:"model_ratio"`
	CompletionRatio *float64            `json:"completion_ratio"`
	CacheReadRatio  *float64            `json:"cache_ratio"`
	CacheWriteRatio *float64            `json:"create_cache_ratio"`
	BillingMode     string              `json:"billing_mode"`
	PluginVariants  []common.RawMessage `json:"billing_plugin_variants"`
}

func (b *Bot) modelList(ctx context.Context, keyword string) string {
	var pricing sitePricing
	if ok, msg := b.publicSiteResponse(ctx, "/api/pricing", &pricing); !ok {
		return msg
	}
	if !pricing.Success {
		return botText(i18n.MsgQQBotSiteQueryUnavailable)
	}
	names := make([]string, 0, len(pricing.Data))
	keyword = strings.ToLower(keyword)
	for _, item := range pricing.Data {
		if item.Name != "" && strings.Contains(strings.ToLower(item.Name), keyword) {
			names = append(names, item.Name)
		}
	}
	slices.Sort(names)
	names = slices.Compact(names)
	if len(names) == 0 {
		return botText(i18n.MsgQQBotNoModels)
	}
	header := botText(i18n.MsgQQBotModelsFound, map[string]any{"Count": len(names)})
	result := header + "\n" + strings.Join(names[:min(len(names), siteResultLimit)], "\n")
	if len(names) > siteResultLimit {
		result += "\n" + botText(i18n.MsgQQBotMoreModels)
	}
	return b.withSiteLink(result, "pricing")
}

func (b *Bot) modelPrice(ctx context.Context, name string) string {
	var pricing sitePricing
	if ok, msg := b.publicSiteResponse(ctx, "/api/pricing", &pricing); !ok {
		return msg
	}
	if !pricing.Success {
		return botText(i18n.MsgQQBotSiteQueryUnavailable)
	}
	for _, item := range pricing.Data {
		if item.Name != name {
			continue
		}
		base := botText(i18n.MsgQQBotComplexPrice)
		switch {
		case item.BillingMode != "" && item.BillingMode != "ratio", len(item.PluginVariants) > 0:
			// The model square renders request-dependent and plugin rules.
		case item.QuotaType == 1 && isPriceNumber(item.ModelPrice):
			base = botText(i18n.MsgQQBotPerCallPrice, map[string]any{
				"Price": decimal.NewFromFloat(*item.ModelPrice).String(),
			})
		case item.QuotaType == 0 && isPriceNumber(item.ModelRatio) && isPriceNumber(item.CompletionRatio):
			// Match the public model square's base USD credits per million tokens.
			input := decimal.NewFromFloat(*item.ModelRatio).Mul(decimal.NewFromInt(2))
			base = botText(i18n.MsgQQBotTokenPrice, map[string]any{
				"Input": input.String(), "Output": input.Mul(decimal.NewFromFloat(*item.CompletionRatio)).String(),
			})
			if isPriceNumber(item.CacheReadRatio) {
				base += "\n" + botText(i18n.MsgQQBotCacheReadPrice, map[string]any{
					"Price": input.Mul(decimal.NewFromFloat(*item.CacheReadRatio)).String(),
				})
			}
			if isPriceNumber(item.CacheWriteRatio) {
				base += "\n" + botText(i18n.MsgQQBotCacheWritePrice, map[string]any{
					"Price": input.Mul(decimal.NewFromFloat(*item.CacheWriteRatio)).String(),
				})
			}
		}
		return b.withSiteLink(item.Name+"\n"+base, "pricing/"+url.PathEscape(item.Name))
	}
	return botText(i18n.MsgQQBotPriceModelMissing)
}

func isPriceNumber(value *float64) bool {
	return value != nil && *value >= 0 && !math.IsInf(*value, 0) && !math.IsNaN(*value)
}

func (b *Bot) channelStatus(ctx context.Context, group string) string {
	var status struct {
		Success     bool                           `json:"success"`
		Unavailable bool                           `json:"request_stats_unavailable"`
		Stats       perfmetrics.RecentRequestStats `json:"request_stats"`
	}
	if ok, msg := b.publicSiteResponse(ctx, "/api/uptime/status?source=requests", &status); !ok {
		return msg
	}
	if !status.Success || status.Unavailable {
		return botText(i18n.MsgQQBotSiteQueryUnavailable)
	}
	if !status.Stats.OneHour.HasData {
		return botText(i18n.MsgQQBotNoChannelSamples)
	}
	header := botText(i18n.MsgQQBotChannelStatusHeading)
	if group != "" {
		stats, found := status.Stats.ByGroup[group]
		if !found || !stats.OneHour.HasData {
			return botText(i18n.MsgQQBotNoChannelSamples)
		}
		return b.withSiteLink(header+"\n"+formatSiteStatus(group, stats.OneHour), "site-status")
	}
	names := make([]string, 0, len(status.Stats.ByGroup))
	for name, stats := range status.Stats.ByGroup {
		if stats.OneHour.HasData {
			names = append(names, name)
		}
	}
	slices.Sort(names)
	lines := []string{header, formatSiteStatus(botText(i18n.MsgQQBotAllChannels), status.Stats.OneHour)}
	for _, name := range names[:min(len(names), siteResultLimit)] {
		lines = append(lines, formatSiteStatus(name, status.Stats.ByGroup[name].OneHour))
	}
	if len(names) > siteResultLimit {
		lines = append(lines, botText(i18n.MsgQQBotMoreChannels))
	}
	return b.withSiteLink(strings.Join(lines, "\n"), "site-status")
}

func formatSiteStatus(name string, stats perfmetrics.RequestWindowStats) string {
	return botText(i18n.MsgQQBotChannelStatusLine, map[string]any{
		"Name": name, "Count": stats.RequestCount, "Rate": strconv.FormatFloat(stats.SuccessRate, 'f', 1, 64),
	})
}

func (b *Bot) withSiteLink(text, path string) string {
	common.OptionMapRWMutex.RLock()
	address := common.OptionMap["ServerAddress"]
	common.OptionMapRWMutex.RUnlock()
	if address == "" {
		address = b.siteURL
	}
	base, err := url.Parse(strings.TrimSpace(address))
	if err != nil || base.Scheme != "https" || base.Hostname() == "" || base.User != nil || base.RawQuery != "" || base.Fragment != "" {
		return text
	}
	return text + "\n" + strings.TrimRight(base.String(), "/") + "/" + path
}
