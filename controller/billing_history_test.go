package controller

import (
	"encoding/json"
	"testing"

	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/require"
)

func TestRedactUserBillingHistoryRemovesOperatorUserID(t *testing.T) {
	items := []model.BillingHistoryItem{
		{
			Id:             "billing:1",
			UserId:         42,
			Type:           model.BillingTypeAdminAdjustment,
			OperatorUserId: 7,
		},
	}

	redactUserBillingHistory(items)

	require.Zero(t, items[0].OperatorUserId)
	data, err := json.Marshal(items)
	require.NoError(t, err)
	require.NotContains(t, string(data), "operator_user_id")
}
