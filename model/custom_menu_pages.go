package model

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/url"
	"regexp"
	"strings"
)

const CustomMenuPagesOptionKey = "CustomMenuPages"

const (
	CustomMenuVisibilityPublic = "public"
	CustomMenuVisibilityAdmin  = "admin"
	CustomMenuOpenModeIframe   = "iframe"
	CustomMenuOpenModeExternal = "external"
	CustomMenuSectionChat      = "chat"
	CustomMenuSectionGeneral   = "general"
	CustomMenuSectionPersonal  = "personal"
	maxCustomMenuPages         = 20
	maxCustomMenuIconLength    = 32 * 1024
)

var customMenuPageIDPattern = regexp.MustCompile(`^[a-zA-Z0-9_-]{8,64}$`)
var unsafeCustomMenuSVGPattern = regexp.MustCompile(`(?i)<\s*(script|foreignobject|iframe|object|embed)|\son[a-z]+\s*=|javascript:|(?:href|src)\s*=\s*["']\s*(?:https?:|//)|url\s*\(\s*["']?\s*(?:https?:|//)`)

type CustomMenuPage struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	URL        string `json:"url"`
	Visibility string `json:"visibility"`
	OpenMode   string `json:"openMode"`
	Section    string `json:"section,omitempty"`
	Icon       string `json:"icon,omitempty"`
	Enabled    *bool  `json:"enabled,omitempty"`
}

func (page CustomMenuPage) IsEnabled() bool {
	return page.Enabled == nil || *page.Enabled
}

func ParseCustomMenuPages(raw string) ([]CustomMenuPage, error) {
	if strings.TrimSpace(raw) == "" {
		return []CustomMenuPage{}, nil
	}

	var pages []CustomMenuPage
	if err := json.Unmarshal([]byte(raw), &pages); err != nil {
		return nil, fmt.Errorf("自定义菜单页面配置格式无效")
	}
	if len(pages) > maxCustomMenuPages {
		return nil, fmt.Errorf("自定义菜单页面最多支持 %d 项", maxCustomMenuPages)
	}

	seen := make(map[string]struct{}, len(pages))
	for i := range pages {
		page := &pages[i]
		page.ID = strings.TrimSpace(page.ID)
		page.Name = strings.TrimSpace(page.Name)
		page.URL = strings.TrimSpace(page.URL)
		page.Visibility = strings.TrimSpace(page.Visibility)
		page.OpenMode = strings.TrimSpace(page.OpenMode)
		page.Section = strings.TrimSpace(page.Section)
		page.Icon = strings.TrimSpace(page.Icon)

		if !customMenuPageIDPattern.MatchString(page.ID) {
			return nil, fmt.Errorf("第 %d 个菜单项 ID 无效", i+1)
		}
		if _, exists := seen[page.ID]; exists {
			return nil, fmt.Errorf("第 %d 个菜单项 ID 重复", i+1)
		}
		seen[page.ID] = struct{}{}
		if page.Name == "" || len([]rune(page.Name)) > 40 {
			return nil, fmt.Errorf("第 %d 个菜单项名称不能为空且不能超过 40 个字符", i+1)
		}

		parsedURL, err := url.ParseRequestURI(page.URL)
		if err != nil || parsedURL.Host == "" || (parsedURL.Scheme != "https" && parsedURL.Scheme != "http") {
			return nil, fmt.Errorf("第 %d 个菜单项必须使用有效的 HTTP 或 HTTPS 地址", i+1)
		}
		if page.Visibility != CustomMenuVisibilityPublic && page.Visibility != CustomMenuVisibilityAdmin {
			return nil, fmt.Errorf("第 %d 个菜单项可见区域无效", i+1)
		}
		if page.OpenMode == "" {
			page.OpenMode = CustomMenuOpenModeIframe
		}
		if page.OpenMode != CustomMenuOpenModeIframe && page.OpenMode != CustomMenuOpenModeExternal {
			return nil, fmt.Errorf("第 %d 个菜单项打开方式无效", i+1)
		}
		if page.Visibility == CustomMenuVisibilityPublic {
			if page.Section == "" {
				page.Section = CustomMenuSectionGeneral
			}
			if page.Section != CustomMenuSectionChat && page.Section != CustomMenuSectionGeneral && page.Section != CustomMenuSectionPersonal {
				return nil, fmt.Errorf("第 %d 个菜单项菜单位置无效", i+1)
			}
		} else {
			page.Section = ""
		}
		if len(page.Icon) > maxCustomMenuIconLength {
			return nil, fmt.Errorf("第 %d 个菜单项图标过大", i+1)
		}
		if page.Icon != "" && !strings.HasPrefix(page.Icon, "data:image/svg+xml;base64,") {
			return nil, fmt.Errorf("第 %d 个菜单项图标格式无效", i+1)
		}
		if page.Icon != "" {
			encoded := strings.TrimPrefix(page.Icon, "data:image/svg+xml;base64,")
			decoded, decodeErr := base64.StdEncoding.DecodeString(encoded)
			if decodeErr != nil || !strings.Contains(strings.ToLower(string(decoded)), "<svg") || unsafeCustomMenuSVGPattern.Match(decoded) {
				return nil, fmt.Errorf("第 %d 个菜单项图标包含不安全内容", i+1)
			}
		}
	}

	return pages, nil
}

func validateCustomMenuPagesJSON(raw string) error {
	_, err := ParseCustomMenuPages(raw)
	return err
}
