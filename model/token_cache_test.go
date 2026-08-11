package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/alicebob/miniredis/v2"
	"github.com/glebarez/sqlite"
	"github.com/go-redis/redis/v8"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func useTokenCacheTestDatabase(t *testing.T) *miniredis.Miniredis {
	t.Helper()
	server := miniredis.RunT(t)
	previousDB := DB
	previousType := common.MainDatabaseType()
	previousRedisEnabled := common.RedisEnabled
	previousRDB := common.RDB
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&Token{}))
	DB = db
	common.SetMainDatabaseType(common.DatabaseTypeSQLite)
	common.RedisEnabled = true
	common.RDB = redis.NewClient(&redis.Options{Addr: server.Addr()})
	t.Cleanup(func() {
		DB = previousDB
		common.SetMainDatabaseType(previousType)
		common.RedisEnabled = previousRedisEnabled
		common.RDB = previousRDB
	})
	return server
}

func TestGetTokenByKeyRejectsLegacyCacheWithoutRoutingFields(t *testing.T) {
	useTokenCacheTestDatabase(t)
	token := Token{
		UserId: 1, Key: "fixed-group-key", Name: "pro",
		Status: common.TokenStatusEnabled, ExpiredTime: -1,
		UnlimitedQuota: true, Group: "codex-pro",
	}
	require.NoError(t, DB.Create(&token).Error)
	legacy := token
	legacy.Group = ""
	legacy.CacheSchema = 0
	require.NoError(t, common.RedisHSetObj(getTokenCacheKey(token.Key), &legacy, 0))

	loaded, err := GetTokenByKey(token.Key, false)

	require.NoError(t, err)
	assert.Equal(t, "codex-pro", loaded.Group)
	cached, err := cacheGetTokenByKey(token.Key)
	require.NoError(t, err)
	assert.Equal(t, "codex-pro", cached.Group)
}

func TestTokenQuotaDeltaDoesNotCreatePartialCache(t *testing.T) {
	server := useTokenCacheTestDatabase(t)

	result, err := cacheApplyTokenQuotaDelta(1, "missing-token", 10)
	require.NoError(t, err)
	assert.Equal(t, cacheQuotaMiss, result)

	assert.False(t, server.Exists(getTokenCacheKey("missing-token")))
}
