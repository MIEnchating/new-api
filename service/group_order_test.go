package service

import (
	"testing"

	"github.com/QuantumNous/new-api/setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestOrderGroupNamesUsesConfiguredOrderAndSortsRemainder(t *testing.T) {
	original := setting.GroupOrder2JSONString()
	t.Cleanup(func() {
		require.NoError(t, setting.UpdateGroupOrderByJSONString(original))
	})
	require.NoError(t, setting.UpdateGroupOrderByJSONString(`["vip", "default"]`))

	ordered := OrderGroupNames([]string{"zeta", "default", "alpha", "vip", "vip", ""})
	assert.Equal(t, []string{"vip", "default", "alpha", "zeta"}, ordered)
}
