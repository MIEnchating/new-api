package setting

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestParseGroupOrder(t *testing.T) {
	order, err := ParseGroupOrder(`["vip", "default"]`)
	require.NoError(t, err)
	assert.Equal(t, []string{"vip", "default"}, order)
}

func TestParseGroupOrderRejectsInvalidItems(t *testing.T) {
	_, err := ParseGroupOrder(`["default", "default"]`)
	require.Error(t, err)

	_, err = ParseGroupOrder(`["default", " "]`)
	require.Error(t, err)
}

func TestUpdateGroupOrderKeepsPreviousValueOnError(t *testing.T) {
	original := GroupOrder2JSONString()
	t.Cleanup(func() {
		require.NoError(t, UpdateGroupOrderByJSONString(original))
	})

	require.NoError(t, UpdateGroupOrderByJSONString(`["vip", "default"]`))
	require.Error(t, UpdateGroupOrderByJSONString(`not-json`))
	assert.Equal(t, []string{"vip", "default"}, GetGroupOrder())
}
