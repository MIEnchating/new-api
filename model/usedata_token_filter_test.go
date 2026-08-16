package model

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestQuotaDataTokenNameFilterIsFuzzy(t *testing.T) {
	truncateTables(t)
	require.NoError(t, DB.Create(&Token{Id: 11, UserId: 1, Key: "sk-primary-filter", Name: "primary-west"}).Error)
	require.NoError(t, DB.Create(&QuotaData{
		UserID: 1, Username: "alice", TokenID: 11, ModelName: "gpt-a",
		CreatedAt: 1000, Count: 2, TokenUsed: 40, Quota: 100,
	}).Error)

	rows, err := GetAllQuotaDates(900, 2000, "", "mary-we")
	require.NoError(t, err)
	require.Len(t, rows, 1)
	require.Equal(t, "gpt-a", rows[0].ModelName)

	noRows, err := GetAllQuotaDates(900, 2000, "", "missing")
	require.NoError(t, err)
	require.Empty(t, noRows)
}
