package controller

import (
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

const defaultBillingHistoryDays = 30

func parseBillingHistoryTypes(raw string) []string {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	parts := strings.Split(raw, ",")
	types := make([]string, 0, len(parts))
	for _, part := range parts {
		if value := strings.TrimSpace(part); value != "" {
			types = append(types, value)
		}
	}
	return types
}

func parseBillingHistoryTimestamp(c *gin.Context, key string, fallback int64) (int64, bool) {
	raw := strings.TrimSpace(c.Query(key))
	if raw == "" {
		return fallback, true
	}
	value, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || value < 0 {
		common.ApiErrorMsg(c, "无效的时间范围")
		return 0, false
	}
	return value, true
}

func getBillingHistory(c *gin.Context, admin bool) {
	now := time.Now().Unix()
	startTime, ok := parseBillingHistoryTimestamp(c, "start_timestamp", now-defaultBillingHistoryDays*24*60*60)
	if !ok {
		return
	}
	endTime, ok := parseBillingHistoryTimestamp(c, "end_timestamp", now)
	if !ok {
		return
	}
	if startTime > 0 && endTime > 0 && startTime > endTime {
		common.ApiErrorMsg(c, "开始时间不能晚于结束时间")
		return
	}

	pageInfo := common.GetPageQuery(c)
	filter := model.BillingHistoryFilter{
		Reference: strings.TrimSpace(c.Query("keyword")),
		Types:     parseBillingHistoryTypes(c.Query("types")),
		StartTime: startTime,
		EndTime:   endTime,
		PageInfo:  pageInfo,
	}
	if admin {
		filter.UserKeyword = strings.TrimSpace(c.Query("user_keyword"))
	} else {
		filter.UserId = c.GetInt("id")
	}

	items, total, err := model.GetBillingHistory(filter)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if !admin {
		redactUserBillingHistory(items)
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(items)
	common.ApiSuccess(c, pageInfo)
}

func redactUserBillingHistory(items []model.BillingHistoryItem) {
	for i := range items {
		items[i].OperatorUserId = 0
	}
}

func GetUserBillingHistory(c *gin.Context) {
	getBillingHistory(c, false)
}

func GetAllBillingHistory(c *gin.Context) {
	getBillingHistory(c, true)
}
