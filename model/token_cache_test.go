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
	require.NoError(t, common.RedisHSetObj(tokenCacheKey(token.Key), &legacy, 0))

	loaded, err := GetTokenByKey(token.Key, false)

	require.NoError(t, err)
	assert.Equal(t, "codex-pro", loaded.Group)
	cached, err := cacheGetTokenByKey(token.Key)
	require.NoError(t, err)
	assert.Equal(t, "codex-pro", cached.Group)
}

func TestTokenCacheGenerationRejectsDelayedStaleFill(t *testing.T) {
	server := useTokenCacheTestDatabase(t)
	stale := Token{
		Id: 1, UserId: 1, Key: "generation-key", Name: "pro",
		Status: common.TokenStatusEnabled, ExpiredTime: -1,
		UnlimitedQuota: true, Group: "vue源码分组",
	}
	generation, err := cacheGetTokenGeneration(stale.Key)
	require.NoError(t, err)
	require.NoError(t, cacheDeleteToken(stale.Key))

	require.NoError(t, cacheSetTokenAtGeneration(stale, generation))
	assert.False(t, server.Exists(tokenCacheKey(stale.Key)))

	currentGeneration, err := cacheGetTokenGeneration(stale.Key)
	require.NoError(t, err)
	fresh := stale
	fresh.Group = "codex-pro"
	require.NoError(t, cacheSetTokenAtGeneration(fresh, currentGeneration))
	cached, err := cacheGetTokenByKey(stale.Key)
	require.NoError(t, err)
	assert.Equal(t, "codex-pro", cached.Group)
}

func TestTokenQuotaDeltaDoesNotCreatePartialCache(t *testing.T) {
	server := useTokenCacheTestDatabase(t)

	require.NoError(t, cacheIncrTokenQuota("missing-token", 10))

	assert.False(t, server.Exists(tokenCacheKey("missing-token")))
}
