package model

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/glebarez/sqlite"
	"github.com/go-redis/redis/v8"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupUserAuthCacheTestDatabase(t *testing.T) *gorm.DB {
	t.Helper()
	previousDB := DB
	previousRedisEnabled := common.RedisEnabled
	previousTTL := common.UserAuthCacheTTLSeconds
	dsn := fmt.Sprintf("file:%s?mode=memory&cache=shared", strings.ReplaceAll(t.Name(), "/", "_"))
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&User{}))
	DB = db
	common.RedisEnabled = false
	common.UserAuthCacheTTLSeconds = 3
	t.Cleanup(func() {
		DB = previousDB
		common.RedisEnabled = previousRedisEnabled
		common.UserAuthCacheTTLSeconds = previousTTL
		if sqlDB, dbErr := db.DB(); dbErr == nil {
			_ = sqlDB.Close()
		}
	})
	return db
}

func TestUserAuthStateCacheRefreshesImmediatelyAfterUserUpdate(t *testing.T) {
	setupUserAuthCacheTestDatabase(t)
	user := User{
		Id:       8801,
		Username: "auth-cache-user",
		Role:     common.RoleAdminUser,
		Status:   common.UserStatusEnabled,
		Group:    "default",
	}
	require.NoError(t, DB.Create(&user).Error)
	invalidateUserAuthStateCache(user.Id)

	initial, err := GetUserAuthState(user.Id)
	require.NoError(t, err)
	assert.Equal(t, common.RoleAdminUser, initial.Role)
	assert.Equal(t, common.UserStatusEnabled, initial.Status)

	user.Role = common.RoleCommonUser
	user.Status = common.UserStatusDisabled
	user.Group = "restricted"
	require.NoError(t, user.Update(false))

	current, err := GetUserAuthState(user.Id)
	require.NoError(t, err)
	assert.Equal(t, common.RoleCommonUser, current.Role)
	assert.Equal(t, common.UserStatusDisabled, current.Status)
	assert.Equal(t, "restricted", current.Group)
}

func TestUserAuthStateCacheAvoidsRepeatedDatabaseQueries(t *testing.T) {
	db := setupUserAuthCacheTestDatabase(t)
	user := User{
		Id:       8804,
		Username: "auth-query-count-user",
		Role:     common.RoleCommonUser,
		Status:   common.UserStatusEnabled,
		Group:    "default",
	}
	require.NoError(t, DB.Create(&user).Error)
	invalidateUserAuthStateCache(user.Id)

	var queryCount atomic.Int32
	require.NoError(t, db.Callback().Query().Before("gorm:query").Register("test:count_user_auth_query", func(tx *gorm.DB) {
		if tx.Statement != nil && tx.Statement.Table == "users" {
			queryCount.Add(1)
		}
	}))

	_, err := GetUserAuthState(user.Id)
	require.NoError(t, err)
	_, err = GetUserAuthState(user.Id)
	require.NoError(t, err)
	assert.Equal(t, int32(1), queryCount.Load())
}

func TestUserAuthStateCacheTTLZeroQueriesDatabaseForEveryRequest(t *testing.T) {
	db := setupUserAuthCacheTestDatabase(t)
	common.UserAuthCacheTTLSeconds = 0
	user := User{
		Id:       8806,
		Username: "auth-cache-disabled-user",
		Role:     common.RoleCommonUser,
		Status:   common.UserStatusEnabled,
		Group:    "default",
	}
	require.NoError(t, DB.Create(&user).Error)

	var queryCount atomic.Int32
	require.NoError(t, db.Callback().Query().Before("gorm:query").Register("test:count_disabled_user_auth_cache_query", func(tx *gorm.DB) {
		if tx.Statement != nil && tx.Statement.Table == "users" {
			queryCount.Add(1)
		}
	}))

	_, err := GetUserAuthState(user.Id)
	require.NoError(t, err)
	_, err = GetUserAuthState(user.Id)
	require.NoError(t, err)
	assert.Equal(t, int32(2), queryCount.Load())
}

func TestUserAuthStateSingleflightSurvivesFirstCallerCancellation(t *testing.T) {
	db := setupUserAuthCacheTestDatabase(t)
	user := User{
		Id:       8802,
		Username: "auth-singleflight-user",
		Role:     common.RoleCommonUser,
		Status:   common.UserStatusEnabled,
		Group:    "default",
	}
	require.NoError(t, DB.Create(&user).Error)
	invalidateUserAuthStateCache(user.Id)

	var queryCount atomic.Int32
	queryStarted := make(chan struct{})
	releaseQuery := make(chan struct{})
	var startOnce sync.Once
	require.NoError(t, db.Callback().Query().Before("gorm:query").Register("test:block_user_auth_query", func(tx *gorm.DB) {
		if tx.Statement == nil || tx.Statement.Table != "users" {
			return
		}
		queryCount.Add(1)
		startOnce.Do(func() { close(queryStarted) })
		select {
		case <-releaseQuery:
		case <-tx.Statement.Context.Done():
		}
	}))

	firstContext, cancelFirst := context.WithCancel(context.Background())
	firstResult := make(chan error, 1)
	go func() {
		_, err := GetUserAuthStateWithContext(firstContext, user.Id)
		firstResult <- err
	}()

	select {
	case <-queryStarted:
	case <-time.After(time.Second):
		t.Fatal("user auth database query did not start")
	}

	secondResult := make(chan error, 1)
	go func() {
		_, err := GetUserAuthStateWithContext(context.Background(), user.Id)
		secondResult <- err
	}()

	cancelFirst()
	require.ErrorIs(t, <-firstResult, context.Canceled)
	close(releaseQuery)
	require.NoError(t, <-secondResult)
	assert.Equal(t, int32(1), queryCount.Load())
}

func TestUserAuthStateInvalidationDoesNotReturnInFlightStaleResult(t *testing.T) {
	db := setupUserAuthCacheTestDatabase(t)
	user := User{
		Id:       8805,
		Username: "auth-invalidation-race-user",
		Role:     common.RoleAdminUser,
		Status:   common.UserStatusEnabled,
		Group:    "default",
	}
	require.NoError(t, DB.Create(&user).Error)
	invalidateUserAuthStateCache(user.Id)

	firstQueryRead := make(chan struct{})
	releaseFirstQuery := make(chan struct{})
	var queryCount atomic.Int32
	require.NoError(t, db.Callback().Query().After("gorm:after_query").Register("test:block_first_user_auth_result", func(tx *gorm.DB) {
		if tx.Statement == nil || tx.Statement.Table != "users" {
			return
		}
		if queryCount.Add(1) == 1 {
			close(firstQueryRead)
			<-releaseFirstQuery
		}
	}))

	firstResult := make(chan *UserBase, 1)
	firstError := make(chan error, 1)
	go func() {
		loaded, err := GetUserAuthState(user.Id)
		firstResult <- loaded
		firstError <- err
	}()

	select {
	case <-firstQueryRead:
	case <-time.After(time.Second):
		t.Fatal("first user auth query did not reach the result barrier")
	}

	require.NoError(t, DB.Model(&User{}).Where("id = ?", user.Id).Updates(map[string]interface{}{
		"role":   common.RoleCommonUser,
		"status": common.UserStatusDisabled,
		"group":  "restricted",
	}).Error)
	invalidateUserAuthStateCache(user.Id)

	secondResult := make(chan *UserBase, 1)
	secondError := make(chan error, 1)
	go func() {
		loaded, err := GetUserAuthState(user.Id)
		secondResult <- loaded
		secondError <- err
	}()

	var current *UserBase
	select {
	case current = <-secondResult:
	case <-time.After(time.Second):
		t.Fatal("request after invalidation waited for the stale singleflight query")
	}
	require.NoError(t, <-secondError)
	require.NotNil(t, current)
	assert.Equal(t, common.RoleCommonUser, current.Role)
	assert.Equal(t, common.UserStatusDisabled, current.Status)
	assert.Equal(t, "restricted", current.Group)

	close(releaseFirstQuery)
	staleCallerResult := <-firstResult
	require.NoError(t, <-firstError)
	require.NotNil(t, staleCallerResult)
	assert.Equal(t, common.RoleCommonUser, staleCallerResult.Role)
	assert.Equal(t, common.UserStatusDisabled, staleCallerResult.Status)
	assert.Equal(t, "restricted", staleCallerResult.Group)
	assert.GreaterOrEqual(t, queryCount.Load(), int32(2))
}

func TestUserAuthStateInvalidationMessageOnlyInvalidatesOtherInstances(t *testing.T) {
	setupUserAuthCacheTestDatabase(t)
	user := &UserBase{
		Id:           8803,
		Username:     "auth-pubsub-user",
		Role:         common.RoleCommonUser,
		Status:       common.UserStatusEnabled,
		Group:        "default",
		CacheVersion: userCacheSchemaVersion,
	}
	storeUserAuthStateCache(user)
	require.NotNil(t, loadUserAuthStateCache(user.Id))

	handleUserAuthStateInvalidation(userAuthStateCacheInstanceID + ":" + fmt.Sprint(user.Id))
	require.NotNil(t, loadUserAuthStateCache(user.Id))

	handleUserAuthStateInvalidation("another-instance:" + fmt.Sprint(user.Id))
	assert.Nil(t, loadUserAuthStateCache(user.Id))
}

func TestUserAuthStateCacheSyncStartsOnceAndStops(t *testing.T) {
	StopUserAuthStateCacheSync()
	previousRDB := common.RDB
	previousRedisEnabled := common.RedisEnabled
	previousTTL := common.UserAuthCacheTTLSeconds
	client := redis.NewClient(&redis.Options{Addr: "127.0.0.1:1"})
	common.RDB = client
	common.RedisEnabled = true
	common.UserAuthCacheTTLSeconds = 3
	t.Cleanup(func() {
		StopUserAuthStateCacheSync()
		_ = client.Close()
		common.RDB = previousRDB
		common.RedisEnabled = previousRedisEnabled
		common.UserAuthCacheTTLSeconds = previousTTL
	})

	StartUserAuthStateCacheSync()
	userAuthStateCacheSync.Lock()
	firstCancel := userAuthStateCacheSync.cancel
	firstDone := userAuthStateCacheSync.done
	userAuthStateCacheSync.Unlock()
	require.NotNil(t, firstCancel)
	require.NotNil(t, firstDone)

	StartUserAuthStateCacheSync()
	userAuthStateCacheSync.Lock()
	secondDone := userAuthStateCacheSync.done
	userAuthStateCacheSync.Unlock()
	assert.Equal(t, firstDone, secondDone)

	stopped := make(chan struct{})
	go func() {
		StopUserAuthStateCacheSync()
		close(stopped)
	}()
	select {
	case <-stopped:
	case <-time.After(time.Second):
		t.Fatal("user auth cache sync did not stop after cancellation")
	}
}
