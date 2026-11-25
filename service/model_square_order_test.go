package service

import (
	"strconv"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestBuildModelSquareOrder(t *testing.T) {
	database, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := database.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	require.NoError(t, database.AutoMigrate(&model.QuotaData{}))
	previousDB := model.DB
	previousOptions := common.OptionMap
	previousDataExport := common.DataExportEnabled
	model.DB = database
	t.Cleanup(func() {
		model.DB = previousDB
		common.OptionMap = previousOptions
		common.DataExportEnabled = previousDataExport
		modelUsageCache = map[int]modelUsageCacheItem{}
		_ = sqlDB.Close()
	})

	hourAgo := time.Now().Add(-time.Hour).Unix()
	require.NoError(t, database.Create(&[]model.QuotaData{
		{ModelName: "gamma", UseGroup: "default", CreatedAt: hourAgo, Count: 5, TokenUsed: 900},
		// Ties with gamma: byte order puts upper case first.
		{ModelName: "Kappa", UseGroup: "default", CreatedAt: hourAgo, Count: 5, TokenUsed: 900},
		{ModelName: "beta", UseGroup: "default", CreatedAt: hourAgo, Count: 9, TokenUsed: 100},
		{ModelName: "beta", UseGroup: "default", CreatedAt: hourAgo - 3600, Count: 1, TokenUsed: 50},
		// Per-call models can have requests without tokens.
		{ModelName: "delta", UseGroup: "default", CreatedAt: hourAgo, Count: 3},
		{ModelName: "alpha", UseGroup: "default", CreatedAt: hourAgo - 10*24*3600, Count: 99, TokenUsed: 9999},
		{ModelName: "zeta", UseGroup: "Default", CreatedAt: hourAgo, Count: 80, TokenUsed: 8000},
		{ModelName: "zeta", CreatedAt: hourAgo, Count: 90, TokenUsed: 9000},
		{ModelName: "retired", CreatedAt: hourAgo, Count: 50, TokenUsed: 5000},
	}).Error)
	pricing := []model.Pricing{{ModelName: "alpha"}, {ModelName: "beta"}, {ModelName: "delta"}, {ModelName: "gamma"}, {ModelName: "Kappa"}, {ModelName: "zeta"}}
	requests := []string{"beta", "Kappa", "gamma", "delta"}
	tokens := []string{"Kappa", "gamma", "beta"}

	for _, tc := range []struct {
		name       string
		setting    operation_setting.ModelSquareSetting
		dataExport bool
		want       ModelSquareOrder
	}{
		{
			name:       "no config keeps vendor order",
			dataExport: true,
			want:       ModelSquareOrder{DefaultSort: "vendor", Recommended: []string{}, Requests: requests, Tokens: tokens},
		},
		{
			name:       "empty manual list keeps name order",
			setting:    operation_setting.ModelSquareSetting{SortMode: "manual", SortMetric: "tokens", SortDays: 7},
			dataExport: true,
			want:       ModelSquareOrder{Recommended: []string{}, Requests: requests, Tokens: tokens},
		},
		{
			name:       "manual drops unlisted and repeated names",
			setting:    operation_setting.ModelSquareSetting{SortMode: "manual", SortMetric: "tokens", SortDays: 7, SortModels: []string{"zeta", "retired", "alpha", "zeta"}},
			dataExport: true,
			want:       ModelSquareOrder{Recommended: []string{"zeta", "alpha"}, Requests: requests, Tokens: tokens},
		},
		{
			name:       "most requests",
			setting:    operation_setting.ModelSquareSetting{SortMode: "usage", SortMetric: "requests", SortDays: 7},
			dataExport: true,
			want:       ModelSquareOrder{Recommended: requests, Requests: requests, Tokens: tokens},
		},
		{
			name:       "most tokens leaves models without tokens to the name tail",
			setting:    operation_setting.ModelSquareSetting{SortMode: "usage", SortMetric: "tokens", SortDays: 7},
			dataExport: true,
			want:       ModelSquareOrder{Recommended: tokens, Requests: requests, Tokens: tokens},
		},
		{
			name:       "pinned models come before the most used",
			setting:    operation_setting.ModelSquareSetting{SortMode: "mixed", SortMetric: "tokens", SortDays: 7, SortModels: []string{"delta", "retired", "beta"}},
			dataExport: true,
			want:       ModelSquareOrder{Recommended: []string{"delta", "beta", "Kappa", "gamma"}, Requests: requests, Tokens: tokens},
		},
		{
			name:       "longer period counts older usage",
			setting:    operation_setting.ModelSquareSetting{SortMode: "usage", SortMetric: "tokens", SortDays: 30},
			dataExport: true,
			want:       ModelSquareOrder{Recommended: []string{"alpha", "Kappa", "gamma", "beta"}, Requests: []string{"alpha", "beta", "Kappa", "gamma", "delta"}, Tokens: []string{"alpha", "Kappa", "gamma", "beta"}},
		},
		{
			name:    "without dashboard data usage sorts fall back to names",
			setting: operation_setting.ModelSquareSetting{SortMode: "mixed", SortMetric: "requests", SortDays: 7, SortModels: []string{"gamma"}},
			want:    ModelSquareOrder{Recommended: []string{"gamma"}, Requests: []string{}, Tokens: []string{}},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			pinned, err := common.Marshal(tc.setting.SortModels)
			require.NoError(t, err)
			common.OptionMap = map[string]string{
				"model_square_setting.sort_mode":   tc.setting.SortMode,
				"model_square_setting.sort_metric": tc.setting.SortMetric,
				"model_square_setting.sort_days":   strconv.Itoa(tc.setting.SortDays),
				"model_square_setting.sort_models": string(pinned),
			}
			common.DataExportEnabled = tc.dataExport
			modelUsageCache = map[int]modelUsageCacheItem{}

			assert.Equal(t, tc.want, BuildModelSquareOrder(pricing, map[string]string{"default": "Public"}))
		})
	}

	// The public model square gets names only, never usage figures.
	common.OptionMap = map[string]string{
		"model_square_setting.sort_mode":   "usage",
		"model_square_setting.sort_metric": "requests",
		"model_square_setting.sort_days":   "7",
	}
	common.DataExportEnabled = true
	encoded, err := common.Marshal(BuildModelSquareOrder(pricing, map[string]string{"default": "Public"}))
	require.NoError(t, err)
	adminTotals, err := GetModelUsageTotals(7)
	require.NoError(t, err)
	assert.Contains(t, adminTotals, model.ModelUsageTotal{ModelName: "zeta", Requests: 170, Tokens: 17000})
	assert.JSONEq(t, `{"recommended":["beta","Kappa","gamma","delta"],"requests":["beta","Kappa","gamma","delta"],"tokens":["Kappa","gamma","beta"]}`, string(encoded))
}
