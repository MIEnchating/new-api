package model

import (
	"testing"

	"github.com/stretchr/testify/assert"
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

func TestQuotaDataCacheUsagePreservesTokenAndUserFilters(t *testing.T) {
	truncateTables(t)
	require.NoError(t, DB.Create(&[]Token{
		{Id: 11, UserId: 1, Key: "sk-cache-primary", Name: "primary-west"},
		{Id: 12, UserId: 1, Key: "sk-cache-backup", Name: "backup"},
		{Id: 21, UserId: 2, Key: "sk-cache-other", Name: "primary-west"},
	}).Error)
	CacheQuotaDataLock.Lock()
	previousCache := CacheQuotaData
	CacheQuotaData = make(map[string]*QuotaData)
	CacheQuotaDataLock.Unlock()
	t.Cleanup(func() {
		CacheQuotaDataLock.Lock()
		CacheQuotaData = previousCache
		CacheQuotaDataLock.Unlock()
	})
	params := QuotaDataLogParams{
		UserID: 1, Username: "alice", TokenID: 11, ModelName: "gpt-a",
		CreatedAt: 3661, TokenUsed: 100, Quota: 10,
		CacheReadTokens: 20, CacheCreationTokens: 5,
	}
	LogQuotaData(params)
	LogQuotaData(params)
	SaveQuotaDataCache()
	// A later flush must increment the existing row, not replace its counters.
	LogQuotaData(params)
	SaveQuotaDataCache()
	require.NoError(t, DB.Create(&[]QuotaData{
		{UserID: 1, Username: "alice", TokenID: 12, ModelName: "gpt-a", CreatedAt: 3600, TokenUsed: 1000, CacheReadTokens: 200, CacheCreationTokens: 50},
		{UserID: 2, Username: "bob", TokenID: 21, ModelName: "gpt-a", CreatedAt: 3600, TokenUsed: 2000, CacheReadTokens: 400, CacheCreationTokens: 100},
	}).Error)
	for _, tc := range []struct {
		name                string
		query               func() ([]*QuotaData, error)
		wantTokens          int
		wantRead, wantWrite int64
	}{
		{"all users matching token", func() ([]*QuotaData, error) { return GetAllQuotaDates(3600, 7200, "", "mary-we") }, 2300, 460, 115},
		{"username and token", func() ([]*QuotaData, error) { return GetAllQuotaDates(3600, 7200, "alice", "mary-we") }, 300, 60, 15},
		{"user ID and token", func() ([]*QuotaData, error) { return GetQuotaDataByUserId(1, 3600, 7200, "mary-we") }, 300, 60, 15},
		{"all tokens for user", func() ([]*QuotaData, error) { return GetQuotaDataByUserId(1, 3600, 7200, "") }, 1300, 260, 65},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rows, err := tc.query()
			require.NoError(t, err)
			require.Len(t, rows, 1)
			assert.Equal(t, tc.wantTokens, rows[0].TokenUsed)
			assert.Equal(t, tc.wantRead, rows[0].CacheReadTokens)
			assert.Equal(t, tc.wantWrite, rows[0].CacheCreationTokens)
		})
	}
}
