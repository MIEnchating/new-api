package model

import (
	"fmt"
	"maps"
	"os"
	"strings"
	"sync"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
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
	preserveGroupRenameRuntime(t)
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

func preserveGroupRenameRuntime(t *testing.T) {
	t.Helper()
	aliases := common.GetGroupAliases()
	ratios := ratio_setting.GroupRatio2JSONString()
	categories, err := common.Marshal(setting.GetGroupCategories())
	require.NoError(t, err)
	common.OptionMapRWMutex.Lock()
	options := common.OptionMap
	common.OptionMap = maps.Clone(options)
	if common.OptionMap == nil {
		common.OptionMap = make(map[string]string)
	}
	common.OptionMapRWMutex.Unlock()
	t.Cleanup(func() {
		require.NoError(t, common.SetGroupAliases(aliases))
		require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(ratios))
		require.NoError(t, setting.UpdateGroupCategories(string(categories)))
		common.OptionMapRWMutex.Lock()
		common.OptionMap = options
		common.OptionMapRWMutex.Unlock()
	})
	require.NoError(t, common.SetGroupAliases(nil))
}

func TestUpdateGroupSettingsAndReferencesRenamesLiveGroupReferences(t *testing.T) {
	db := setupGroupRenameTestDatabase(t)
	verifyGroupRenameLiveReferences(t, db)
}

func verifyGroupRenameLiveReferences(t *testing.T, db *gorm.DB) {
	t.Helper()
	versionQuery := "SELECT VERSION()"
	if db.Dialector.Name() == "sqlite" {
		versionQuery = "SELECT sqlite_version()"
	}
	var version string
	require.NoError(t, db.Raw(versionQuery).Scan(&version).Error)
	t.Logf("database %s %s", db.Dialector.Name(), version)
	require.NoError(t, db.Create(&Option{Key: "GroupRatio", Value: `{"default":1,"vip":2.5}`}).Error)
	require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(`{"default":1,"vip":2.5}`))
	require.NoError(t, UpdateGroupSettingsAndReferences(
		map[string]string{setting.GroupCategoriesOptionKey: `{"vip":" Internal tools ","default":""}`}, nil,
	))
	require.Error(t, UpdateGroupSettingsAndReferences(
		map[string]string{setting.GroupCategoriesOptionKey: `{"vip":42}`}, nil,
	))
	assert.Equal(t, map[string]string{"vip": "Internal tools"}, setting.GetGroupCategories())
	var categoryOption Option
	require.NoError(t, db.Where(&Option{Key: setting.GroupCategoriesOptionKey}).First(&categoryOption).Error)
	assert.JSONEq(t, `{"vip":" Internal tools ","default":""}`, categoryOption.Value)
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

	// Hold a request's channel snapshot across the rename.
	inFlight, err := LoadSatisfiedChannelSelectionSnapshot("vip", "rename-model", "/v1/chat/completions")
	require.NoError(t, err)
	require.NoError(t, UpdateGroupSettingsAndReferences(
		map[string]string{
			"GroupRatio":                     `{"default":1,"pro":2.5}`,
			setting.GroupCategoriesOptionKey: `{"pro":"Internal tools"}`,
		},
		map[string]string{"vip": "pro"},
	))
	require.NoError(t, db.Where(&Option{Key: setting.GroupCategoriesOptionKey}).First(&categoryOption).Error)
	assert.JSONEq(t, `{"pro":"Internal tools"}`, categoryOption.Value)
	assert.Equal(t, map[string]string{"pro": "Internal tools"}, setting.GetGroupCategories())
	selected, err := inFlight.Select(0, nil)
	require.NoError(t, err)
	require.NotNil(t, selected)
	assert.Equal(t, channel.Id, selected.Id)
	for _, group := range []string{"vip", "pro"} {
		snapshot, err := LoadSatisfiedChannelSelectionSnapshot(group, "rename-model", "/v1/chat/completions")
		require.NoError(t, err)
		selected, err := snapshot.Select(0, nil)
		require.NoError(t, err)
		require.NotNil(t, selected)
		assert.Equal(t, channel.Id, selected.Id)
		assert.Equal(t, 2.5, ratio_setting.GetGroupRatio(group))
	}

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

	// Repeated renames survive a cold node and keep every earlier name valid.
	require.NoError(t, UpdateGroupSettingsAndReferences(map[string]string{"GroupRatio": `{"default":1,"premium":2.5}`}, map[string]string{"pro": "premium"}))
	require.NoError(t, common.SetGroupAliases(nil))
	for _, group := range []string{"vip", "pro", "premium"} {
		assert.Equal(t, []string{"rename-model"}, GetGroupEnabledModels(group))
		assert.Equal(t, 2.5, ratio_setting.GetGroupRatio(group))
		assert.Equal(t, "vip", common.GroupIdentity(group))
	}
	assert.EqualError(t, UpdateOption("GroupRatio", `{"vip":1,"premium":2.5}`), "Retired group names cannot be reused")
	assert.EqualError(t, UpdateOption(common.GroupAliasesOptionKey, `{}`), "Group rename history cannot be edited directly")
	for range 2 {
		require.NoError(t, UpdateOptionsBulk(map[string]string{"GroupRatio": `{"default":1,"premium":2.5}`}))
		require.NoError(t, refreshGroupAliases())
		assert.Equal(t, "vip", common.GroupIdentity("premium"))
	}
	// Two admins/nodes starting from the same group cannot publish competing
	// aliases. The database row serializes their source-name validation.
	start := make(chan struct{})
	results := make(chan error, 2)
	var workers sync.WaitGroup
	for _, target := range []string{"elite", "ultimate"} {
		workers.Go(func() {
			<-start
			results <- UpdateGroupSettingsAndReferences(
				map[string]string{"GroupRatio": fmt.Sprintf(`{"default":1,%q:2.5}`, target)},
				map[string]string{"premium": target},
			)
		})
	}
	close(start)
	workers.Wait()
	close(results)
	successes := 0
	for err := range results {
		if err == nil {
			successes++
		}
	}
	assert.Equal(t, 1, successes)
	require.NoError(t, refreshGroupAliases())
	require.NoError(t, db.First(&user, user.Id).Error)
	assert.Equal(t, user.Group, common.GetGroupAliases()["premium"])
	assert.Equal(t, "vip", common.GroupIdentity(user.Group))

	// Restore the original name, an intermediate name, then introduce another
	// name after restoration. Every old request must retain the same identity.
	knownNames := []string{"vip", "pro", "premium", user.Group}
	currentName := user.Group
	for _, target := range []string{"vip", "pro", "vip", "diamond", "vip"} {
		historyBefore := common.GetGroupAliases()
		require.NoError(t, UpdateGroupSettingsAndReferences(
			map[string]string{"GroupRatio": fmt.Sprintf(`{"default":1,%q:2.5}`, target)},
			map[string]string{currentName: target},
		))
		if target != "diamond" {
			assert.Equal(t, historyBefore, common.GetGroupAliases(), "restoring a name preserves identity history")
		} else {
			knownNames = append(knownNames, target)
		}
		// Cold nodes rebuild the same identity from the persisted history.
		require.NoError(t, common.SetGroupAliases(nil))
		require.NoError(t, refreshGroupAliases())
		for _, name := range knownNames {
			assert.Equal(t, "vip", common.GroupIdentity(name))
			assert.Equal(t, []string{"rename-model"}, GetGroupEnabledModels(name))
			assert.Equal(t, 2.5, ratio_setting.GetGroupRatio(name))
		}
		selected, err := inFlight.Select(0, nil)
		require.NoError(t, err)
		require.NotNil(t, selected)
		assert.Equal(t, channel.Id, selected.Id)
		require.NoError(t, db.First(&user, user.Id).Error)
		require.NoError(t, db.First(&token, token.Id).Error)
		require.NoError(t, db.First(&channel, channel.Id).Error)
		require.NoError(t, db.First(&subscription, subscription.Id).Error)
		require.NoError(t, db.First(&pendingTask, pendingTask.ID).Error)
		assert.Equal(t, target, user.Group)
		assert.Equal(t, target, token.Group)
		assert.JSONEq(t, fmt.Sprintf(`["default",%q]`, target), token.AutoGroups)
		assert.JSONEq(t, fmt.Sprintf(`[{"group":%q,"priority":1,"cooldown_seconds":60}]`, target), token.GroupRouteConfig)
		assert.Equal(t, "default,"+target, channel.Group)
		assert.Equal(t, target, subscription.UpgradeGroup)
		assert.Equal(t, target, subscription.PrevUserGroup)
		assert.Equal(t, target, pendingTask.Group)
		// Ordinary edits to a restored group's pricing are still valid.
		require.NoError(t, UpdateOption("GroupRatio", fmt.Sprintf(`{"default":1,%q:2.5}`, target)))
		currentName = target
	}
	// A stale node or a generic option write must not let another group take
	// an existing group's alias, or split one identity into two active groups.
	require.NoError(t, common.SetGroupAliases(nil))
	assert.EqualError(t, UpdateGroupSettingsAndReferences(
		map[string]string{"GroupRatio": `{"vip":2.5,"pro":1}`}, map[string]string{"default": "pro"},
	), "Retired group names cannot be reused")
	assert.EqualError(t, UpdateOption("GroupRatio", `{"default":1,"vip":2.5,"diamond":1}`), "Retired group names cannot be reused")
	assert.EqualError(t, UpdateOption("GroupRatio", `{"default":1,"pro":2.5}`), "Retired group names cannot be reused")

	// A failed restoration leaves the current name and all live references intact.
	require.NoError(t, db.Model(&Token{}).Where("id = ?", token.Id).Update("auto_groups", "not-json").Error)
	require.Error(t, UpdateGroupSettingsAndReferences(
		map[string]string{"GroupRatio": `{"default":1,"pro":2.5}`}, map[string]string{"vip": "pro"},
	))
	require.NoError(t, db.First(&user, user.Id).Error)
	assert.Equal(t, "vip", user.Group)
	var option Option
	require.NoError(t, db.Where(&Option{Key: "GroupRatio"}).First(&option).Error)
	assert.JSONEq(t, `{"default":1,"vip":2.5}`, option.Value)
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
			preserveGroupRenameRuntime(t)
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
	assert.Empty(t, common.GetGroupAliases())
	var aliasCount int64
	require.NoError(t, db.Model(&Option{}).Where("key = ?", common.GroupAliasesOptionKey).Count(&aliasCount).Error)
	assert.Zero(t, aliasCount)
}

func TestGroupRenameAcceptsBothNamesWithStaleChannelCache(t *testing.T) {
	db := setupGroupRenameTestDatabase(t)
	common.MemoryCacheEnabled = true
	channelSyncLock.Lock()
	originalGroups, originalChannels := group2model2channels, channelsIDM
	// Channel and ability reads can straddle the commit: the new group may
	// already exist as an empty map while channels still use the old name.
	group2model2channels = map[string]map[string][]int{"vip": {"model": {42}}, "pro": {}}
	channelsIDM = map[int]*Channel{42: {Id: 42, Status: common.ChannelStatusEnabled}}
	channelSyncLock.Unlock()
	t.Cleanup(func() {
		channelSyncLock.Lock()
		group2model2channels, channelsIDM = originalGroups, originalChannels
		channelSyncLock.Unlock()
	})
	require.NoError(t, db.Create(&Option{Key: common.GroupAliasesOptionKey, Value: `{"vip":"pro"}`}).Error)
	for _, group := range []string{"pro", "vip"} {
		snapshot, err := LoadSatisfiedChannelSelectionSnapshot(group, "model", "")
		require.NoError(t, err)
		selected, err := snapshot.Select(0, nil)
		require.NoError(t, err)
		require.NotNil(t, selected)
		assert.Equal(t, 42, selected.Id)
	}
	channelSyncLock.Lock()
	group2model2channels = map[string]map[string][]int{"pro": {"model": {42}}}
	channelSyncLock.Unlock()
	require.NoError(t, common.SetGroupAliases(nil))
	snapshot, err := LoadSatisfiedChannelSelectionSnapshot("vip", "model", "")
	require.NoError(t, err)
	selected, err := snapshot.Select(0, nil)
	require.NoError(t, err)
	require.NotNil(t, selected)
	assert.Equal(t, 42, selected.Id)
}

func TestGroupRenameInvalidatesTokenCacheOnlyAfterCommit(t *testing.T) {
	db := setupGroupRenameTestDatabase(t)
	server := useUserCacheMiniRedis(t)
	require.NoError(t, db.Create(&Option{Key: "GroupRatio", Value: `{"vip":2}`}).Error)
	token := Token{UserId: 7, Key: "rename-cache-token", Name: "rename-cache", Group: "vip"}
	require.NoError(t, db.Create(&token).Error)
	require.NoError(t, cacheSetTokenForTest(token))
	observed := false
	require.NoError(t, db.Callback().Update().After("gorm:update").Register("test:rename_cache_before_commit", func(tx *gorm.DB) {
		if tx.Statement.Table == "tokens" {
			observed = true
			assert.True(t, server.Exists(getTokenCacheKey(token.Key)))
		}
	}))
	t.Cleanup(func() { _ = db.Callback().Update().Remove("test:rename_cache_before_commit") })
	require.NoError(t, UpdateGroupSettingsAndReferences(map[string]string{"GroupRatio": `{"pro":2}`}, map[string]string{"vip": "pro"}))
	assert.True(t, observed)
	assert.False(t, server.Exists(getTokenCacheKey(token.Key)))
	// A reader holding an old database snapshot cannot repopulate it afterward.
	initialized, err := cacheInitToken(token)
	require.NoError(t, err)
	assert.Zero(t, initialized)
}
