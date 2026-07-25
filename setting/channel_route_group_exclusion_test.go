package setting

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestChannelRouteGroupExclusions(t *testing.T) {
	original := ChannelRouteGroupExclusions2JSONString()
	originalEnabled := ChannelRouteGroupExclusionsEnabled
	t.Cleanup(func() {
		ChannelRouteGroupExclusionsEnabled = originalEnabled
		require.NoError(t, UpdateChannelRouteGroupExclusionsByJSONString(original))
	})
	ChannelRouteGroupExclusionsEnabled = true

	require.NoError(t, UpdateChannelRouteGroupExclusionsByJSONString(`{
		"no-same-retry":"same_channel_retry",
		"no-next-channel":"next_channel",
		"fully-excluded":{"mode":"all","enabled":true},
		"disabled":{"mode":"all","enabled":false}
	}`))

	assert.True(t, IsChannelRouteSameChannelRetryExcluded("no-same-retry"))
	assert.False(t, IsChannelRouteNextChannelExcluded("no-same-retry"))
	assert.False(t, IsChannelRouteSameChannelRetryExcluded("no-next-channel"))
	assert.True(t, IsChannelRouteNextChannelExcluded("no-next-channel"))
	assert.True(t, IsChannelRouteSameChannelRetryExcluded("fully-excluded"))
	assert.True(t, IsChannelRouteNextChannelExcluded("fully-excluded"))
	assert.False(t, IsChannelRouteSameChannelRetryExcluded("disabled"))
	assert.False(t, IsChannelRouteNextChannelExcluded("disabled"))
	assert.False(t, IsChannelRouteNextChannelExcluded("default"))

	ChannelRouteGroupExclusionsEnabled = false
	assert.False(t, IsChannelRouteSameChannelRetryExcluded("no-same-retry"))
	assert.False(t, IsChannelRouteNextChannelExcluded("fully-excluded"))
}

func TestChannelRouteGroupExclusionsPreserveRuleSwitches(t *testing.T) {
	original := ChannelRouteGroupExclusions2JSONString()
	t.Cleanup(func() {
		require.NoError(t, UpdateChannelRouteGroupExclusionsByJSONString(original))
	})

	require.NoError(t, UpdateChannelRouteGroupExclusionsByJSONString(`{
		"enabled":{"mode":"same_channel_retry","enabled":true},
		"disabled":{"mode":"next_channel","enabled":false}
	}`))
	assert.JSONEq(t, `{
		"enabled":{"mode":"same_channel_retry","enabled":true},
		"disabled":{"mode":"next_channel","enabled":false}
	}`, ChannelRouteGroupExclusions2JSONString())
}

func TestParseChannelRouteGroupExclusionsRejectsInvalidInput(t *testing.T) {
	_, err := ParseChannelRouteGroupExclusions(`{"default":"unknown"}`)
	require.Error(t, err)

	_, err = ParseChannelRouteGroupExclusions(`{"":"all"}`)
	require.Error(t, err)

	_, err = ParseChannelRouteGroupExclusions(`[]`)
	require.Error(t, err)

	_, err = ParseChannelRouteGroupExclusions(`null`)
	require.Error(t, err)

	_, err = ParseChannelRouteGroupExclusions(`{"default":{"mode":"all","enabled":"yes"}}`)
	require.Error(t, err)
}
