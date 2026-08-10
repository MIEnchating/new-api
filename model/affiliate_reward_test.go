package model

import (
	"fmt"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestAffiliateRewardLedgerIsIdempotentAndMasksInvitee(t *testing.T) {
	truncateTables(t)
	require.NoError(t, DB.Create(&User{Id: 21, Username: "inviter", AffCode: "inviter_aff", Status: common.UserStatusEnabled}).Error)
	require.NoError(t, DB.Create(&User{Id: 142, Username: "invitee", AffCode: "invitee_aff", Status: common.UserStatusEnabled}).Error)

	reward := &AffiliateReward{EventKey: "registration:142", InviterId: 21, InviteeId: 142, Type: AffiliateRewardTypeRegistration, Quota: 100, SourceId: 142}
	created, err := createAffiliateRewardIfAbsent(DB, reward)
	require.NoError(t, err)
	assert.True(t, created)

	duplicate, err := createAffiliateRewardIfAbsent(DB, &AffiliateReward{EventKey: "registration:142", InviterId: 21, InviteeId: 142, Type: AffiliateRewardTypeRegistration, Quota: 100, SourceId: 142})
	require.NoError(t, err)
	assert.False(t, duplicate)

	items, total, err := GetAffiliateRewards(21, &common.PageInfo{Page: 1, PageSize: 10})
	require.NoError(t, err)
	assert.EqualValues(t, 1, total)
	require.Len(t, items, 1)
	assert.Equal(t, "****42", items[0].InviteeDisplay)
	assert.NotContains(t, items[0].InviteeDisplay, "invitee")
	payload, err := common.Marshal(items[0])
	require.NoError(t, err)
	assert.NotContains(t, string(payload), "invitee_id")
	assert.NotContains(t, string(payload), "event_key")
	assert.NotContains(t, string(payload), "source_id")

	otherItems, otherTotal, err := GetAffiliateRewards(142, &common.PageInfo{Page: 1, PageSize: 10})
	require.NoError(t, err)
	assert.Empty(t, otherItems)
	assert.Zero(t, otherTotal)
}

func TestAffiliateRewardPagination(t *testing.T) {
	truncateTables(t)
	for i := 1; i <= 4; i++ {
		require.NoError(t, DB.Create(&AffiliateReward{EventKey: fmt.Sprintf("registration:%d", i), InviterId: 7, InviteeId: i, Type: AffiliateRewardTypeRegistration, Quota: i, SourceId: int64(i), CreatedAt: int64(i)}).Error)
	}
	items, total, err := GetAffiliateRewards(7, &common.PageInfo{Page: 2, PageSize: 2})
	require.NoError(t, err)
	assert.EqualValues(t, 4, total)
	assert.Len(t, items, 2)
}

func TestAllAffiliateRewardsFiltersInviterInviteeAndType(t *testing.T) {
	truncateTables(t)
	users := []User{
		{Id: 11, Username: "alice-inviter", DisplayName: "Alice", AffCode: "alice_aff", Status: common.UserStatusEnabled},
		{Id: 12, Username: "bob-inviter", DisplayName: "Bob", AffCode: "bob_aff", Status: common.UserStatusEnabled},
		{Id: 21, Username: "carol-invitee", DisplayName: "Carol", AffCode: "carol_aff", Status: common.UserStatusEnabled},
		{Id: 22, Username: "dave-invitee", DisplayName: "Dave", AffCode: "dave_aff", Status: common.UserStatusEnabled},
	}
	require.NoError(t, DB.Create(&users).Error)
	rewards := []AffiliateReward{
		{EventKey: "registration:21", InviterId: 11, InviteeId: 21, Type: AffiliateRewardTypeRegistration, Quota: 100, CreatedAt: 10},
		{EventKey: "first_topup:22", InviterId: 12, InviteeId: 22, Type: AffiliateRewardTypeFirstTopUp, Quota: 200, CreatedAt: 20},
	}
	require.NoError(t, DB.Create(&rewards).Error)

	items, total, err := GetAllAffiliateRewards(
		&common.PageInfo{Page: 1, PageSize: 10},
		AffiliateRewardAdminFilter{
			InviterKeyword: "alice",
			InviteeKeyword: "21",
			Type:           AffiliateRewardTypeRegistration,
		},
	)
	require.NoError(t, err)
	assert.EqualValues(t, 1, total)
	require.Len(t, items, 1)
	assert.Equal(t, 11, items[0].InviterId)
	assert.Equal(t, "alice-inviter", items[0].InviterUsername)
	assert.Equal(t, 21, items[0].InviteeId)
	assert.Equal(t, "carol-invitee", items[0].InviteeUsername)
}
