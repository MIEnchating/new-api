package model

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNormalizeTokenGroupRoutesSortsByPriority(t *testing.T) {
	routes, err := NormalizeTokenGroupRoutes([]TokenGroupRoute{
		{Group: "fallback", Priority: 1, CooldownSeconds: 60},
		{Group: "premium", Priority: 2, CooldownSeconds: 120},
	})

	require.NoError(t, err)
	require.Len(t, routes, 2)
	assert.Equal(t, "premium", routes[0].Group)
	assert.Equal(t, 2, routes[0].Priority)
	assert.Equal(t, "fallback", routes[1].Group)
}

func TestNormalizeTokenGroupRoutesRejectsDuplicateGroup(t *testing.T) {
	_, err := NormalizeTokenGroupRoutes([]TokenGroupRoute{
		{Group: "premium", Priority: 2, CooldownSeconds: 60},
		{Group: "premium", Priority: 1, CooldownSeconds: 60},
	})

	require.Error(t, err)
	assert.Contains(t, err.Error(), "重复")
}

func TestNormalizeTokenGroupRoutesRejectsInvalidCooldown(t *testing.T) {
	_, err := NormalizeTokenGroupRoutes([]TokenGroupRoute{
		{Group: "premium", Priority: 2, CooldownSeconds: 0},
	})

	require.Error(t, err)
	assert.Contains(t, err.Error(), "冷却时间")
}

func TestNormalizeTokenGroupRouteConfigSerializesNormalizedRoutes(t *testing.T) {
	config := `[
		{"group":"fallback","priority":1,"cooldown_seconds":60},
		{"group":" premium ","priority":2,"cooldown_seconds":120}
	]`

	normalizedConfig, routes, err := NormalizeTokenGroupRouteConfig(config)

	require.NoError(t, err)
	require.Len(t, routes, 2)
	assert.Equal(t, "premium", routes[0].Group)
	assert.Equal(t, `[{"group":"premium","priority":2,"cooldown_seconds":120},{"group":"fallback","priority":1,"cooldown_seconds":60}]`, normalizedConfig)
}
