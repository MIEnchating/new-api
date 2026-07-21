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
			Id:             "billing:1",
			TopUpId:        99,
			UserId:         42,
			Type:           model.BillingTypeAdminAdjustment,
			OperatorUserId: 7,
			InvoiceStatus:  &invoiceStatus,
			InvoicedAt:     123,
			InvoicedBy:     7,
		},
	}

	redactUserBillingHistory(items)

	require.Zero(t, items[0].OperatorUserId)
	require.Zero(t, items[0].TopUpId)
	require.Nil(t, items[0].InvoiceStatus)
	require.Zero(t, items[0].InvoicedAt)
	require.Zero(t, items[0].InvoicedBy)
	data, err := json.Marshal(items)
	require.NoError(t, err)
	require.NotContains(t, string(data), "operator_user_id")
	require.NotContains(t, string(data), "invoice_status")
	require.NotContains(t, string(data), "topup_id")
}
