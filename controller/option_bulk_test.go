package controller

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPrepareRoutingReliabilityOptionUpdatesValidatesWholeBatch(t *testing.T) {
	updates, err := prepareRoutingReliabilityOptionUpdates([]OptionUpdateRequest{
		{Key: "ChannelRouteCooldownEnabled", Value: true},
		{Key: "ChannelRouteSameChannelRetries", Value: 11},
	})

	require.Error(t, err)
	assert.Nil(t, updates)
	assert.Contains(t, err.Error(), "ChannelRouteSameChannelRetries")
}

func TestPrepareRoutingReliabilityOptionUpdatesNormalizesValues(t *testing.T) {
	updates, err := prepareRoutingReliabilityOptionUpdates([]OptionUpdateRequest{
		{Key: "ChannelRouteCooldownEnabled", Value: true},
		{Key: "ChannelRouteCooldownSeconds", Value: 60},
		{Key: "AutomaticRetryStatusCodes", Value: "429,500-503"},
	})

	require.NoError(t, err)
	assert.Equal(t, "true", updates["ChannelRouteCooldownEnabled"])
	assert.Equal(t, "60", updates["ChannelRouteCooldownSeconds"])
	assert.Equal(t, "429,500-503", updates["AutomaticRetryStatusCodes"])
}

func TestPrepareRoutingReliabilityOptionUpdatesRejectsDuplicateAndForeignKeys(t *testing.T) {
	updates, err := prepareRoutingReliabilityOptionUpdates([]OptionUpdateRequest{
		{Key: "RetryTimes", Value: 1},
		{Key: "RetryTimes", Value: 2},
	})
	require.Error(t, err)
	assert.Nil(t, updates)
	assert.Contains(t, err.Error(), "重复提交")

	updates, err = prepareRoutingReliabilityOptionUpdates([]OptionUpdateRequest{
		{Key: "GitHubClientSecret", Value: "must-not-be-accepted"},
	})
	require.Error(t, err)
	assert.Nil(t, updates)
	assert.Contains(t, err.Error(), "不支持批量更新")
}
