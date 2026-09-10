package model

import (
	"os"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/config"
	"github.com/QuantumNous/new-api/setting/perf_metrics_setting"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestPerfMetricCacheColumnsUpsertAndGroupAggregation(t *testing.T) {
	require.True(t, DB.Migrator().HasColumn(&PerfMetric{}, "cache_requests"))
	require.True(t, DB.Migrator().HasColumn(&PerfMetric{}, "cache_hits"))
	require.True(t, DB.Migrator().HasColumn(&PerfMetric{}, "cached_tokens"))
	require.True(t, DB.Migrator().HasColumn(&PerfMetric{}, "cache_token_read_tokens"))
	require.True(t, DB.Migrator().HasColumn(&PerfMetric{}, "cache_token_denominator"))

	require.NoError(t, DB.Where("model_name LIKE ?", "cache-test-%").Delete(&PerfMetric{}).Error)
	t.Cleanup(func() {
		_ = DB.Where("model_name LIKE ?", "cache-test-%").Delete(&PerfMetric{}).Error
	})

	const bucketTs = int64(1_700_000_000)
	metrics := []*PerfMetric{
		{
			ModelName:     "cache-test-a",
			Group:         "default",
			BucketTs:      bucketTs,
			RequestCount:  1,
			OutputTokens:  20,
			GenerationMs:  1_000,
			CacheRequests: 1,
			CacheHits:     1,
			CachedTokens:  30,
		},
		{
			ModelName:     "cache-test-a",
			Group:         "default",
			BucketTs:      bucketTs,
			RequestCount:  1,
			OutputTokens:  10,
			GenerationMs:  1_000,
			CacheRequests: 1,
		},
		{
			ModelName:     "cache-test-b",
			Group:         "default",
			BucketTs:      bucketTs,
			RequestCount:  1,
			OutputTokens:  30,
			GenerationMs:  1_000,
			CacheRequests: 1,
			CacheHits:     1,
			CachedTokens:  20,
		},
		{
			ModelName:    "cache-test-throughput-only",
			Group:        "default",
			BucketTs:     bucketTs,
			RequestCount: 1,
			OutputTokens: 40,
			GenerationMs: 1_000,
		},
		{
			ModelName:     "cache-test-a",
			Group:         "vip",
			BucketTs:      bucketTs,
			RequestCount:  1,
			CacheRequests: 1,
			CacheHits:     1,
			CachedTokens:  10,
		},
	}
	for _, metric := range metrics {
		require.NoError(t, UpsertPerfMetric(metric))
	}

	rows, err := GetPerfMetricCacheBucketsAll(bucketTs, bucketTs, []string{"default"})
	require.NoError(t, err)
	require.Len(t, rows, 1)
	assert.Equal(t, "default", rows[0].Group)
	assert.EqualValues(t, 3, rows[0].CacheRequests)
	assert.EqualValues(t, 2, rows[0].CacheHits)
	assert.EqualValues(t, 50, rows[0].CachedTokens)
	assert.EqualValues(t, 4, rows[0].RequestCount)
	assert.EqualValues(t, 100, rows[0].OutputTokens)
	assert.EqualValues(t, 4_000, rows[0].GenerationMs)
}

// Set the optional DSNs to run this contract against isolated MySQL/PostgreSQL databases.
func TestMonitorThresholdPersistenceAndGroupMetrics(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			var driver gorm.Dialector
			dbType := common.DatabaseTypeSQLite
			switch dialect {
			case "sqlite":
				driver = sqlite.Open(":memory:")
			case "mysql":
				dsn := os.Getenv("NEWAPI_MONITOR_MYSQL_DSN")
				if dsn == "" {
					t.Skip("NEWAPI_MONITOR_MYSQL_DSN is unset")
				}
				driver = mysql.Open(dsn)
				dbType = common.DatabaseTypeMySQL
			case "postgres":
				dsn := os.Getenv("NEWAPI_MONITOR_POSTGRES_DSN")
				if dsn == "" {
					t.Skip("NEWAPI_MONITOR_POSTGRES_DSN is unset")
				}
				driver = postgres.Open(dsn)
				dbType = common.DatabaseTypePostgreSQL
			}
			db, err := gorm.Open(driver, &gorm.Config{})
			require.NoError(t, err)
			var version string
			versionQuery := "SELECT version()"
			if dialect == "sqlite" {
				versionQuery = "SELECT sqlite_version()"
			}
			require.NoError(t, db.Raw(versionQuery).Scan(&version).Error)
			t.Logf("%s version: %s", dialect, version)
			connection, err := db.DB()
			require.NoError(t, err)
			previousDB, previousType := DB, common.MainDatabaseType()
			previousOptions := common.OptionMap
			settings := config.GlobalConfig.Get("perf_metrics_setting").(*perf_metrics_setting.PerfMetricsSetting)
			previousSettings := *settings
			DB = db
			common.SetMainDatabaseType(dbType)
			initCol()
			common.OptionMap = map[string]string{}
			t.Cleanup(func() {
				DB = previousDB
				common.SetMainDatabaseType(previousType)
				initCol()
				common.OptionMap = previousOptions
				*settings = previousSettings
				require.NoError(t, connection.Close())
			})
			require.NoError(t, db.AutoMigrate(&Option{}, &PerfMetric{}))
			require.NoError(t, db.Where("1 = 1").Delete(&PerfMetric{}).Error)
			require.NoError(t, db.Where("1 = 1").Delete(&Option{}).Error)
			require.NoError(t, UpdateOptionsBulk(map[string]string{"perf_metrics_setting.cache_hit_rate_baseline": "88", "perf_metrics_setting.health_thresholds": "null"}))
			thresholds := perf_metrics_setting.GetHealthThresholds()
			assert.Equal(t, float64(88), thresholds.WarningCacheRate)
			thresholds.WarningCacheRate, thresholds.CriticalCacheRate = 90, 65
			thresholds.MinimumSample = 75
			encoded, err := common.Marshal(thresholds)
			require.NoError(t, err)
			require.NoError(t, UpdateOptionsBulk(map[string]string{"perf_metrics_setting.health_thresholds": string(encoded), "perf_metrics_setting.cache_monitor_groups": `["primary","backup"]`}))
			*settings = previousSettings
			options, err := AllOption()
			require.NoError(t, err)
			loaded := map[string]string{}
			for _, option := range options {
				loaded[option.Key] = option.Value
			}
			require.NoError(t, config.GlobalConfig.LoadFromDB(loaded))
			assert.Equal(t, thresholds, perf_metrics_setting.GetHealthThresholds())
			assert.Equal(t, []string{"primary", "backup"}, perf_metrics_setting.GetCacheMonitorGroups())
			require.NoError(t, db.Create(&[]PerfMetric{
				{ModelName: "a", Group: "primary", BucketTs: 3600, RequestCount: 40, SuccessCount: 38, TtftCount: 30, TtftSumMs: 90000, CacheRequests: 35, CacheHits: 30},
				{ModelName: "b", Group: "primary", BucketTs: 3600, RequestCount: 60, SuccessCount: 52, TtftCount: 50, TtftSumMs: 250000, CacheRequests: 55, CacheHits: 40},
				{ModelName: "a", Group: "hidden", BucketTs: 3600, RequestCount: 1},
			}).Error)
			buckets, err := GetPerfMetricCacheBucketsAll(3600, 3600, []string{"primary"})
			require.NoError(t, err)
			require.Len(t, buckets, 1)
			assert.EqualValues(t, 100, buckets[0].RequestCount)
			assert.EqualValues(t, 90, buckets[0].SuccessCount)
			assert.EqualValues(t, 80, buckets[0].TtftCount)
			assert.EqualValues(t, 340000, buckets[0].TtftSumMs)
			assert.EqualValues(t, 90, buckets[0].CacheRequests)
			assert.EqualValues(t, 70, buckets[0].CacheHits)
			empty, err := GetPerfMetricCacheBucketsAll(3600, 3600, []string{})
			require.NoError(t, err)
			assert.Empty(t, empty)
			// A failed write must leave the active thresholds intact.
			require.NoError(t, db.Callback().Update().Before("gorm:update").Register("monitor:reject", func(tx *gorm.DB) { tx.AddError(assert.AnError) }))
			require.Error(t, UpdateOptionsBulk(map[string]string{"perf_metrics_setting.health_thresholds": "null"}))
			assert.Equal(t, thresholds, perf_metrics_setting.GetHealthThresholds())
		})
	}
}
