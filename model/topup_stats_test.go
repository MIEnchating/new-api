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
	insertTopUpStatsRecordWithPayment(t, tradeNo, userId, money, completeTime, status, PaymentMethodStripe, PaymentProviderStripe)
}

func insertTopUpStatsRecordWithPayment(t *testing.T, tradeNo string, userId int, money float64, completeTime int64, status string, paymentMethod string, paymentProvider string) {
	t.Helper()
	require.NoError(t, DB.Create(&TopUp{
		UserId:          userId,
		Amount:          int64(money * 100),
		Money:           money,
		TradeNo:         tradeNo,
		PaymentMethod:   paymentMethod,
		PaymentProvider: paymentProvider,
		CreateTime:      completeTime - 10,
		CompleteTime:    completeTime,
		Status:          status,
	}).Error)
}

func TestGetUserTopUpStatsReturnsSuccessfulSummaryAndAllOrdersByEffectiveTime(t *testing.T) {
	truncateTables(t)
	insertTopUpStatsUser(t, 1, "alpha", "Alpha User")
	insertTopUpStatsUser(t, 2, "beta", "Beta User")

	insertTopUpStatsRecord(t, "stats-alpha-1", 1, 10, 1100, common.TopUpStatusSuccess)
	insertTopUpStatsRecordWithPayment(t, "stats-alpha-2", 1, 30, 1800, common.TopUpStatusSuccess, PaymentMethodWaffo, PaymentProviderWaffo)
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
	assert.Zero(t, summary.InvoiceCount)
	assert.Equal(t, int64(4), total)
	require.Len(t, items, 4)
	assert.Equal(t, 1, items[0].UserId)
	assert.Equal(t, "alpha", items[0].Username)
	assert.Equal(t, "Alpha User", items[0].DisplayName)
	assert.Equal(t, "stats-alpha-2", items[0].TradeNo)
	assert.Equal(t, PaymentMethodWaffo, items[0].PaymentMethod)
	assert.Equal(t, PaymentProviderWaffo, items[0].PaymentProvider)
	assert.InDelta(t, 30, items[0].Money, 0.001)
	assert.Equal(t, int64(1800), items[0].CompleteTime)
	assert.Equal(t, "stats-pending", items[1].TradeNo)
	assert.Equal(t, common.TopUpStatusPending, items[1].Status)
	assert.Equal(t, int64(1600), items[1].OrderTime)
	assert.Equal(t, 2, items[2].UserId)
	assert.Equal(t, "stats-beta-1", items[2].TradeNo)
	assert.InDelta(t, 20, items[2].Money, 0.001)
	assert.Equal(t, "stats-alpha-1", items[3].TradeNo)

	_, filteredItems, filteredTotal, err := GetUserTopUpStats(
		1000,
		2000,
		"",
		pageInfo,
		TopUpStatsFilter{PaymentMethods: []string{PaymentMethodWaffo}},
	)
	require.NoError(t, err)
	assert.Equal(t, int64(1), filteredTotal)
	require.Len(t, filteredItems, 1)
	assert.Equal(t, "stats-alpha-2", filteredItems[0].TradeNo)
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
	assert.Equal(t, "stats-search-beta", items[0].TradeNo)

	pageInfo.Page = 2
	_, items, total, err = GetUserTopUpStats(1000, 2000, "", pageInfo)
	require.NoError(t, err)
	assert.Equal(t, int64(2), total)
	require.Len(t, items, 1)
	assert.Equal(t, "stats-search-alpha", items[0].TradeNo)

	pageInfo.Page = 1
	pageInfo.PageSize = 20
	searchSummary, items, total, err := GetUserTopUpStats(1000, 2000, "ALPH", pageInfo)
	require.NoError(t, err)
	assert.Equal(t, int64(1), total)
	assert.Equal(t, int64(1), searchSummary.OrderCount)
	assert.Equal(t, int64(1), searchSummary.UserCount)
	assert.InDelta(t, 40, searchSummary.TotalMoney, 0.001)
	require.Len(t, items, 1)
	assert.Equal(t, 1, items[0].UserId)

	_, items, total, err = GetUserTopUpStats(1000, 2000, "2", pageInfo)
	require.NoError(t, err)
	assert.Equal(t, int64(1), total)
	require.Len(t, items, 1)
	assert.Equal(t, 2, items[0].UserId)

	_, items, total, err = GetUserTopUpStats(1000, 2000, "SEARCH-BETA", pageInfo)
	require.NoError(t, err)
	assert.Equal(t, int64(1), total)
	require.Len(t, items, 1)
	assert.Equal(t, "stats-search-beta", items[0].TradeNo)
}

func TestGetUserTopUpStatsUsesCreateTimeWhenCompletionTimeIsMissing(t *testing.T) {
	truncateTables(t)
	insertTopUpStatsUser(t, 1, "legacy-order", "Legacy Order")
	require.NoError(t, DB.Create(&TopUp{
		UserId:     1,
		Amount:     1000,
		Money:      10,
		TradeNo:    "legacy-success",
		CreateTime: 1500,
		Status:     common.TopUpStatusSuccess,
	}).Error)

	summary, items, total, err := GetUserTopUpStats(1000, 2000, "", &common.PageInfo{Page: 1, PageSize: 20})
	require.NoError(t, err)
	assert.Equal(t, int64(1), summary.OrderCount)
	assert.Equal(t, int64(1), total)
	require.Len(t, items, 1)
	assert.Equal(t, int64(1500), items[0].OrderTime)
}

func TestUpdateTopUpInvoiceStatusEnforcesInvoiceLifecycle(t *testing.T) {
	truncateTables(t)
	insertTopUpStatsUser(t, 1, "invoice-user", "Invoice User")
	insertTopUpStatsRecord(t, "invoice-success", 1, 25, 1200, common.TopUpStatusSuccess)
	insertTopUpStatsRecord(t, "invoice-pending", 1, 30, 1300, common.TopUpStatusPending)

	var successful TopUp
	require.NoError(t, DB.Where("trade_no = ?", "invoice-success").First(&successful).Error)
	var pending TopUp
	require.NoError(t, DB.Where("trade_no = ?", "invoice-pending").First(&pending).Error)

	issued, err := UpdateTopUpInvoiceStatus(successful.Id, TopUpInvoiceActionIssue, 91)
	require.NoError(t, err)
	assert.Equal(t, TopUpInvoiceStatusIssued, issued.InvoiceStatus)
	assert.Equal(t, 91, issued.InvoicedBy)
	assert.Positive(t, issued.InvoicedAt)
	assert.Zero(t, issued.InvoiceReturnedAt)
	assert.Zero(t, issued.InvoiceReturnedBy)

	_, err = UpdateTopUpInvoiceStatus(successful.Id, TopUpInvoiceActionIssue, 92)
	assert.ErrorIs(t, err, ErrTopUpInvoiceStatus)

	returned, err := UpdateTopUpInvoiceStatus(successful.Id, TopUpInvoiceActionReturn, 93)
	require.NoError(t, err)
	assert.Equal(t, TopUpInvoiceStatusReturned, returned.InvoiceStatus)
	assert.Equal(t, 93, returned.InvoiceReturnedBy)
	assert.Positive(t, returned.InvoiceReturnedAt)

	_, err = UpdateTopUpInvoiceStatus(successful.Id, TopUpInvoiceActionReturn, 94)
	assert.ErrorIs(t, err, ErrTopUpInvoiceStatus)

	reissued, err := UpdateTopUpInvoiceStatus(successful.Id, TopUpInvoiceActionIssue, 95)
	require.NoError(t, err)
	assert.Equal(t, TopUpInvoiceStatusIssued, reissued.InvoiceStatus)
	assert.Equal(t, 95, reissued.InvoicedBy)
	assert.Zero(t, reissued.InvoiceReturnedAt)
	assert.Zero(t, reissued.InvoiceReturnedBy)

	_, err = UpdateTopUpInvoiceStatus(pending.Id, TopUpInvoiceActionIssue, 91)
	assert.ErrorIs(t, err, ErrTopUpStatusInvalid)
	_, err = UpdateTopUpInvoiceStatus(successful.Id, "invalid", 91)
	assert.ErrorIs(t, err, ErrTopUpInvoiceAction)
}

func TestUpdateTopUpInvoiceStatusesUpdatesSelectedOrdersAtomically(t *testing.T) {
	truncateTables(t)
	insertTopUpStatsUser(t, 1, "invoice-batch", "Invoice Batch")
	insertTopUpStatsRecord(t, "invoice-batch-one", 1, 20, 1200, common.TopUpStatusSuccess)
	insertTopUpStatsRecord(t, "invoice-batch-two", 1, 30, 1300, common.TopUpStatusSuccess)

	var orders []TopUp
	require.NoError(t, DB.Where("trade_no IN ?", []string{"invoice-batch-one", "invoice-batch-two"}).Order("id").Find(&orders).Error)
	require.Len(t, orders, 2)

	updated, err := UpdateTopUpInvoiceStatuses([]int{orders[0].Id, orders[1].Id}, TopUpInvoiceActionIssue, 91)
	require.NoError(t, err)
	require.Len(t, updated, 2)
	assert.Equal(t, TopUpInvoiceStatusIssued, updated[0].InvoiceStatus)
	assert.Equal(t, TopUpInvoiceStatusIssued, updated[1].InvoiceStatus)

	_, err = UpdateTopUpInvoiceStatuses([]int{orders[0].Id, orders[1].Id}, TopUpInvoiceActionIssue, 92)
	assert.ErrorIs(t, err, ErrTopUpInvoiceStatus)

	returned, err := UpdateTopUpInvoiceStatuses([]int{orders[0].Id, orders[1].Id}, TopUpInvoiceActionReturn, 93)
	require.NoError(t, err)
	assert.Equal(t, TopUpInvoiceStatusReturned, returned[0].InvoiceStatus)
	assert.Equal(t, TopUpInvoiceStatusReturned, returned[1].InvoiceStatus)
}

func TestGetUserTopUpStatsCountsOnlyCurrentlyInvoicedSuccessfulOrders(t *testing.T) {
	truncateTables(t)
	insertTopUpStatsUser(t, 1, "invoice-summary", "Invoice Summary")
	insertTopUpStatsRecord(t, "invoice-summary-issued", 1, 20, 1200, common.TopUpStatusSuccess)
	insertTopUpStatsRecord(t, "invoice-summary-returned", 1, 30, 1300, common.TopUpStatusSuccess)

	var issued TopUp
	require.NoError(t, DB.Where("trade_no = ?", "invoice-summary-issued").First(&issued).Error)
	_, err := UpdateTopUpInvoiceStatus(issued.Id, TopUpInvoiceActionIssue, 91)
	require.NoError(t, err)

	var returned TopUp
	require.NoError(t, DB.Where("trade_no = ?", "invoice-summary-returned").First(&returned).Error)
	_, err = UpdateTopUpInvoiceStatus(returned.Id, TopUpInvoiceActionIssue, 91)
	require.NoError(t, err)
	_, err = UpdateTopUpInvoiceStatus(returned.Id, TopUpInvoiceActionReturn, 91)
	require.NoError(t, err)

	summary, _, _, err := GetUserTopUpStats(1000, 2000, "", &common.PageInfo{Page: 1, PageSize: 20})
	require.NoError(t, err)
	assert.Equal(t, int64(2), summary.OrderCount)
	assert.Equal(t, int64(1), summary.InvoiceCount)
}

func TestInitializeTopUpInvoiceFieldsBackfillsExistingOrders(t *testing.T) {
	truncateTables(t)
	insertTopUpStatsUser(t, 1, "invoice-migration", "Invoice Migration")
	insertTopUpStatsRecord(t, "invoice-migration-order", 1, 20, 1200, common.TopUpStatusSuccess)
	require.NoError(t, DB.Exec(
		"UPDATE top_ups SET invoice_status = NULL, invoiced_at = NULL, invoiced_by = NULL, invoice_returned_at = NULL, invoice_returned_by = NULL WHERE trade_no = ?",
		"invoice-migration-order",
	).Error)

	require.NoError(t, initializeTopUpInvoiceFields())

	var topUp TopUp
	require.NoError(t, DB.Where("trade_no = ?", "invoice-migration-order").First(&topUp).Error)
	assert.Zero(t, topUp.InvoiceStatus)
	assert.Zero(t, topUp.InvoicedAt)
	assert.Zero(t, topUp.InvoicedBy)
	assert.Zero(t, topUp.InvoiceReturnedAt)
	assert.Zero(t, topUp.InvoiceReturnedBy)
}
