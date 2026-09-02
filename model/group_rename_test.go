package model

import (
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

var groupRenameModels = []any{
	&Option{}, &User{}, &Token{}, &Channel{}, &Ability{},
	&SubscriptionPlan{}, &UserSubscription{}, &Task{},
}

func setupGroupRenameTestDatabase(t *testing.T) *gorm.DB {
	t.Helper()
	originalDB := DB
	originalRedisEnabled := common.RedisEnabled
	originalMemoryCacheEnabled := common.MemoryCacheEnabled
	dsn := fmt.Sprintf("file:%s?mode=memory&cache=shared", strings.ReplaceAll(t.Name(), "/", "_"))
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(groupRenameModels...))
	DB = db
	common.RedisEnabled = false
	common.MemoryCacheEnabled = false
	t.Cleanup(func() {
		DB = originalDB
		common.RedisEnabled = originalRedisEnabled
		common.MemoryCacheEnabled = originalMemoryCacheEnabled
		sqlDB, err := db.DB()
		if err == nil {
			require.NoError(t, sqlDB.Close())
		}
	})
	return db
}

func TestUpdateGroupSettingsAndReferencesRenamesLiveGroupReferences(t *testing.T) {
	db := setupGroupRenameTestDatabase(t)
	verifyGroupRenameLiveReferences(t, db)
}

func verifyGroupRenameLiveReferences(t *testing.T, db *gorm.DB) {
	t.Helper()
	priority := int64(0)
	weight := uint(100)
	user := User{Username: "rename-user", Password: "password", Group: "vip", AffCode: "rename-aff"}
	require.NoError(t, db.Create(&user).Error)
	token := Token{
		UserId:           user.Id,
		Key:              "rename-token-key",
		Name:             "rename-token",
		Group:            "vip",
		AutoGroups:       `["default","vip"]`,
		GroupRouteConfig: `[{"group":"vip","priority":1,"cooldown_seconds":60}]`,
	}
	require.NoError(t, db.Create(&token).Error)
	channel := Channel{
		Id:       81001,
		Type:     constant.ChannelTypeOpenAI,
		Key:      "rename-channel-key",
		Status:   common.ChannelStatusEnabled,
		Name:     "rename-channel",
		Weight:   &weight,
		Models:   "rename-model",
		Group:    "default,vip",
		Priority: &priority,
	}
	require.NoError(t, db.Create(&channel).Error)
	require.NoError(t, channel.AddAbilities(db))
	plan := SubscriptionPlan{Title: "rename-plan", UpgradeGroup: "vip", DowngradeGroup: "vip"}
	require.NoError(t, db.Create(&plan).Error)
	subscription := UserSubscription{
		UserId:         user.Id,
		PlanId:         plan.Id,
		Status:         "active",
		UpgradeGroup:   "vip",
		PrevUserGroup:  "vip",
		DowngradeGroup: "vip",
	}
	require.NoError(t, db.Create(&subscription).Error)
	pendingTask := Task{TaskID: "rename-pending", Group: "vip", Status: TaskStatusInProgress}
	finishedTask := Task{TaskID: "rename-finished", Group: "vip", Status: TaskStatusSuccess}
	require.NoError(t, db.Create(&pendingTask).Error)
	require.NoError(t, db.Create(&finishedTask).Error)

	require.NoError(t, UpdateGroupSettingsAndReferences(nil, map[string]string{"vip": "pro"}))

	require.NoError(t, db.First(&user, user.Id).Error)
	assert.Equal(t, "pro", user.Group)
	require.NoError(t, db.First(&token, token.Id).Error)
	assert.Equal(t, "pro", token.Group)
	assert.JSONEq(t, `["default","pro"]`, token.AutoGroups)
	assert.JSONEq(t, `[{"group":"pro","priority":1,"cooldown_seconds":60}]`, token.GroupRouteConfig)
	require.NoError(t, db.First(&channel, channel.Id).Error)
	assert.Equal(t, "default,pro", channel.Group)
	var abilities []Ability
	require.NoError(t, db.Where("channel_id = ?", channel.Id).Order(commonGroupCol).Find(&abilities).Error)
	require.Len(t, abilities, 2)
	assert.Equal(t, []string{"default", "pro"}, []string{abilities[0].Group, abilities[1].Group})
	require.NoError(t, db.First(&plan, plan.Id).Error)
	assert.Equal(t, "pro", plan.UpgradeGroup)
	assert.Equal(t, "pro", plan.DowngradeGroup)
	require.NoError(t, db.First(&subscription, subscription.Id).Error)
	assert.Equal(t, "pro", subscription.UpgradeGroup)
	assert.Equal(t, "pro", subscription.PrevUserGroup)
	assert.Equal(t, "pro", subscription.DowngradeGroup)
	require.NoError(t, db.First(&pendingTask, pendingTask.ID).Error)
	assert.Equal(t, "pro", pendingTask.Group)
	require.NoError(t, db.First(&finishedTask, finishedTask.ID).Error)
	assert.Equal(t, "vip", finishedTask.Group)
}

func TestUpdateGroupSettingsAndReferencesConfiguredDatabases(t *testing.T) {
	tests := []struct {
		name         string
		env          string
		databaseType common.DatabaseType
		dialector    func(string) gorm.Dialector
	}{
		{name: "mysql", env: "TEST_MYSQL_DSN", databaseType: common.DatabaseTypeMySQL, dialector: func(dsn string) gorm.Dialector {
			return mysql.Open(dsn)
		}},
		{name: "postgres", env: "TEST_POSTGRES_DSN", databaseType: common.DatabaseTypePostgreSQL, dialector: func(dsn string) gorm.Dialector {
			return postgres.New(postgres.Config{DSN: dsn, PreferSimpleProtocol: true})
		}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			dsn := strings.TrimSpace(os.Getenv(test.env))
			if dsn == "" {
				t.Skip(test.env + " is not configured")
			}
			db, err := gorm.Open(test.dialector(dsn), &gorm.Config{})
			require.NoError(t, err)
			sqlDB, err := db.DB()
			require.NoError(t, err)
			t.Cleanup(func() { _ = sqlDB.Close() })

			originalDB := DB
			originalType := common.MainDatabaseType()
			originalRedisEnabled := common.RedisEnabled
			originalMemoryCacheEnabled := common.MemoryCacheEnabled
			DB = db
			common.SetMainDatabaseType(test.databaseType)
			common.RedisEnabled = false
			common.MemoryCacheEnabled = false
			initCol()
			t.Cleanup(func() {
				DB = originalDB
				common.SetMainDatabaseType(originalType)
				common.RedisEnabled = originalRedisEnabled
				common.MemoryCacheEnabled = originalMemoryCacheEnabled
				initCol()
			})

			require.NoError(t, db.AutoMigrate(groupRenameModels...))
			verifyGroupRenameLiveReferences(t, db)
		})
	}
}

func TestUpdateGroupSettingsAndReferencesRollsBackWhenTokenRoutingIsMalformed(t *testing.T) {
	db := setupGroupRenameTestDatabase(t)
	require.NoError(t, db.Create(&Option{Key: "GroupRatio", Value: `{"vip":1}`}).Error)
	user := User{Username: "rollback-user", Password: "password", Group: "vip", AffCode: "rollback-aff"}
	require.NoError(t, db.Create(&user).Error)
	require.NoError(t, db.Create(&Token{
		UserId:     user.Id,
		Key:        "rollback-token-key",
		Name:       "rollback-token",
		Group:      "vip",
		AutoGroups: `not-json`,
	}).Error)

	err := UpdateGroupSettingsAndReferences(
		map[string]string{"GroupRatio": `{"pro":1}`},
		map[string]string{"vip": "pro"},
	)

	require.Error(t, err)
	require.NoError(t, db.First(&user, user.Id).Error)
	assert.Equal(t, "vip", user.Group)
	var option Option
	require.NoError(t, db.First(&option, "key = ?", "GroupRatio").Error)
	assert.JSONEq(t, `{"vip":1}`, option.Value)
}
