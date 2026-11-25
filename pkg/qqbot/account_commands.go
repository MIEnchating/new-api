package qqbot

import (
	"context"
	"errors"
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

func accountCommand(text string) string {
	for word := range strings.FieldsSeq(strings.ToLower(text)) {
		switch strings.TrimPrefix(word, "/") {
		case "绑定", "綁定", "bind":
			return "bind"
		case "余额", "餘額", "balance":
			return "balance"
		case "用量", "usage":
			return "usage"
		case "签到", "簽到", "checkin":
			return "checkin"
		case "抽奖", "抽獎", "lottery":
			return "lottery"
		}
		break
	}
	return ""
}

func (b *Bot) privateAccountReply(ctx context.Context, event groupMessage, text string) string {
	command := accountCommand(text)
	if command == "" || len(strings.Fields(text)) != 1 {
		return i18n.Translate("", i18n.MsgQQBotPrivateHelp)
	}
	openID := event.Author.UserOpenID
	unavailable := i18n.Translate("", i18n.MsgQQBotAccountUnavailable)
	cooldown := 3 * time.Second
	if command == "bind" {
		cooldown = 30 * time.Second
	}
	allowed, err := b.claim(ctx, "private:"+command+":"+openID, cooldown)
	if err != nil {
		return unavailable
	}
	if !allowed {
		return i18n.Translate("", i18n.MsgQQBotChatCooldown)
	}
	if command == "bind" {
		code, err := model.CreateQQBotBindingCode(b.appID, openID)
		if err != nil {
			return unavailable
		}
		return i18n.Translate("", i18n.MsgQQBotBindingCode, map[string]any{"Code": code})
	}

	user, err := model.GetQQBotUser(b.appID, openID)
	if errors.Is(err, gorm.ErrRecordNotFound) || (err == nil && user.Status != common.UserStatusEnabled) {
		return i18n.Translate("", i18n.MsgQQBotBindingRequired)
	}
	if err != nil {
		return unavailable
	}
	switch command {
	case "balance":
		return i18n.Translate("", i18n.MsgQQBotBalance, map[string]any{"Balance": logger.FormatQuota(user.Quota)})
	case "usage":
		return i18n.Translate("", i18n.MsgQQBotUsage, map[string]any{"Usage": logger.FormatQuota(user.UsedQuota), "Count": user.RequestCount})
	case "checkin":
		if !operation_setting.GetCheckinSetting().Enabled {
			return i18n.Translate("", i18n.MsgQQBotCheckinDisabled)
		}
		if common.TurnstileCheckEnabled {
			return b.withSiteLink(i18n.Translate("", i18n.MsgQQBotCheckinWebsite), "profile")
		}
		if model.ClaimQQBotAccountAction(b.appID, openID, event.ID) != nil {
			return unavailable
		}
		checkin, err := service.PerformUserCheckin(user.Id)
		if message, ok := errors.AsType[*common.Message](err); ok && message.Key == "Already checked in today" {
			return i18n.Translate("", i18n.MsgQQBotAlreadyCheckedIn)
		}
		if err != nil {
			return unavailable
		}
		return i18n.Translate("", i18n.MsgQQBotCheckedIn, map[string]any{"Award": logger.FormatQuota(checkin.QuotaAwarded)})
	case "lottery":
		if !middleware.LotteryFeatureEnabledForUser(user.Id) {
			return i18n.Translate("", i18n.MsgQQBotLotteryDisabled)
		}
		allowed, _, err := middleware.TakeLotteryDrawBudget(ctx, user.Id)
		if err != nil {
			return unavailable
		}
		if !allowed {
			return i18n.Translate("", i18n.MsgQQBotChatCooldown)
		}
		if model.ClaimQQBotAccountAction(b.appID, openID, event.ID) != nil {
			return unavailable
		}
		draw, err := model.DrawLottery(user.Id)
		if errors.Is(err, model.ErrNoLotteryChances) {
			return i18n.Translate("", i18n.MsgQQBotLotteryNoChances)
		}
		if err != nil {
			return unavailable
		}
		if draw.Draw.Quota == 0 {
			return i18n.Translate("", i18n.MsgQQBotLotteryNoPrize, map[string]any{"Count": draw.Status.AvailableChances})
		}
		return i18n.Translate("", i18n.MsgQQBotLotteryPrize, map[string]any{
			"Award": logger.FormatQuota(draw.Draw.Quota), "Count": draw.Status.AvailableChances,
		})
	}
	return unavailable
}
