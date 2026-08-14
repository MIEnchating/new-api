package controller

import (
	"net/http"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
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

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    visible,
	})
}
