package model

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestGetUserGroupNamesReturnsDistinctAssignedGroups(t *testing.T) {
	setupUserUpdateTestState(t)

	users := []User{
		{Username: "default-user", Password: "password", Group: "default", AffCode: "group-test-1"},
		{Username: "vip-user", Password: "password", Group: "vip", AffCode: "group-test-2"},
		{Username: "second-vip-user", Password: "password", Group: "vip", AffCode: "group-test-3"},
		{Username: "empty-group-user", Password: "password", Group: "", AffCode: "group-test-4"},
		{
			Username:  "deleted-group-user",
			Password:  "password",
			Group:     "archived",
			AffCode:   "group-test-5",
			DeletedAt: gorm.DeletedAt{Time: time.Now(), Valid: true},
		},
	}
	require.NoError(t, DB.Create(&users).Error)
	require.NoError(t, DB.Model(&User{}).
		Where("username = ?", "empty-group-user").
		Update("group", "").Error)

	groups, err := GetUserGroupNames()

	require.NoError(t, err)
	assert.Equal(t, []string{"archived", "default", "vip"}, groups)
}
