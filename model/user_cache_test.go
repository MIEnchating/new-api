package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGetUserCacheFallsBackForLegacyHashWithoutRole(t *testing.T) {
	truncateTables(t)
	user := User{
		Id:       7201,
		Username: "cache-role-user",
		Role:     common.RoleAdminUser,
		Status:   common.UserStatusEnabled,
		Group:    "default",
	}
	require.NoError(t, DB.Create(&user).Error)

	legacyCache := &UserBase{
		Id:       user.Id,
		Username: user.Username,
		Status:   user.Status,
		Group:    user.Group,
		// Legacy hashes have neither Role nor CacheVersion.
	}
	got, err := getUserCache(user.Id, func(int) (*UserBase, error) {
		return legacyCache, nil
	})

	require.NoError(t, err)
	assert.Equal(t, common.RoleAdminUser, got.Role)
	assert.Equal(t, userCacheSchemaVersion, got.CacheVersion)
	assert.NotSame(t, legacyCache, got)
}
