package qqbot

import (
	"context"
	"errors"
	"net/mail"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"gorm.io/gorm"
)

func accountCommand(text string) (string, string) {
	text = strings.TrimSpace(text)
	for word := range strings.FieldsSeq(text) {
		argument := strings.TrimSpace(text[len(word):])
		switch strings.ToLower(strings.TrimPrefix(word, "/")) {
		case "绑定", "綁定", "bind":
			return "bind", argument
		case "余额", "餘額", "我的余额", "我的餘額", "balance":
			return "balance", argument
		case "用量", "usage":
			return "usage", argument
		case "今日用量":
			return "today", argument
		case "签到", "簽到", "checkin":
			return "checkin", argument
		case "抽奖", "抽獎", "lottery":
			return "lottery", argument
		}
		break
	}
	return "", ""
}

func (b *Bot) emailGroupBinding(ctx context.Context, event groupMessage, argument string) {
	email := model.NormalizeEmail(argument)
	address, err := mail.ParseAddress(email)
	if err != nil || address.Address != email || len(email) > 254 || strings.ContainsAny(email, ";,\r\n") {
		b.reply(ctx, event, botText(i18n.MsgQQBotGroupBindingRequired))
		return
	}
	b.reply(ctx, event, botText(i18n.MsgQQBotGroupBindingAccepted))
	allowed, err := b.claim(ctx, "group-bind:"+event.GroupID+":"+event.Author.OpenID, time.Minute)
	if err != nil || !allowed {
		return
	}
	recipientKey := common.GenerateHMACWithKey([]byte(common.SessionSecret), email)
	allowed, err = b.claim(ctx, "group-bind-email:"+recipientKey, 5*time.Minute)
	if err != nil || !allowed {
		return
	}
	user, err := model.GetUniqueUserByEmail(email)
	if err != nil || user.Status != common.UserStatusEnabled {
		return
	}
	code, err := model.CreateQQBotGroupBindingCode(b.appID, event.GroupID, event.Author.OpenID, user)
	if err == nil {
		err = common.SendEmail(botText(i18n.MsgQQBotGroupBindingSubject), email,
			botText(i18n.MsgQQBotGroupBindingEmail, map[string]any{
				"Code": code, "Group": event.GroupID, "Member": event.Author.OpenID,
			}))
	}
	if err != nil {
		logger.LogWarn(ctx, common.LogText("QQ bot group binding email could not be delivered"))
	}
}

func (b *Bot) accountReply(ctx context.Context, event groupMessage, command, argument string) string {
	if command != "bind" && argument != "" {
		return botText(i18n.MsgQQBotUnknownCommand)
	}
	openID := event.Author.OpenID
	scope := "group:" + event.GroupID + ":"
	replayID := scope + openID
	if event.Private {
		openID = event.Author.UserOpenID
		scope = "private:"
		replayID = openID
		if command == "bind" && argument != "" {
			return botText(i18n.MsgQQBotPrivateHelp)
		}
	}
	unavailable := botText(i18n.MsgQQBotAccountUnavailable)
	cooldown := 3 * time.Second
	if command == "bind" {
		cooldown = 30 * time.Second
	}
	allowed, err := b.claim(ctx, scope+command+":"+openID, cooldown)
	if err != nil {
		return unavailable
	}
	if !allowed {
		return botText(i18n.MsgQQBotChatCooldown)
	}
	if command == "bind" {
		code, err := model.CreateQQBotBindingCode(b.appID, openID)
		if err != nil {
			return unavailable
		}
		return botText(i18n.MsgQQBotBindingCode, map[string]any{"Code": code})
	}

	var user *model.User
	bindingRequired := i18n.MsgQQBotGroupBindingRequired
	if event.Private {
		user, err = model.GetQQBotUser(b.appID, openID)
		bindingRequired = i18n.MsgQQBotBindingRequired
	} else {
		user, err = model.GetQQBotGroupUser(b.appID, event.GroupID, openID)
	}
	if errors.Is(err, gorm.ErrRecordNotFound) || (err == nil && user.Status != common.UserStatusEnabled) {
		return botText(bindingRequired)
	}
	if err != nil {
		return unavailable
	}
	switch command {
	case "balance":
		return botText(i18n.MsgQQBotBalance, map[string]any{"Balance": logger.FormatQuota(user.Quota)})
	case "usage":
		return botText(i18n.MsgQQBotUsage, map[string]any{"Usage": logger.FormatQuota(user.UsedQuota), "Count": user.RequestCount})
	case "today":
		zone := time.FixedZone("CST", 8*60*60)
		now := b.now().In(zone)
		start := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, zone)
		usage, err := model.GetUserConsumptionForPeriod(ctx, user.Id, start.Unix(), now.Unix())
		if err != nil {
			return unavailable
		}
		return botText(i18n.MsgQQBotTodayUsage, map[string]any{
			"Wallet": logger.FormatQuota(usage.WalletQuota), "Subscription": logger.FormatQuota(usage.SubscriptionQuota), "Count": usage.Count,
		})
	case "checkin":
		if !operation_setting.GetCheckinSetting().Enabled {
			return botText(i18n.MsgQQBotCheckinDisabled)
		}
		if common.TurnstileCheckEnabled {
			return b.withSiteLink(botText(i18n.MsgQQBotCheckinWebsite), "profile")
		}
		if model.ClaimQQBotAccountAction(b.appID, replayID, event.ID) != nil {
			return unavailable
		}
		checkin, err := service.PerformUserCheckin(user.Id)
		if message, ok := errors.AsType[*common.Message](err); ok && message.Key == "Already checked in today" {
			return botText(i18n.MsgQQBotAlreadyCheckedIn)
		}
		if err != nil {
			return unavailable
		}
		return botText(i18n.MsgQQBotCheckedIn, map[string]any{"Award": logger.FormatQuota(checkin.QuotaAwarded)})
	case "lottery":
		if !middleware.LotteryFeatureEnabledForUser(user.Id) {
			return botText(i18n.MsgQQBotLotteryDisabled)
		}
		allowed, _, err := middleware.TakeLotteryDrawBudget(ctx, user.Id)
		if err != nil {
			return unavailable
		}
		if !allowed {
			return botText(i18n.MsgQQBotChatCooldown)
		}
		if model.ClaimQQBotAccountAction(b.appID, replayID, event.ID) != nil {
			return unavailable
		}
		draw, err := model.DrawLottery(user.Id)
		if errors.Is(err, model.ErrNoLotteryChances) {
			return botText(i18n.MsgQQBotLotteryNoChances)
		}
		if err != nil {
			return unavailable
		}
		if draw.Draw.Quota == 0 {
			return botText(i18n.MsgQQBotLotteryNoPrize, map[string]any{"Count": draw.Status.AvailableChances})
		}
		return botText(i18n.MsgQQBotLotteryPrize, map[string]any{
			"Award": logger.FormatQuota(draw.Draw.Quota), "Count": draw.Status.AvailableChances,
		})
	}
	return unavailable
}
