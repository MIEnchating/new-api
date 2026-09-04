package operation_setting

import (
	"strconv"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func boolPointer(value bool) *bool {
	return &value
}

func TestValidateSmartRoutingTemplatesAcceptsAPIKeyRouteTemplate(t *testing.T) {
	templates := []SmartRoutingTemplate{{
		ID:          "claude",
		Name:        "Claude",
		Description: "Claude models",
		Enabled:     true,
		GroupRoutes: []SmartRoutingGroupRoute{
			{Group: "claude-primary", Priority: 2, CooldownSeconds: 60, Enabled: boolPointer(true)},
			{Group: "claude-backup", Priority: 1, CooldownSeconds: 120, Enabled: boolPointer(true)},
		},
		GroupRouteSticky: true,
	}}

	require.NoError(t, ValidateSmartRoutingTemplates(templates))
}

func TestValidateSmartRoutingTemplatesRejectsInvalidRoutes(t *testing.T) {
	tests := []struct {
		name      string
		templates []SmartRoutingTemplate
		contains  string
	}{
		{
			name: "duplicate id",
			templates: []SmartRoutingTemplate{
				{ID: "same", Name: "One", Enabled: false},
				{ID: "same", Name: "Two", Enabled: false},
			},
			contains: "重复",
		},
		{
			name:      "enabled template without routes",
			templates: []SmartRoutingTemplate{{ID: "empty", Name: "Empty", Enabled: true}},
			contains:  "至少需要一条分组路由",
		},
		{
			name: "duplicate group",
			templates: []SmartRoutingTemplate{{
				ID: "duplicate", Name: "Duplicate", Enabled: true,
				GroupRoutes: []SmartRoutingGroupRoute{
					{Group: "default", Priority: 2, CooldownSeconds: 60},
					{Group: "default", Priority: 1, CooldownSeconds: 60},
				},
			}},
			contains: "路由分组 default 重复",
		},
		{
			name: "auto group",
			templates: []SmartRoutingTemplate{{
				ID: "auto", Name: "Auto", Enabled: true,
				GroupRoutes: []SmartRoutingGroupRoute{{Group: "auto", Priority: 1, CooldownSeconds: 60}},
			}},
			contains: "不支持 auto 分组",
		},
		{
			name: "invalid cooldown",
			templates: []SmartRoutingTemplate{{
				ID: "cooldown", Name: "Cooldown", Enabled: true,
				GroupRoutes: []SmartRoutingGroupRoute{{Group: "default", Priority: 1, CooldownSeconds: 0}},
			}},
			contains: "冷却时间",
		},
		{
			name: "all routes disabled",
			templates: []SmartRoutingTemplate{{
				ID: "disabled", Name: "Disabled", Enabled: true,
				GroupRoutes: []SmartRoutingGroupRoute{{Group: "default", Priority: 1, CooldownSeconds: 60, Enabled: boolPointer(false)}},
			}},
			contains: "至少需要启用一条分组路由",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := ValidateSmartRoutingTemplates(test.templates)
			require.Error(t, err)
			assert.Contains(t, err.Error(), test.contains)
		})
	}
}

func TestUpdateSmartRoutingSettingReplacesTemplateRoutes(t *testing.T) {
	original := CurrentSmartRoutingSetting()
	t.Cleanup(func() {
		data, err := common.Marshal(original.Templates)
		require.NoError(t, err)
		require.NoError(t, UpdateSmartRoutingSetting(map[string]string{
			"enabled":   strconv.FormatBool(original.Enabled),
			"templates": string(data),
		}))
	})

	require.NoError(t, UpdateSmartRoutingSetting(map[string]string{
		"enabled":   "true",
		"templates": `[{"id":"claude","name":"Claude","enabled":true,"group_routes":[{"group":"primary","priority":2,"cooldown_seconds":60},{"group":"backup","priority":1,"cooldown_seconds":120}],"group_route_sticky":true}]`,
	}))
	require.NoError(t, UpdateSmartRoutingSetting(map[string]string{
		"templates": `[{"id":"openai","name":"OpenAI","enabled":true,"group_routes":[{"group":"default","priority":1,"cooldown_seconds":60}],"group_route_sticky":false}]`,
	}))

	setting := CurrentSmartRoutingSetting()
	require.Len(t, setting.Templates, 1)
	assert.Equal(t, "openai", setting.Templates[0].ID)
	require.Len(t, setting.Templates[0].GroupRoutes, 1)
	assert.Equal(t, "default", setting.Templates[0].GroupRoutes[0].Group)
}
