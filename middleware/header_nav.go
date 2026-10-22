package middleware

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/gin-gonic/gin"
)

type headerNavAccess struct {
	Enabled     bool
	RequireAuth bool
	Tabs        map[string]bool
}

func getHeaderNavAccess(module string) headerNavAccess {
	fallback := headerNavAccess{
		Enabled:     true,
		RequireAuth: false,
	}

	common.OptionMapRWMutex.RLock()
	raw := common.OptionMap["HeaderNavModules"]
	common.OptionMapRWMutex.RUnlock()

	if strings.TrimSpace(raw) == "" {
		return fallback
	}

	var parsed map[string]any
	if err := common.Unmarshal([]byte(raw), &parsed); err != nil {
		return fallback
	}

	return parseHeaderNavAccess(parsed[module], fallback)
}

func parseHeaderNavAccess(raw any, fallback headerNavAccess) headerNavAccess {
	switch value := raw.(type) {
	case bool:
		return headerNavAccess{
			Enabled:     value,
			RequireAuth: fallback.RequireAuth,
		}
	case string:
		return headerNavAccess{
			Enabled:     parseHeaderNavBool(value, fallback.Enabled),
			RequireAuth: fallback.RequireAuth,
		}
	case float64:
		return headerNavAccess{
			Enabled:     parseHeaderNavBool(value, fallback.Enabled),
			RequireAuth: fallback.RequireAuth,
		}
	case map[string]any:
		access := fallback
		if enabled, ok := value["enabled"]; ok {
			access.Enabled = parseHeaderNavBool(enabled, fallback.Enabled)
		}
		if requireAuth, ok := value["requireAuth"]; ok {
			access.RequireAuth = parseHeaderNavBool(requireAuth, fallback.RequireAuth)
		}
		if tabs, ok := value["tabs"].(map[string]any); ok {
			access.Tabs = make(map[string]bool, 3)
			for _, key := range []string{"intelligence", "uptime", "official"} {
				access.Tabs[key] = parseHeaderNavBool(tabs[key], true)
			}
		}
		return access
	default:
		return fallback
	}
}

func parseHeaderNavBool(value any, fallback bool) bool {
	switch v := value.(type) {
	case bool:
		return v
	case string:
		switch strings.ToLower(strings.TrimSpace(v)) {
		case "true", "1":
			return true
		case "false", "0":
			return false
		default:
			return fallback
		}
	case float64:
		if v == 1 {
			return true
		}
		if v == 0 {
			return false
		}
		return fallback
	case int:
		if v == 1 {
			return true
		}
		if v == 0 {
			return false
		}
		return fallback
	default:
		return fallback
	}
}

func HeaderNavModuleAuth(module string) gin.HandlerFunc {
	return func(c *gin.Context) {
		access := getHeaderNavAccess(module)
		if !access.Enabled {
			// Keep root pricing management available without reopening the public model square.
			if module == "pricing" && c.GetHeader("Authorization") != "" {
				RootAuth()(c)
				return
			}
			c.JSON(http.StatusForbidden, gin.H{
				"success": false,
				"message": fmt.Sprintf("%s is disabled", module),
			})
			c.Abort()
			return
		}

		if access.RequireAuth {
			UserAuth()(c)
			return
		}

		TryUserAuth()(c)
	}
}

func HeaderNavModulePublicOrUserAuth(module string) gin.HandlerFunc {
	return func(c *gin.Context) {
		access := getHeaderNavAccess(module)
		if !access.Enabled || access.RequireAuth {
			UserAuth()(c)
			return
		}

		TryUserAuth()(c)
	}
}

// SiteStatusTabAuth applies public-page visibility to each data endpoint.
// Hidden sections remain readable by administrators in the management console.
// The dashboard's legacy probe feed keeps its existing access policy.
func SiteStatusTabAuth(tab string) gin.HandlerFunc {
	return func(c *gin.Context) {
		if tab == "uptime" && c.Query("source") != "requests" {
			HeaderNavModulePublicOrUserAuth("siteStatus")(c)
			return
		}
		access := getHeaderNavAccess("siteStatus")
		visible := true
		if enabled, ok := access.Tabs[tab]; ok {
			visible = enabled
		}
		if !access.Enabled || !visible {
			AdminAuth()(c)
			return
		}
		if access.RequireAuth {
			UserAuth()(c)
			return
		}
		TryUserAuth()(c)
	}
}
