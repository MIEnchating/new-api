package service

import (
	"errors"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/pkg/wsmanager"
)

// ValidateWebSocketChannel reads persisted state after registration so a
// disable event published during the handshake cannot be missed.
func ValidateWebSocketChannel(channelID int, key string, keyIndex int) (*model.Channel, error) {
	channel, err := model.GetChannelById(channelID, true)
	if err != nil {
		return nil, err
	}
	if channel.Status != common.ChannelStatusEnabled {
		return nil, errors.New("the upstream connection channel is no longer enabled")
	}
	keyEnabled := channel.Key == key
	if channel.ChannelInfo.IsMultiKey {
		keys := channel.GetKeys()
		status := channel.ChannelInfo.MultiKeyStatusList[keyIndex]
		keyEnabled = keyIndex >= 0 && keyIndex < len(keys) && keys[keyIndex] == key && (status == 0 || status == common.ChannelStatusEnabled)
	}
	if !keyEnabled {
		return nil, errors.New("the upstream connection credential is no longer enabled")
	}
	return channel, nil
}

const ChannelDisabledCloseReason = "channel disabled or deleted"

func CloseActiveWebSocketsForChannel(channelID int, reason string) int {
	return wsmanager.CloseChannelsAndBroadcast([]int{channelID}, reason)
}

func CloseActiveWebSocketsForChannels(channelIDs []int, reason string) int {
	return wsmanager.CloseChannelsAndBroadcast(channelIDs, reason)
}
