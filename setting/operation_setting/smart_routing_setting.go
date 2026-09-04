package operation_setting

import (
	"errors"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/config"
)

const SmartRoutingTemplateMaxCooldownSeconds = 31_536_000

type SmartRoutingGroupRoute struct {
	Group           string `json:"group"`
	Priority        int    `json:"priority"`
	CooldownSeconds int    `json:"cooldown_seconds"`
	Enabled         *bool  `json:"enabled,omitempty"`
}

func (route SmartRoutingGroupRoute) IsEnabled() bool {
	return route.Enabled == nil || *route.Enabled
}

type SmartRoutingTemplate struct {
	ID               string                   `json:"id"`
	Name             string                   `json:"name"`
	Description      string                   `json:"description,omitempty"`
	Enabled          bool                     `json:"enabled"`
	GroupRoutes      []SmartRoutingGroupRoute `json:"group_routes"`
	GroupRouteSticky bool                     `json:"group_route_sticky"`
}

type SmartRoutingSetting struct {
	Enabled   bool                   `json:"enabled"`
	Templates []SmartRoutingTemplate `json:"templates"`
}

var smartRoutingSetting = SmartRoutingSetting{
	Enabled:   false,
	Templates: []SmartRoutingTemplate{},
}

var smartRoutingRuntime atomic.Pointer[SmartRoutingSetting]
var smartRoutingSettingMutex sync.Mutex

func init() {
	RefreshSmartRoutingSnapshot()
	config.GlobalConfig.Register("smart_routing_setting", &smartRoutingSetting)
}

func GetSmartRoutingSetting() *SmartRoutingSetting {
	return &smartRoutingSetting
}

func cloneSmartRoutingSetting(setting SmartRoutingSetting) *SmartRoutingSetting {
	clone := setting
	clone.Templates = make([]SmartRoutingTemplate, len(setting.Templates))
	for index, template := range setting.Templates {
		clone.Templates[index] = template
		clone.Templates[index].GroupRoutes = make([]SmartRoutingGroupRoute, len(template.GroupRoutes))
		for routeIndex, route := range template.GroupRoutes {
			clone.Templates[index].GroupRoutes[routeIndex] = route
			if route.Enabled != nil {
				enabled := *route.Enabled
				clone.Templates[index].GroupRoutes[routeIndex].Enabled = &enabled
			}
		}
	}
	return &clone
}

func publishSmartRoutingSnapshot(setting SmartRoutingSetting) {
	smartRoutingRuntime.Store(cloneSmartRoutingSetting(setting))
}

func CurrentSmartRoutingSetting() *SmartRoutingSetting {
	setting := smartRoutingRuntime.Load()
	if setting != nil {
		return cloneSmartRoutingSetting(*setting)
	}
	return cloneSmartRoutingSetting(smartRoutingSetting)
}

func RefreshSmartRoutingSnapshot() {
	smartRoutingSettingMutex.Lock()
	defer smartRoutingSettingMutex.Unlock()
	publishSmartRoutingSnapshot(smartRoutingSetting)
}

func UpdateSmartRoutingSetting(configMap map[string]string) error {
	smartRoutingSettingMutex.Lock()
	defer smartRoutingSettingMutex.Unlock()

	next := *cloneSmartRoutingSetting(smartRoutingSetting)
	if rawEnabled, ok := configMap["enabled"]; ok {
		enabled, err := strconv.ParseBool(strings.TrimSpace(rawEnabled))
		if err != nil {
			return errors.New("智能路由启用状态无效")
		}
		next.Enabled = enabled
	}
	if rawTemplates, ok := configMap["templates"]; ok {
		var templates []SmartRoutingTemplate
		if err := common.UnmarshalJsonStr(rawTemplates, &templates); err != nil {
			return errors.New("智能路由模板必须是 JSON 数组")
		}
		next.Templates = templates
	}
	if err := ValidateSmartRoutingTemplates(next.Templates); err != nil {
		return err
	}

	smartRoutingSetting = next
	publishSmartRoutingSnapshot(next)
	return nil
}

func ValidateSmartRoutingTemplatesJSON(raw string) error {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		raw = "[]"
	}
	var templates []SmartRoutingTemplate
	if err := common.UnmarshalJsonStr(raw, &templates); err != nil {
		return errors.New("智能路由模板必须是 JSON 数组")
	}
	return ValidateSmartRoutingTemplates(templates)
}

func ValidateSmartRoutingTemplates(templates []SmartRoutingTemplate) error {
	if len(templates) > 100 {
		return errors.New("智能路由模板不能超过 100 个")
	}

	seenIDs := make(map[string]struct{}, len(templates))
	for index, template := range templates {
		templateNo := index + 1
		id := strings.TrimSpace(template.ID)
		name := strings.TrimSpace(template.Name)
		if id == "" || name == "" {
			return fmt.Errorf("第 %d 个智能路由模板需要填写标识和名称", templateNo)
		}
		if len(id) > 64 || len([]rune(name)) > 100 {
			return fmt.Errorf("第 %d 个智能路由模板的标识或名称过长", templateNo)
		}
		if len([]rune(strings.TrimSpace(template.Description))) > 500 {
			return fmt.Errorf("智能路由模板 %s 的描述不能超过 500 个字符", name)
		}
		if _, exists := seenIDs[id]; exists {
			return fmt.Errorf("智能路由模板标识 %s 重复", id)
		}
		seenIDs[id] = struct{}{}
		if len(template.GroupRoutes) > 100 {
			return fmt.Errorf("智能路由模板 %s 的分组路由不能超过 100 条", name)
		}
		if template.Enabled && len(template.GroupRoutes) == 0 {
			return fmt.Errorf("智能路由模板 %s 至少需要一条分组路由", name)
		}

		seenGroups := make(map[string]struct{}, len(template.GroupRoutes))
		hasEnabledRoute := false
		for _, route := range template.GroupRoutes {
			group := strings.TrimSpace(route.Group)
			if group == "" {
				return fmt.Errorf("智能路由模板 %s 的路由分组不能为空", name)
			}
			if group == "auto" {
				return fmt.Errorf("智能路由模板 %s 不支持 auto 分组", name)
			}
			if _, exists := seenGroups[group]; exists {
				return fmt.Errorf("智能路由模板 %s 的路由分组 %s 重复", name, group)
			}
			seenGroups[group] = struct{}{}
			if route.Priority < 0 {
				return fmt.Errorf("智能路由模板 %s 的分组 %s 优先级不能小于 0", name, group)
			}
			if route.CooldownSeconds <= 0 || route.CooldownSeconds > SmartRoutingTemplateMaxCooldownSeconds {
				return fmt.Errorf("智能路由模板 %s 的分组 %s 冷却时间必须在 1 到 %d 秒之间", name, group, SmartRoutingTemplateMaxCooldownSeconds)
			}
			if route.IsEnabled() {
				hasEnabledRoute = true
			}
		}
		if template.Enabled && !hasEnabledRoute {
			return fmt.Errorf("智能路由模板 %s 至少需要启用一条分组路由", name)
		}
	}
	return nil
}
