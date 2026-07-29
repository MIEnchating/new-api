package controller

import (
	"encoding/json"
	"testing"

	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/require"
)

func TestRedactUserBillingHistoryRemovesOperatorUserID(t *testing.T) {
	invoiceStatus := model.TopUpInvoiceStatusIssued
	items := []model.BillingHistoryItem{
		{
			Id:              "billing:1",
			TopUpId:         99,
			RedemptionId:    101,
			UserId:          42,
			Type:            model.BillingTypeAdminAdjustment,
			OperatorUserId:  7,
			InvoiceStatus:   &invoiceStatus,
			InvoicedAt:      123,
			InvoicedBy:      7,
			InvoiceEligible: true,
		},
	}

	redactUserBillingHistory(items)

	require.Zero(t, items[0].OperatorUserId)
	require.Zero(t, items[0].TopUpId)
	require.Zero(t, items[0].RedemptionId)
	require.Nil(t, items[0].InvoiceStatus)
	require.Zero(t, items[0].InvoicedAt)
	require.Zero(t, items[0].InvoicedBy)
	require.False(t, items[0].InvoiceEligible)
	data, err := json.Marshal(items)
	require.NoError(t, err)
	require.NotContains(t, string(data), "operator_user_id")
	require.NotContains(t, string(data), "invoice_status")
	require.NotContains(t, string(data), "topup_id")
	require.NotContains(t, string(data), "redemption_id")
}

func TestBillingHistoryTotalQuotaIncludesSignedAdjustments(t *testing.T) {
	typeQuotas := model.BillingHistoryTypeQuotas{
		model.BillingTypeOnlineTopup:     500,
		model.BillingTypeRedemption:      200,
		model.BillingTypeAffiliate:       100,
		model.BillingTypeAdminAdjustment: -50,
	}

	require.Equal(t, int64(750), billingHistoryTotalQuota(typeQuotas))
}
