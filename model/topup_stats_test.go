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
