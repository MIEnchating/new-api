package model

import (
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

type legacyLotteryChanceGrant struct {
	Id         int64  `gorm:"primaryKey"`
	EventKey   string `gorm:"type:varchar(128);uniqueIndex"`
	UserId     int    `gorm:"index:idx_lottery_grant_user_time,priority:1"`
	Type       string `gorm:"type:varchar(32);index"`
	SourceName string `gorm:"type:varchar(80)"`
	Chances    int
	Consumed   int
	ExpiresAt  int64 `gorm:"bigint;index"`
	CreatedAt  int64 `gorm:"bigint;index:idx_lottery_grant_user_time,priority:2"`
}

func testLotteryChanceGrantAuditMigration(t *testing.T, db *gorm.DB) {
	t.Helper()
	suffix := time.Now().UnixNano()
	freshTable := fmt.Sprintf("lottery_grant_fresh_%d", suffix)
	upgradeTable := fmt.Sprintf("lottery_grant_upgrade_%d", suffix)
	t.Cleanup(func() {
		_ = db.Migrator().DropTable(freshTable)
		_ = db.Migrator().DropTable(upgradeTable)
	})

	freshDB := db.Table(freshTable)
	for range 2 {
		require.NoError(t, freshDB.AutoMigrate(&LotteryChanceGrant{}))
	}
	assert.True(t, freshDB.Migrator().HasColumn(&LotteryChanceGrant{}, "operator_user_id"))
	assert.True(t, freshDB.Migrator().HasColumn(&LotteryChanceGrant{}, "detail"))
	require.NoError(t, db.Migrator().DropTable(freshTable))

	upgradeDB := db.Table(upgradeTable)
	require.NoError(t, upgradeDB.AutoMigrate(&legacyLotteryChanceGrant{}))
	legacy := legacyLotteryChanceGrant{
		EventKey: "legacy-grant", UserId: 42, Type: "weekly_spend",
		SourceName: "Legacy source", Chances: 2, CreatedAt: 1_700_000_000,
	}
	require.NoError(t, upgradeDB.Create(&legacy).Error)
	for range 2 {
		require.NoError(t, upgradeDB.AutoMigrate(&LotteryChanceGrant{}))
	}

	var migrated LotteryChanceGrant
	require.NoError(t, upgradeDB.Where("event_key = ?", legacy.EventKey).First(&migrated).Error)
	assert.Equal(t, legacy.UserId, migrated.UserId)
	assert.Equal(t, legacy.Chances, migrated.Chances)
	assert.Zero(t, migrated.OperatorUserId)
	assert.Empty(t, migrated.Detail)
}

func TestLotteryChanceGrantAuditMigrationSQLite(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	testLotteryChanceGrantAuditMigration(t, db)
}

func TestLotteryChanceGrantAuditMigrationMySQL(t *testing.T) {
	dsn := strings.TrimSpace(os.Getenv("TEST_MYSQL_DSN"))
	if dsn == "" {
		t.Skip("TEST_MYSQL_DSN is not configured")
	}
	db, err := gorm.Open(mysql.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, sqlDB.Close()) })
	testLotteryChanceGrantAuditMigration(t, db)
}

func TestLotteryChanceGrantAuditMigrationPostgreSQL(t *testing.T) {
	dsn := strings.TrimSpace(os.Getenv("TEST_POSTGRES_DSN"))
	if dsn == "" {
		t.Skip("TEST_POSTGRES_DSN is not configured")
	}
	db, err := gorm.Open(postgres.New(postgres.Config{
		DSN: dsn, PreferSimpleProtocol: true,
	}), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, sqlDB.Close()) })
	testLotteryChanceGrantAuditMigration(t, db)
}
