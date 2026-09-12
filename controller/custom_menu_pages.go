package controller

import (
	"net/http"
	"net/url"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

func GetCustomMenuPages(c *gin.Context) {
	common.OptionMapRWMutex.RLock()
	raw := common.OptionMap[model.CustomMenuPagesOptionKey]
	common.OptionMapRWMutex.RUnlock()

	pages, err := model.ParseCustomMenuPages(raw)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	role := c.GetInt("role")
	visible := make([]model.CustomMenuPage, 0, len(pages))
	for _, page := range pages {
		if !page.IsEnabled() {
			continue
		}
		if page.Visibility == model.CustomMenuVisibilityAdmin && role < common.RoleAdminUser {
			continue
		}
		visible = append(visible, page)
	}

	if cfg, err := service.LoadChatGPT2APISSOConfig(); err == nil {
		issuer := "https://" + c.Request.Host
		exists := false
		for _, page := range pages {
			if page.ID == "chatgpt2api-sso" {
				exists = true
				break
			}
		}
		if cfg.AcceptsIssuer(issuer) && !exists {
			visible = append(visible, model.CustomMenuPage{ID: "chatgpt2api-sso", Name: "chatgpt2api", URL: cfg.Origin + "/auth/sso/start?issuer=" + url.QueryEscape(issuer), Visibility: model.CustomMenuVisibilityPublic, OpenMode: model.CustomMenuOpenModeExternal, Section: model.CustomMenuSectionChat})
		}
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    visible,
	})
}
