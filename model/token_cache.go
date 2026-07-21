package model

import (
	"context"
	"errors"
	"fmt"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/go-redis/redis/v8"
)

const tokenCacheSchemaVersion = 2

func tokenCacheKey(key string) string {
	return fmt.Sprintf("token:%s", common.GenerateHMAC(key))
}

func tokenCacheGenerationKey(key string) string {
	return fmt.Sprintf("token:version:%s", common.GenerateHMAC(key))
}

func tokenCacheTTLSeconds() int {
	ttl := common.RedisKeyCacheSeconds()
	if ttl <= 0 {
		return 60
	}
	return ttl
}

func tokenCacheGenerationTTLSeconds() int {
	ttl := tokenCacheTTLSeconds() * 2
	if ttl < 120 {
		return 120
	}
	return ttl
}

func cacheGetTokenGeneration(key string) (int64, error) {
	value, err := common.RDB.Get(context.Background(), tokenCacheGenerationKey(key)).Result()
	if errors.Is(err, redis.Nil) {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	return strconv.ParseInt(value, 10, 64)
}

func cacheSetTokenAtGeneration(token Token, generation int64) error {
	allowIps := ""
	if token.AllowIps != nil {
		allowIps = *token.AllowIps
	}
	const script = `
local current = tonumber(redis.call('GET', KEYS[2]) or '0')
local incoming = tonumber(ARGV[1])
if current ~= incoming then
  return 0
end
redis.call('HSET', KEYS[1],
  'Id', ARGV[2], 'UserId', ARGV[3], 'Status', ARGV[4],
  'Name', ARGV[5], 'CreatedTime', ARGV[6], 'AccessedTime', ARGV[7],
  'ExpiredTime', ARGV[8], 'RemainQuota', ARGV[9],
  'UnlimitedQuota', ARGV[10], 'ModelLimitsEnabled', ARGV[11],
  'ModelLimits', ARGV[12], 'AllowIps', ARGV[13], 'UsedQuota', ARGV[14],
  'Group', ARGV[15], 'CrossGroupRetry', ARGV[16],
  'GroupRouteConfig', ARGV[17], 'GroupRouteSticky', ARGV[18],
  'CacheSchema', ARGV[19])
redis.call('EXPIRE', KEYS[1], ARGV[20])
return 1`
	return common.RDB.Eval(
		context.Background(),
		script,
		[]string{tokenCacheKey(token.Key), tokenCacheGenerationKey(token.Key)},
		generation,
		token.Id,
		token.UserId,
		token.Status,
		token.Name,
		token.CreatedTime,
		token.AccessedTime,
		token.ExpiredTime,
		token.RemainQuota,
		strconv.FormatBool(token.UnlimitedQuota),
		strconv.FormatBool(token.ModelLimitsEnabled),
		token.ModelLimits,
		allowIps,
		token.UsedQuota,
		token.Group,
		strconv.FormatBool(token.CrossGroupRetry),
		token.GroupRouteConfig,
		strconv.FormatBool(token.GroupRouteSticky),
		tokenCacheSchemaVersion,
		tokenCacheTTLSeconds(),
	).Err()
}

func cacheDeleteToken(key string) error {
	const script = `
local current = tonumber(redis.call('GET', KEYS[2])) or 0
redis.call('SET', KEYS[2], current + 1, 'EX', ARGV[1])
redis.call('DEL', KEYS[1])
return 1`
	return common.RDB.Eval(
		context.Background(),
		script,
		[]string{tokenCacheKey(key), tokenCacheGenerationKey(key)},
		tokenCacheGenerationTTLSeconds(),
	).Err()
}

func cacheIncrTokenQuota(key string, increment int64) error {
	const script = `
if redis.call('EXISTS', KEYS[1]) == 0 then
  return 0
end
redis.call('HINCRBY', KEYS[1], ARGV[1], ARGV[2])
return 1`
	return common.RDB.Eval(
		context.Background(),
		script,
		[]string{tokenCacheKey(key)},
		constant.TokenFiledRemainQuota,
		increment,
	).Err()
}

func cacheDecrTokenQuota(key string, decrement int64) error {
	return cacheIncrTokenQuota(key, -decrement)
}

func cacheSetTokenField(key string, field string, value string) error {
	err := common.RedisHSetField(tokenCacheKey(key), field, value)
	if err != nil {
		return err
	}
	return nil
}

// CacheGetTokenByKey 从缓存中获取 token，如果缓存中不存在，则从数据库中获取
func cacheGetTokenByKey(key string) (*Token, error) {
	if !common.RedisEnabled {
		return nil, fmt.Errorf("redis is not enabled")
	}
	var token Token
	err := common.RedisHGetObj(tokenCacheKey(key), &token)
	if err != nil {
		return nil, err
	}
	if token.Id <= 0 || token.CacheSchema != tokenCacheSchemaVersion {
		return nil, fmt.Errorf("token cache schema is stale")
	}
	token.Key = key
	return &token, nil
}
