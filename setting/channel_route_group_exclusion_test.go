package setting

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestChannelRouteGroupExclusions(t *testing.T) {
	original := ChannelRouteGroupExclusions2JSONString()
	t.Cleanup(func() {
		require.NoError(t, UpdateChannelRouteGroupExclusionsByJSONString(original))
	})

	require.NoError(t, UpdateChannelRouteGroupExclusionsByJSONString(`{
		"no-same-retry":"same_channel_retry",
		"no-next-channel":"next_channel",
		"fully-excluded":"all"
	}`))

	assert.True(t, IsChannelRouteSameChannelRetryExcluded("no-same-retry"))
	assert.False(t, IsChannelRouteNextChannelExcluded("no-same-retry"))
	assert.False(t, IsChannelRouteSameChannelRetryExcluded("no-next-channel"))
	assert.True(t, IsChannelRouteNextChannelExcluded("no-next-channel"))
	assert.True(t, IsChannelRouteSameChannelRetryExcluded("fully-excluded"))
	assert.True(t, IsChannelRouteNextChannelExcluded("fully-excluded"))
	assert.False(t, IsChannelRouteNextChannelExcluded("default"))
}

func TestParseChannelRouteGroupExclusionsRejectsInvalidInput(t *testing.T) {
	_, err := ParseChannelRouteGroupExclusions(`{"default":"unknown"}`)
	require.Error(t, err)

	_, err = ParseChannelRouteGroupExclusions(`{"":"all"}`)
	require.Error(t, err)

	_, err = ParseChannelRouteGroupExclusions(`[]`)
	require.Error(t, err)
}
