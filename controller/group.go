package controller

import (
	"net/http"
	"strconv"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting"

	"github.com/gin-gonic/gin"
)

func GetGroups(c *gin.Context) {
	channelOnly, _ := strconv.ParseBool(c.Query("channel_only"))
	groupNames := service.GetOrderedGroupNames()
	if channelOnly {
		var err error
		groupNames, err = model.GetChannelGroupNames()
		if err != nil {
			common.ApiError(c, err)
			return
		}
		groupNames = service.OrderGroupNames(groupNames)
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    groupNames,
	})
}

func GetUserGroups(c *gin.Context) {
	usableGroups := make(map[string]map[string]interface{})
	userGroup := ""
	userId := c.GetInt("id")
	userGroup, _ = model.GetUserGroup(userId, false)
	userUsableGroups := service.GetUserUsableGroups(userGroup)
	orderedGroups := service.GetOrderedGroupNames()
	now := time.Now()
	for order, groupName := range orderedGroups {
		// UserUsableGroups contains the groups that the user can use
		if desc, ok := userUsableGroups[groupName]; ok {
			ratioStatus := service.GetGroupRatioStatus(userGroup, groupName, now)
			usableGroups[groupName] = map[string]interface{}{
				"ratio":            ratioStatus.Ratio,
				"base_ratio":       ratioStatus.BaseRatio,
				"schedule_enabled": ratioStatus.ScheduleEnabled,
				"schedule_active":  ratioStatus.ScheduleActive,
				"desc":             desc,
				"order":            order,
			}
		}
	}
	if _, ok := userUsableGroups["auto"]; ok {
		usableGroups["auto"] = map[string]interface{}{
			"ratio": "自动",
			"desc":  setting.GetUsableGroupDescription("auto"),
			"order": len(orderedGroups),
		}
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    usableGroups,
	})
}
