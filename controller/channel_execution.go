package controller

import (
	"sort"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

type channelExecutionOption struct {
	ID     int    `json:"id"`
	Name   string `json:"name"`
	Group  string `json:"group"`
	Models string `json:"models"`
	Status int    `json:"status"`
}

type channelExecutionGroupOption struct {
	Name   string   `json:"name"`
	Models []string `json:"models"`
}

func GetChannelExecutionOptions(c *gin.Context) {
	options := make([]channelExecutionOption, 0)
	err := model.DB.Model(&model.Channel{}).
		Select("id", "name", "group", "models", "status").
		Order("id DESC").
		Scan(&options).Error
	if err != nil {
		common.ApiError(c, err)
		return
	}
	groupNames, err := model.GetChannelGroupNames()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	groups := make([]channelExecutionGroupOption, 0, len(groupNames))
	for _, group := range service.OrderGroupNames(groupNames) {
		models := model.GetGroupEnabledModels(group)
		if len(models) == 0 {
			continue
		}
		sort.Strings(models)
		groups = append(groups, channelExecutionGroupOption{
			Name:   group,
			Models: models,
		})
	}
	common.ApiSuccess(c, gin.H{
		"channels": options,
		"groups":   groups,
	})
}

func GetChannelExecutionPlan(c *gin.Context) {
	group := strings.TrimSpace(c.Query("group"))
	modelName := strings.TrimSpace(c.Query("model"))
	requestPath := strings.TrimSpace(c.Query("path"))
	mode := strings.TrimSpace(c.Query("mode"))
	if group == "" || modelName == "" {
		common.ApiErrorMsg(c, "分组和模型不能为空")
		return
	}
	plan, err := service.BuildChannelExecutionPlan(group, modelName, requestPath, mode)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, plan)
}

func GetChannelExecutionTrace(c *gin.Context) {
	requestID := strings.TrimSpace(c.Param("request_id"))
	if requestID == "" {
		common.ApiErrorMsg(c, "请求 ID 不能为空")
		return
	}
	trace, found, err := service.GetChannelExecutionTrace(requestID)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if !found {
		common.ApiErrorMsg(c, "未找到执行轨迹，可能已过期或请求尚未到达当前服务")
		return
	}
	common.ApiSuccess(c, trace)
}

func GetRecentChannelExecutionTraces(c *gin.Context) {
	channelID := 0
	if rawChannelID := strings.TrimSpace(c.Query("channel_id")); rawChannelID != "" {
		var err error
		channelID, err = strconv.Atoi(rawChannelID)
		if err != nil || channelID <= 0 {
			common.ApiErrorMsg(c, "渠道 ID 无效")
			return
		}
	}
	if channelID < 0 {
		common.ApiErrorMsg(c, "渠道 ID 无效")
		return
	}
	group := strings.TrimSpace(c.Query("group"))
	if group == "" {
		common.ApiErrorMsg(c, "分组不能为空")
		return
	}
	limit, _ := strconv.Atoi(c.Query("limit"))
	traces, err := service.ListChannelExecutionTraces(channelID, group, limit)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, traces)
}
