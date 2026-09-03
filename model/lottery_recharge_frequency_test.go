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

func verifyLotteryDailyRechargeGrantUserScope(t *testing.T, db *gorm.DB) {
	t.Helper()
	require.NoError(t, db.AutoMigrate(&LotteryChanceGrant{}))
	ruleId := fmt.Sprintf("daily-user-scope-%d", time.Now().UnixNano())
	grantType := "recharge_" + ruleId
	t.Cleanup(func() {
		require.NoError(t, db.Where("type = ?", grantType).Delete(&LotteryChanceGrant{}).Error)
	})
	now := time.Date(2026, time.September, 3, 9, 0, 0, 0, time.Local)
	rule := LotteryChanceGrantRule{
		Id: ruleId, Type: LotteryChanceGrantRuleRecharge,
		Name: "Daily user scope", Enabled: true, Threshold: 50,
		Limit: LotteryRechargeGrantDaily, Chances: 1,
		StartAt: now.Add(-time.Hour).Unix(), EndAt: now.Add(time.Hour).Unix(),
	}
	for _, userId := range []int{910001, 910002} {
		topUps := []TopUp{{
			Id: userId, UserId: userId, Amount: 50,
			Status: "success", CompleteTime: now.Unix(),
		}}
		require.NoError(t, syncDailyRechargeGrants(db, userId, rule, topUps, now.Unix()))
		require.NoError(t, syncDailyRechargeGrants(db, userId, rule, topUps, now.Unix()))
	}

	var grants []LotteryChanceGrant
	require.NoError(t, db.Where("type = ?", grantType).Order("user_id").Find(&grants).Error)
	require.Len(t, grants, 2)
	assert.Equal(t, 910001, grants[0].UserId)
	assert.Equal(t, 910002, grants[1].UserId)
	assert.NotEqual(t, grants[0].EventKey, grants[1].EventKey)
}

func TestLotteryDailyRechargeGrantUserScopeSQLite(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	verifyLotteryDailyRechargeGrantUserScope(t, db)
}

func TestLotteryDailyRechargeGrantUserScopeMySQL(t *testing.T) {
	dsn := strings.TrimSpace(os.Getenv("TEST_MYSQL_DSN"))
	if dsn == "" {
		t.Skip("TEST_MYSQL_DSN is not configured")
	}
	db, err := gorm.Open(mysql.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, sqlDB.Close()) })
	verifyLotteryDailyRechargeGrantUserScope(t, db)
}

func TestLotteryDailyRechargeGrantUserScopePostgreSQL(t *testing.T) {
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
	verifyLotteryDailyRechargeGrantUserScope(t, db)
}
