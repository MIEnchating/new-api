package model

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"github.com/bytedance/gopkg/util/gopool"
	"golang.org/x/sync/singleflight"
)

const userCacheSchemaVersion = 2

const userAuthStateLoadTimeout = 3 * time.Second
const userAuthStateGenerationRetention = time.Minute

var errStaleUserCache = errors.New("stale user cache schema")

type userAuthStateCacheEntry struct {
	user      UserBase
	expiresAt time.Time
}

type userAuthStateLoadResult struct {
	user       UserBase
	generation uint64
}

var userAuthStateCache = struct {
	sync.RWMutex
	entries             map[int]userAuthStateCacheEntry
	generations         map[int]uint64
	generationUpdatedAt map[int]time.Time
	lastCleanup         time.Time
}{
	entries:             make(map[int]userAuthStateCacheEntry),
	generations:         make(map[int]uint64),
	generationUpdatedAt: make(map[int]time.Time),
}

var userAuthStateLoadGroup singleflight.Group

type UserBase struct {
	Id           int    `json:"id"`
	Group        string `json:"group"`
	Email        string `json:"email"`
	Quota        int    `json:"quota"`
	Role         int    `json:"role"`
	Status       int    `json:"status"`
	Username     string `json:"username"`
	Setting      string `json:"setting"`
	CacheVersion int    `json:"-"`
}

func (user *UserBase) WriteContext(c *gin.Context) {
	common.SetContextKey(c, constant.ContextKeyUserGroup, user.Group)
	common.SetContextKey(c, constant.ContextKeyUserQuota, user.Quota)
	common.SetContextKey(c, constant.ContextKeyUserStatus, user.Status)
	common.SetContextKey(c, constant.ContextKeyUserEmail, user.Email)
	common.SetContextKey(c, constant.ContextKeyUserName, user.Username)
	common.SetContextKey(c, constant.ContextKeyUserSetting, user.GetSetting())
}

func (user *UserBase) GetSetting() dto.UserSetting {
	setting := dto.UserSetting{}
	if user.Setting != "" {
		err := common.Unmarshal([]byte(user.Setting), &setting)
		if err != nil {
			common.SysLog("failed to unmarshal setting: " + err.Error())
		}
	}
	return setting
}

// getUserCacheKey returns the key for user cache
func getUserCacheKey(userId int) string {
	return fmt.Sprintf("user:%d", userId)
}

// invalidateUserCache clears user cache
func invalidateUserCache(userId int) error {
	invalidateUserAuthStateCache(userId)
	notifyUserAuthStateChanged(userId)
	if !common.RedisEnabled {
		return nil
	}
	return common.RedisDelKey(getUserCacheKey(userId))
}

// InvalidateUserCache is the exported version of invalidateUserCache.
// 供 controller 等上层包在用户状态变更（如禁用、删除、角色变更）后主动清理缓存。
func InvalidateUserCache(userId int) error {
	return invalidateUserCache(userId)
}

func populateUserCache(user User) error {
	if !common.RedisEnabled {
		return nil
	}

	return common.RedisHSetObj(
		getUserCacheKey(user.Id),
		user.ToBaseUser(),
		time.Duration(common.RedisKeyCacheSeconds())*time.Second,
	)
}

// updateUserCache refreshes non-quota user cache fields.
// Quota is maintained by atomic quota delta paths and must not be overwritten
// by stale user snapshots from profile/settings updates.
func updateUserCache(user User) error {
	storeUserAuthStateCache(user.ToBaseUser())
	notifyUserAuthStateChanged(user.Id)
	if !common.RedisEnabled {
		return nil
	}
	if err := updateUserGroupCache(user.Id, user.Group); err != nil {
		return err
	}
	if err := updateUserEmailCache(user.Id, user.Email); err != nil {
		return err
	}
	if err := updateUserStatusCache(user.Id, user.Status == common.UserStatusEnabled); err != nil {
		return err
	}
	if err := updateUserRoleCache(user.Id, user.Role); err != nil {
		return err
	}
	if err := updateUserNameCache(user.Id, user.Username); err != nil {
		return err
	}
	return updateUserSettingCache(user.Id, user.Setting)
}

// GetUserCache gets complete user cache from hash
func GetUserCache(userId int) (userCache *UserBase, err error) {
	return getUserCache(userId, cacheGetUserBase)
}

// GetUserAuthState returns the identity fields used for session authorization.
// A short-lived, process-local cache avoids querying the primary database for
// every browser API request. Application-side user mutations synchronously
// invalidate or replace this cache and notify other instances through Redis,
// while the generation check prevents an in-flight database read from
// restoring stale authorization data.
func GetUserAuthState(userId int) (*UserBase, error) {
	return GetUserAuthStateWithContext(context.Background(), userId)
}

func GetUserAuthStateWithContext(ctx context.Context, userId int) (*UserBase, error) {
	if userId <= 0 {
		return nil, gorm.ErrRecordNotFound
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if common.UserAuthCacheTTLSeconds <= 0 {
		return loadUserAuthStateFromDatabase(ctx, userId)
	}
	key := fmt.Sprint(userId)
	for {
		if user := loadUserAuthStateCache(userId); user != nil {
			return user, nil
		}

		resultChannel := userAuthStateLoadGroup.DoChan(key, func() (interface{}, error) {
			if user, generation := loadVersionedUserAuthStateCache(userId); user != nil {
				return &userAuthStateLoadResult{user: *user, generation: generation}, nil
			}

			generation := userAuthStateGeneration(userId)
			loadContext, cancel := context.WithTimeout(context.Background(), userAuthStateLoadTimeout)
			defer cancel()
			var user User
			if err := DB.WithContext(loadContext).
				Select("id", "username", "role", "status", "group").
				First(&user, "id = ?", userId).Error; err != nil {
				return nil, err
			}
			userBase := UserBase{
				Id:           user.Id,
				Username:     user.Username,
				Role:         user.Role,
				Status:       user.Status,
				Group:        user.Group,
				CacheVersion: userCacheSchemaVersion,
			}
			storeLoadedUserAuthStateCache(&userBase, generation)
			return &userAuthStateLoadResult{user: userBase, generation: generation}, nil
		})

		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case result := <-resultChannel:
			if result.Err != nil {
				return nil, result.Err
			}
			loaded, _ := result.Val.(*userAuthStateLoadResult)
			if loaded == nil {
				return nil, gorm.ErrRecordNotFound
			}
			if userAuthStateGeneration(userId) != loaded.generation {
				userAuthStateLoadGroup.Forget(key)
				continue
			}
			copy := loaded.user
			return &copy, nil
		}
	}
}

func loadUserAuthStateFromDatabase(ctx context.Context, userId int) (*UserBase, error) {
	loadContext, cancel := context.WithTimeout(ctx, userAuthStateLoadTimeout)
	defer cancel()
	var user User
	if err := DB.WithContext(loadContext).
		Select("id", "username", "role", "status", "group").
		First(&user, "id = ?", userId).Error; err != nil {
		return nil, err
	}
	return &UserBase{
		Id:           user.Id,
		Username:     user.Username,
		Role:         user.Role,
		Status:       user.Status,
		Group:        user.Group,
		CacheVersion: userCacheSchemaVersion,
	}, nil
}

func loadUserAuthStateCache(userId int) *UserBase {
	user, _ := loadVersionedUserAuthStateCache(userId)
	return user
}

func loadVersionedUserAuthStateCache(userId int) (*UserBase, uint64) {
	if common.UserAuthCacheTTLSeconds <= 0 {
		return nil, 0
	}

	userAuthStateCache.RLock()
	entry, ok := userAuthStateCache.entries[userId]
	generation := userAuthStateCache.generations[userId]
	userAuthStateCache.RUnlock()
	if !ok {
		return nil, generation
	}
	if !time.Now().Before(entry.expiresAt) {
		userAuthStateCache.Lock()
		if current, exists := userAuthStateCache.entries[userId]; exists && current.expiresAt.Equal(entry.expiresAt) {
			delete(userAuthStateCache.entries, userId)
		}
		userAuthStateCache.Unlock()
		return nil, generation
	}
	copy := entry.user
	return &copy, generation
}

func userAuthStateGeneration(userId int) uint64 {
	userAuthStateCache.RLock()
	generation := userAuthStateCache.generations[userId]
	userAuthStateCache.RUnlock()
	return generation
}

func storeLoadedUserAuthStateCache(user *UserBase, generation uint64) {
	if user == nil || common.UserAuthCacheTTLSeconds <= 0 {
		return
	}
	copy := *user
	now := time.Now()
	userAuthStateCache.Lock()
	defer userAuthStateCache.Unlock()
	pruneExpiredUserAuthStateCacheLocked(now)
	if userAuthStateCache.generations[user.Id] != generation {
		return
	}
	userAuthStateCache.entries[user.Id] = userAuthStateCacheEntry{
		user:      copy,
		expiresAt: now.Add(time.Duration(common.UserAuthCacheTTLSeconds) * time.Second),
	}
}

func storeUserAuthStateCache(user *UserBase) {
	if user == nil || user.Id <= 0 || common.UserAuthCacheTTLSeconds <= 0 {
		return
	}
	copy := *user
	now := time.Now()
	userAuthStateCache.Lock()
	defer userAuthStateCache.Unlock()
	pruneExpiredUserAuthStateCacheLocked(now)
	userAuthStateCache.generations[user.Id]++
	userAuthStateCache.generationUpdatedAt[user.Id] = now
	userAuthStateLoadGroup.Forget(fmt.Sprint(user.Id))
	userAuthStateCache.entries[user.Id] = userAuthStateCacheEntry{
		user:      copy,
		expiresAt: now.Add(time.Duration(common.UserAuthCacheTTLSeconds) * time.Second),
	}
}

func pruneExpiredUserAuthStateCacheLocked(now time.Time) {
	if !userAuthStateCache.lastCleanup.IsZero() && now.Sub(userAuthStateCache.lastCleanup) < time.Minute {
		return
	}
	for userId, entry := range userAuthStateCache.entries {
		if !now.Before(entry.expiresAt) {
			delete(userAuthStateCache.entries, userId)
		}
	}
	for userId, updatedAt := range userAuthStateCache.generationUpdatedAt {
		if now.Sub(updatedAt) >= userAuthStateGenerationRetention {
			delete(userAuthStateCache.generations, userId)
			delete(userAuthStateCache.generationUpdatedAt, userId)
		}
	}
	userAuthStateCache.lastCleanup = now
}

func invalidateUserAuthStateCache(userId int) {
	if userId <= 0 || common.UserAuthCacheTTLSeconds <= 0 {
		return
	}
	now := time.Now()
	userAuthStateCache.Lock()
	pruneExpiredUserAuthStateCacheLocked(now)
	userAuthStateCache.generations[userId]++
	userAuthStateCache.generationUpdatedAt[userId] = now
	delete(userAuthStateCache.entries, userId)
	userAuthStateCache.Unlock()
	userAuthStateLoadGroup.Forget(fmt.Sprint(userId))
}

func getUserCache(userId int, loadCache func(int) (*UserBase, error)) (userCache *UserBase, err error) {
	var user *User
	var fromDB bool
	defer func() {
		// Update Redis cache asynchronously on successful DB read
		if shouldUpdateRedis(fromDB, err) && user != nil {
			gopool.Go(func() {
				if err := populateUserCache(*user); err != nil {
					common.SysLog("failed to update user status cache: " + err.Error())
				}
			})
		}
	}()

	// Try getting from Redis first
	userCache, err = loadCache(userId)
	if err == nil && isCurrentUserCache(userCache, userId) {
		return userCache, nil
	}
	if err == nil {
		err = errStaleUserCache
	}

	// If Redis fails, get from DB
	fromDB = true
	user, err = GetUserById(userId, false)
	if err != nil {
		return nil, err // Return nil and error if DB lookup fails
	}

	// Create cache object from user data
	userCache = user.ToBaseUser()

	return userCache, nil
}

func isCurrentUserCache(user *UserBase, userId int) bool {
	if user == nil || user.CacheVersion != userCacheSchemaVersion || user.Id != userId {
		return false
	}
	if strings.TrimSpace(user.Username) == "" || !common.IsValidateRole(user.Role) {
		return false
	}
	return user.Status == common.UserStatusEnabled || user.Status == common.UserStatusDisabled
}

func cacheGetUserBase(userId int) (*UserBase, error) {
	if !common.RedisEnabled {
		return nil, fmt.Errorf("redis is not enabled")
	}
	var userCache UserBase
	// Try getting from Redis first
	err := common.RedisHGetObj(getUserCacheKey(userId), &userCache)
	if err != nil {
		return nil, err
	}
	return &userCache, nil
}

// Add atomic quota operations using hash fields
func cacheIncrUserQuota(userId int, delta int64) error {
	if !common.RedisEnabled {
		return nil
	}
	return common.RedisHIncrBy(getUserCacheKey(userId), "Quota", delta)
}

func cacheDecrUserQuota(userId int, delta int64) error {
	return cacheIncrUserQuota(userId, -delta)
}

// Helper functions to get individual fields if needed
func getUserGroupCache(userId int) (string, error) {
	cache, err := GetUserCache(userId)
	if err != nil {
		return "", err
	}
	return cache.Group, nil
}

func getUserQuotaCache(userId int) (int, error) {
	cache, err := GetUserCache(userId)
	if err != nil {
		return 0, err
	}
	return cache.Quota, nil
}

func getUserStatusCache(userId int) (int, error) {
	cache, err := GetUserCache(userId)
	if err != nil {
		return 0, err
	}
	return cache.Status, nil
}

func getUserNameCache(userId int) (string, error) {
	cache, err := GetUserCache(userId)
	if err != nil {
		return "", err
	}
	return cache.Username, nil
}

func getUserSettingCache(userId int) (dto.UserSetting, error) {
	cache, err := GetUserCache(userId)
	if err != nil {
		return dto.UserSetting{}, err
	}
	return cache.GetSetting(), nil
}

// New functions for individual field updates
func updateUserStatusCache(userId int, status bool) error {
	if !common.RedisEnabled {
		return nil
	}
	statusInt := common.UserStatusEnabled
	if !status {
		statusInt = common.UserStatusDisabled
	}
	return common.RedisHSetField(getUserCacheKey(userId), "Status", fmt.Sprintf("%d", statusInt))
}

func updateUserRoleCache(userId int, role int) error {
	if !common.RedisEnabled {
		return nil
	}
	return common.RedisHSetField(getUserCacheKey(userId), "Role", fmt.Sprintf("%d", role))
}

func updateUserQuotaCache(userId int, quota int) error {
	if !common.RedisEnabled {
		return nil
	}
	return common.RedisHSetField(getUserCacheKey(userId), "Quota", fmt.Sprintf("%d", quota))
}

func updateUserGroupCache(userId int, group string) error {
	if !common.RedisEnabled {
		return nil
	}
	return common.RedisHSetField(getUserCacheKey(userId), "Group", group)
}

func UpdateUserGroupCache(userId int, group string) error {
	invalidateUserAuthStateCache(userId)
	notifyUserAuthStateChanged(userId)
	return updateUserGroupCache(userId, group)
}

func updateUserEmailCache(userId int, email string) error {
	if !common.RedisEnabled {
		return nil
	}
	return common.RedisHSetField(getUserCacheKey(userId), "Email", email)
}

func updateUserNameCache(userId int, username string) error {
	if !common.RedisEnabled {
		return nil
	}
	return common.RedisHSetField(getUserCacheKey(userId), "Username", username)
}

func updateUserSettingCache(userId int, setting string) error {
	if !common.RedisEnabled {
		return nil
	}
	return common.RedisHSetField(getUserCacheKey(userId), "Setting", setting)
}

// GetUserLanguage returns the user's language preference from cache
// Uses the existing GetUserCache mechanism for efficiency
func GetUserLanguage(userId int) string {
	userCache, err := GetUserCache(userId)
	if err != nil {
		return ""
	}
	return userCache.GetSetting().Language
}
