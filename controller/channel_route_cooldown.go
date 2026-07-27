package controller

import (
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

func ClearChannelRouteCooldown(c *gin.Context) {
	channelID, err := strconv.Atoi(c.Param("id"))
	if err != nil || channelID <= 0 {
		common.ApiErrorMsg(c, "无效的渠道 ID")
		return
	}

	channel, err := model.GetChannelById(channelID, false)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	groups := channel.GetGroups()
	requestedGroup := strings.TrimSpace(c.Query("group"))
	if requestedGroup != "" {
		found := false
		for _, group := range groups {
			if group == requestedGroup {
				found = true
				break
			}
		}
		if !found {
			common.ApiErrorMsg(c, "渠道不属于指定分组")
			return
		}
		groups = []string{requestedGroup}
	}

	for _, group := range groups {
		service.ClearChannelRouteCooldown(group, channelID)
	}
	recordManageAudit(c, "channel.route_cooldown_clear", map[string]interface{}{
		"id":     channelID,
		"groups": groups,
	})
	common.ApiSuccess(c, gin.H{
		"channel_id": channelID,
		"groups":     groups,
	})
}
