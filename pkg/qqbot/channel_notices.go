package qqbot

import (
	"context"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/logger"
)

type channelNotice struct {
	id, status int
	name       string
}

// StartChannelNotices is called during startup before the publisher is registered.
// The serial worker keeps QQ delivery out of relay and channel recovery requests.
func (r *Runtime) StartChannelNotices() {
	ctx, cancel := context.WithCancel(context.Background())
	r.stopNotices = cancel
	r.noticeQueue = make(chan channelNotice, 64)
	r.noticeJobs.Go(func() {
		for ctx.Err() == nil {
			select {
			case <-ctx.Done():
				return
			case notice := <-r.noticeQueue:
				if bot := r.currentBot(); bot != nil {
					bot.deliverChannelNotice(notice)
				}
			}
		}
	})
}

func (r *Runtime) QueueChannelNotice(id int, name string, status int) {
	select {
	case r.noticeQueue <- channelNotice{id: id, name: name, status: status}:
	default:
		common.SysError(common.LogText("QQ bot channel notification queue is full"))
	}
}

func (b *Bot) deliverChannelNotice(notice channelNotice) {
	key := i18n.MsgQQBotChannelFault
	if notice.status == common.ChannelStatusEnabled {
		key = i18n.MsgQQBotChannelRecovered
	}
	name := strings.Join(strings.Fields(notice.name), " ")
	name = strings.NewReplacer("<", "＜", ">", "＞").Replace(name)
	if name == "" {
		name = "#" + strconv.Itoa(notice.id)
	}
	text := i18n.Translate("", key, map[string]any{"Name": name})
	for _, group := range b.notifyGroups {
		ctx, cancel := context.WithTimeout(b.ctx, 15*time.Second)
		err := b.sendQQText(ctx, "/v2/groups/"+group+"/messages", text, "")
		cancel()
		if err != nil && b.ctx.Err() == nil {
			logger.LogWarn(b.ctx, common.LogText("QQ bot channel notification failed (channel_id=%d): %v", notice.id, err))
		}
	}
}
