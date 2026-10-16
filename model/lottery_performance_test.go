package model

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"
)

// Log schema from v2026.10.16-2, before the lottery aggregation index.
type lotteryLegacyLog struct {
	Id                  int   `gorm:"index:idx_created_at_id,priority:2;index:idx_user_id_id,priority:2"`
	UserId              int   `gorm:"index;index:idx_user_id_id,priority:1"`
	CreatedAt           int64 `gorm:"bigint;index:idx_created_at_id,priority:1;index:idx_created_at_type"`
	Type                int   `gorm:"index:idx_created_at_type"`
	Content             string
	Username            string  `gorm:"index;index:index_username_model_name,priority:2;default:''"`
	TokenName           string  `gorm:"index;default:''"`
	ModelName           string  `gorm:"index;index:index_username_model_name,priority:1;default:''"`
	ActualResponseModel *string `gorm:"type:varchar(100)"`
	Quota               int     `gorm:"default:0"`
	PromptTokens        int     `gorm:"default:0"`
	CompletionTokens    int     `gorm:"default:0"`
	UseTime             int     `gorm:"default:0"`
	IsStream            bool
	ChannelId           int    `gorm:"index"`
	ChannelName         string `gorm:"->"`
	TokenId             int    `gorm:"default:0;index"`
	Group               string `gorm:"index"`
	Ip                  string `gorm:"index;default:''"`
	RequestId           string `gorm:"type:varchar(64);index:idx_logs_request_id;default:''"`
	UpstreamRequestId   string `gorm:"type:varchar(128);index:idx_logs_upstream_request_id;default:''"`
	Other               string
}

type lotteryQueryCounter struct {
	gormlogger.Interface
	statements int
}

func (counter *lotteryQueryCounter) Trace(ctx context.Context, begin time.Time, fc func() (string, int64), err error) {
	counter.statements++
	counter.Interface.Trace(ctx, begin, fc, err)
}

func TestLotteryStatusDatabasePerformance(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			var dialector, logDialector gorm.Dialector
			switch dialect {
			case "sqlite":
				dialector = sqlite.Open(":memory:")
				logDialector = sqlite.Open(":memory:")
			case "mysql":
				dsn := os.Getenv("TEST_MYSQL_DSN")
				if dsn == "" {
					t.Skip("TEST_MYSQL_DSN is not configured")
				}
				dialector = mysql.Open(dsn)
				logDSN := os.Getenv("TEST_MYSQL_LOG_DSN")
				if logDSN == "" {
					logDSN = dsn
				}
				logDialector = mysql.Open(logDSN)
			case "postgres":
				dsn := os.Getenv("TEST_POSTGRES_DSN")
				if dsn == "" {
					t.Skip("TEST_POSTGRES_DSN is not configured")
				}
				dialector = postgres.New(postgres.Config{DSN: dsn, PreferSimpleProtocol: true})
				logDSN := os.Getenv("TEST_POSTGRES_LOG_DSN")
				if logDSN == "" {
					logDSN = dsn
				}
				logDialector = postgres.New(postgres.Config{DSN: logDSN, PreferSimpleProtocol: true})
			}
			counter := &lotteryQueryCounter{Interface: gormlogger.Default.LogMode(gormlogger.Silent)}
			db, err := gorm.Open(dialector, &gorm.Config{Logger: counter})
			require.NoError(t, err)
			sqlDB, err := db.DB()
			require.NoError(t, err)
			sqlDB.SetMaxOpenConns(1)
			t.Cleanup(func() { assert.NoError(t, sqlDB.Close()) })
			logDB, err := gorm.Open(logDialector, &gorm.Config{Logger: counter})
			require.NoError(t, err)
			sqlLogDB, err := logDB.DB()
			require.NoError(t, err)
			sqlLogDB.SetMaxOpenConns(1)
			t.Cleanup(func() { assert.NoError(t, sqlLogDB.Close()) })
			var version string
			versionQuery := "SELECT version()"
			if dialect == "sqlite" {
				versionQuery = "SELECT sqlite_version()"
			}
			require.NoError(t, db.Raw(versionQuery).Scan(&version).Error)
			t.Logf("%s %s", dialect, version)

			for _, upgrade := range []bool{false, true} {
				name := "fresh"
				if upgrade {
					name = "upgrade_v2026.10.16-2"
				}
				t.Run(name, func(t *testing.T) {
					// DSNs must point to dedicated test databases, as with the other
					// database compatibility tests in this package.
					models := []any{&LotteryCampaign{}, &LotteryProfile{}, &LotteryDailyActivity{}, &LotteryChanceGrant{}, &LotteryDraw{}, &TopUp{}}
					require.NoError(t, db.Migrator().DropTable(models...))
					t.Cleanup(func() { assert.NoError(t, db.Migrator().DropTable(models...)) })
					require.NoError(t, logDB.Migrator().DropTable(&Log{}))
					t.Cleanup(func() { assert.NoError(t, logDB.Migrator().DropTable(&Log{})) })
					if upgrade {
						require.NoError(t, logDB.Table("logs").AutoMigrate(&lotteryLegacyLog{}))
						require.NoError(t, logDB.Table("logs").Create(&lotteryLegacyLog{
							UserId: 99, Type: LogTypeConsume, Quota: 123, Content: "historical log", RequestId: "historical-request",
						}).Error)
					}
					for range 2 {
						require.NoError(t, db.AutoMigrate(models...))
						require.NoError(t, logDB.AutoMigrate(&Log{}))
					}
					assert.True(t, logDB.Migrator().HasIndex(&Log{}, "idx_logs_user_type_created_at"))
					assert.True(t, logDB.Migrator().HasIndex(&Log{}, "idx_user_id_id"))
					assert.True(t, logDB.Migrator().HasIndex(&Log{}, "idx_created_at_type"))
					if upgrade {
						var historical Log
						require.NoError(t, logDB.Where("request_id = ?", "historical-request").First(&historical).Error)
						assert.Equal(t, 123, historical.Quota)
						assert.Equal(t, "historical log", historical.Content)
					}
					oldDB, oldLogDB, oldQuotaPerUnit := DB, LOG_DB, common.QuotaPerUnit
					oldMainType, oldLogType := common.MainDatabaseType(), common.LogDatabaseType()
					DB, LOG_DB, common.QuotaPerUnit = db, logDB, 100
					common.SetDatabaseTypes(common.DatabaseType(dialect), common.DatabaseType(dialect))
					initCol()
					t.Cleanup(func() {
						DB, LOG_DB, common.QuotaPerUnit = oldDB, oldLogDB, oldQuotaPerUnit
						common.SetDatabaseTypes(oldMainType, oldLogType)
						initCol()
					})
					config := defaultLotteryConfig()
					now := time.Date(2026, time.October, 16, 12, 0, 0, 0, time.Local)
					start := lotteryDayStart(now).AddDate(0, 0, -104)
					config.GrantRules = []LotteryChanceGrantRule{{
						Id: "launch", Name: "Launch event", Type: LotteryChanceGrantRuleEvent, Enabled: true,
						Chances: 2, StartAt: start.Unix(), EndAt: now.AddDate(0, 0, 1).Unix(), Reclaim: true,
					}}
					setLotteryConfigForTest(t, config)
					require.NoError(t, DB.Create(&LotteryCampaign{Id: 1, StartedAt: start.Unix()}).Error)
					// Cross both aggregation and activity-write batch boundaries.
					for _, day := range []time.Time{start, start.AddDate(0, 0, 1), start.AddDate(0, 0, 2), start.AddDate(0, 0, 31), now} {
						addLotteryConsumeLog(t, 61, day, 2000)
					}
					addLotteryConsumeLog(t, 62, now, 50000)
					require.NoError(t, LOG_DB.Create(&Log{UserId: 61, Type: LogTypeSystem, CreatedAt: now.Unix(), Quota: 50000}).Error)

					counter.statements = 0
					status, err := getLotteryStatusAt(61, now)
					require.NoError(t, err)
					firstStatements := counter.statements
					assert.LessOrEqual(t, firstStatements, 30, "historical catch-up must batch database writes")
					assert.Equal(t, 3, status.AvailableChances)
					assert.Equal(t, 2000, status.TodaySpendQuota)
					assert.Equal(t, 2000, status.WeeklySpendQuota)
					var activities []LotteryDailyActivity
					require.NoError(t, DB.Where("user_id = ?", 61).Order("activity_date").Find(&activities).Error)
					require.Len(t, activities, 105)
					assert.Equal(t, 2000, activities[31].Quota)
					assert.Zero(t, activities[30].Quota)
					assert.False(t, activities[30].Active)

					// A refresh must include new consumption, preserve spent chances,
					// and refresh event expiry without issuing the same reward twice.
					require.NoError(t, DB.Model(&LotteryChanceGrant{}).Where("type = ?", "campaign_launch").Update("consumed", 1).Error)
					config.GrantRules[0].EndAt = now.AddDate(0, 0, 2).Unix()
					setLotteryConfigForTest(t, config)
					addLotteryConsumeLog(t, 61, now, 3000)
					counter.statements = 0
					status, err = getLotteryStatusAt(61, now)
					require.NoError(t, err)
					t.Logf("status statements: first=%d refresh=%d", firstStatements, counter.statements)
					assert.Equal(t, 3, status.AvailableChances)
					assert.Equal(t, 5000, status.TodaySpendQuota)
					assert.Equal(t, 1, status.WeeklyEarnedChances)
					var event LotteryChanceGrant
					require.NoError(t, DB.Where("type = ?", "campaign_launch").First(&event).Error)
					assert.Equal(t, 1, event.Consumed)
					assert.Equal(t, config.GrantRules[0].EndAt, event.ExpiresAt)
					assert.Error(t, DB.Create(&LotteryChanceGrant{EventKey: event.EventKey, UserId: 61, Chances: 1}).Error, "event uniqueness survives migration")

					// The maximum supported event-rule count crosses multiple write
					// batches; existing weekly, streak and consumed rewards survive.
					config.GrantRules = make([]LotteryChanceGrantRule, 100)
					for i := range config.GrantRules {
						config.GrantRules[i] = LotteryChanceGrantRule{
							Id: fmt.Sprintf("event-%d", i), Name: "Event reward",
							Type: LotteryChanceGrantRuleEvent, Enabled: true, Chances: 1,
						}
					}
					setLotteryConfigForTest(t, config)
					for range 2 {
						counter.statements = 0
						status, err = getLotteryStatusAt(61, now)
						require.NoError(t, err)
						assert.Equal(t, 103, status.AvailableChances)
						assert.LessOrEqual(t, counter.statements, 20, "event rewards must be issued in batches")
					}
					var grants int64
					assert.NoError(t, DB.Model(&LotteryChanceGrant{}).Where("user_id = ?", 61).Count(&grants).Error)
					assert.EqualValues(t, 103, grants)
				})
			}
		})
	}
}
