package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func insertTopUpStatsUser(t *testing.T, id int, username string, displayName string) {
	t.Helper()
	require.NoError(t, DB.Create(&User{
		Id:          id,
		Username:    username,
		DisplayName: displayName,
		Status:      common.UserStatusEnabled,
		AffCode:     username + "_stats_aff",
	}).Error)
}

func insertTopUpStatsRecord(t *testing.T, tradeNo string, userId int, money float64, completeTime int64, status string) {
	t.Helper()
	require.NoError(t, DB.Create(&TopUp{
		UserId:          userId,
		Amount:          int64(money * 100),
		Money:           money,
		TradeNo:         tradeNo,
		PaymentMethod:   PaymentMethodStripe,
		PaymentProvider: PaymentProviderStripe,
		CreateTime:      completeTime - 10,
		CompleteTime:    completeTime,
		Status:          status,
	}).Error)
}

func TestGetUserTopUpStatsAggregatesSuccessfulOrdersByCompletionTime(t *testing.T) {
	truncateTables(t)
	insertTopUpStatsUser(t, 1, "alpha", "Alpha User")
	insertTopUpStatsUser(t, 2, "beta", "Beta User")

	insertTopUpStatsRecord(t, "stats-alpha-1", 1, 10, 1100, common.TopUpStatusSuccess)
	insertTopUpStatsRecord(t, "stats-alpha-2", 1, 30, 1800, common.TopUpStatusSuccess)
	insertTopUpStatsRecord(t, "stats-beta-1", 2, 20, 1500, common.TopUpStatusSuccess)
	insertTopUpStatsRecord(t, "stats-pending", 2, 99, 1600, common.TopUpStatusPending)
	insertTopUpStatsRecord(t, "stats-before", 1, 100, 999, common.TopUpStatusSuccess)
	insertTopUpStatsRecord(t, "stats-after", 2, 100, 2001, common.TopUpStatusSuccess)

	pageInfo := &common.PageInfo{Page: 1, PageSize: 20}
	summary, items, total, err := GetUserTopUpStats(1000, 2000, "", pageInfo)

	require.NoError(t, err)
	assert.Equal(t, int64(3), summary.OrderCount)
	assert.Equal(t, int64(2), summary.UserCount)
	assert.InDelta(t, 60, summary.TotalMoney, 0.001)
	assert.InDelta(t, 20, summary.AverageOrderMoney, 0.001)
	assert.Equal(t, int64(2), total)
	require.Len(t, items, 2)
	assert.Equal(t, 1, items[0].UserId)
	assert.Equal(t, "alpha", items[0].Username)
	assert.Equal(t, int64(2), items[0].OrderCount)
	assert.InDelta(t, 40, items[0].TotalMoney, 0.001)
	assert.InDelta(t, 20, items[0].AverageOrderMoney, 0.001)
	assert.Equal(t, int64(1800), items[0].LastCompleteTime)
	assert.Equal(t, 2, items[1].UserId)
	assert.InDelta(t, 20, items[1].TotalMoney, 0.001)
}

func TestGetUserTopUpStatsSupportsSearchAndPagination(t *testing.T) {
	truncateTables(t)
	insertTopUpStatsUser(t, 1, "alpha", "First Customer")
	insertTopUpStatsUser(t, 2, "beta", "Second Customer")
	insertTopUpStatsRecord(t, "stats-search-alpha", 1, 40, 1200, common.TopUpStatusSuccess)
	insertTopUpStatsRecord(t, "stats-search-beta", 2, 20, 1300, common.TopUpStatusSuccess)

	pageInfo := &common.PageInfo{Page: 1, PageSize: 1}
	_, items, total, err := GetUserTopUpStats(1000, 2000, "", pageInfo)
	require.NoError(t, err)
	assert.Equal(t, int64(2), total)
	require.Len(t, items, 1)
	assert.Equal(t, 1, items[0].UserId)

	pageInfo.Page = 2
	_, items, total, err = GetUserTopUpStats(1000, 2000, "", pageInfo)
	require.NoError(t, err)
	assert.Equal(t, int64(2), total)
	require.Len(t, items, 1)
	assert.Equal(t, 2, items[0].UserId)

	pageInfo.Page = 1
	pageInfo.PageSize = 20
	searchSummary, items, total, err := GetUserTopUpStats(1000, 2000, "ALPH", pageInfo)
	require.NoError(t, err)
	assert.Equal(t, int64(1), total)
	assert.Equal(t, int64(1), searchSummary.UserCount)
	require.Len(t, items, 1)
	assert.Equal(t, 1, items[0].UserId)

	_, items, total, err = GetUserTopUpStats(1000, 2000, "2", pageInfo)
	require.NoError(t, err)
	assert.Equal(t, int64(1), total)
	require.Len(t, items, 1)
	assert.Equal(t, 2, items[0].UserId)
}
