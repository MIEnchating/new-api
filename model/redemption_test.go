package model

import (
	"sync"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestSearchRedemptionsFiltersAndPaginates(t *testing.T) {
	require.NoError(t, DB.AutoMigrate(&Redemption{}))
	require.NoError(t, DB.Session(&gorm.Session{AllowGlobalUpdate: true}).Unscoped().Delete(&Redemption{}).Error)
	t.Cleanup(func() {
		require.NoError(t, DB.Session(&gorm.Session{AllowGlobalUpdate: true}).Unscoped().Delete(&Redemption{}).Error)
	})

	now := common.GetTimestamp()
	redemptions := []Redemption{
		{Id: 1, Name: "alpha-active", Key: "00000000000000000000000000000001", Status: common.RedemptionCodeStatusEnabled, ExpiredTime: 0},
		{Id: 2, Name: "alpha-future", Key: "00000000000000000000000000000002", Status: common.RedemptionCodeStatusEnabled, ExpiredTime: now + 3600},
		{Id: 3, Name: "alpha-expired", Key: "00000000000000000000000000000003", Status: common.RedemptionCodeStatusEnabled, ExpiredTime: now - 10},
		{Id: 4, Name: "beta-disabled", Key: "00000000000000000000000000000004", Status: common.RedemptionCodeStatusDisabled, ExpiredTime: 0},
		{Id: 5, Name: "beta-used", Key: "00000000000000000000000000000005", Status: common.RedemptionCodeStatusUsed, ExpiredTime: 0},
	}
	require.NoError(t, DB.Create(&redemptions).Error)

	tests := []struct {
		name      string
		keyword   string
		status    string
		startIdx  int
		num       int
		wantTotal int64
		wantIds   []int
	}{
		{
			name:      "no filters returns all rows",
			num:       10,
			wantTotal: 5,
			wantIds:   []int{5, 4, 3, 2, 1},
		},
		{
			name:      "keyword filters by name prefix",
			keyword:   "alpha",
			num:       10,
			wantTotal: 3,
			wantIds:   []int{3, 2, 1},
		},
		{
			name:      "enabled status excludes expired rows",
			status:    "1",
			num:       10,
			wantTotal: 2,
			wantIds:   []int{2, 1},
		},
		{
			name:      "expired status returns enabled expired rows",
			status:    "expired",
			num:       10,
			wantTotal: 1,
			wantIds:   []int{3},
		},
		{
			name:      "disabled status",
			status:    "2",
			num:       10,
			wantTotal: 1,
			wantIds:   []int{4},
		},
		{
			name:      "used status",
			status:    "3",
			num:       10,
			wantTotal: 1,
			wantIds:   []int{5},
		},
		{
			name:      "pagination keeps unpaged total",
			startIdx:  1,
			num:       2,
			wantTotal: 5,
			wantIds:   []int{4, 3},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rows, total, err := SearchRedemptions(tt.keyword, tt.status, tt.startIdx, tt.num)
			require.NoError(t, err)
			assert.Equal(t, tt.wantTotal, total)
			gotIds := make([]int, 0, len(rows))
			for _, row := range rows {
				gotIds = append(gotIds, row.Id)
			}
			assert.Equal(t, tt.wantIds, gotIds)
		})
	}
}

func setupRedeemFixture(t *testing.T, quota int) (userId int, key string) {
	t.Helper()
	require.NoError(t, DB.AutoMigrate(&Redemption{}, &RedemptionBatchClaim{}))
	require.NoError(t, DB.Session(&gorm.Session{AllowGlobalUpdate: true}).Delete(&RedemptionBatchClaim{}).Error)
	require.NoError(t, DB.Session(&gorm.Session{AllowGlobalUpdate: true}).Unscoped().Delete(&Redemption{}).Error)
	t.Cleanup(func() {
		require.NoError(t, DB.Session(&gorm.Session{AllowGlobalUpdate: true}).Delete(&RedemptionBatchClaim{}).Error)
		require.NoError(t, DB.Session(&gorm.Session{AllowGlobalUpdate: true}).Unscoped().Delete(&Redemption{}).Error)
		DB.Exec("DELETE FROM users")
		DB.Exec("DELETE FROM logs")
	})

	user := &User{Username: "redeem-user", Password: "password", Status: common.UserStatusEnabled, Quota: 0}
	require.NoError(t, DB.Create(user).Error)

	key = "10000000000000000000000000000001"
	redemption := &Redemption{
		Name:        "redeem-test",
		Key:         key,
		Status:      common.RedemptionCodeStatusEnabled,
		Quota:       quota,
		CreatedTime: common.GetTimestamp(),
	}
	require.NoError(t, DB.Create(redemption).Error)
	return user.Id, key
}

func TestRedeemCreditsQuotaExactlyOnce(t *testing.T) {
	userId, key := setupRedeemFixture(t, 500)

	quota, err := Redeem(key, userId)
	require.NoError(t, err)
	assert.Equal(t, 500, quota)

	var user User
	require.NoError(t, DB.First(&user, "id = ?", userId).Error)
	assert.Equal(t, 500, user.Quota)

	var redemption Redemption
	require.NoError(t, DB.First(&redemption, "name = ?", "redeem-test").Error)
	assert.Equal(t, common.RedemptionCodeStatusUsed, redemption.Status)
	assert.Equal(t, userId, redemption.UsedUserId)

	// Redeeming the same code again must fail and must not credit quota.
	_, err = Redeem(key, userId)
	require.ErrorIs(t, err, ErrRedemptionUsed)
	require.NoError(t, DB.First(&user, "id = ?", userId).Error)
	assert.Equal(t, 500, user.Quota)
}

// Exactly one of several concurrent redeems of the same code may win, and
// quota must be credited exactly once.
func TestRedeemConcurrentSingleSuccess(t *testing.T) {
	userId, key := setupRedeemFixture(t, 300)

	const goroutines = 5
	successes := make([]bool, goroutines)
	var wg sync.WaitGroup
	wg.Add(goroutines)
	for i := 0; i < goroutines; i++ {
		go func(idx int) {
			defer wg.Done()
			if _, err := Redeem(key, userId); err == nil {
				successes[idx] = true
			}
		}(i)
	}
	wg.Wait()

	successCount := 0
	for _, ok := range successes {
		if ok {
			successCount++
		}
	}
	assert.Equal(t, 1, successCount, "exactly one concurrent redeem should succeed")

	var user User
	require.NoError(t, DB.First(&user, "id = ?", userId).Error)
	assert.Equal(t, 300, user.Quota, "quota must be credited exactly once")
}

func setupBatchRedeemFixture(t *testing.T) (users []User) {
	t.Helper()
	require.NoError(t, DB.AutoMigrate(&Redemption{}, &RedemptionBatchClaim{}))
	require.NoError(t, DB.Session(&gorm.Session{AllowGlobalUpdate: true}).Delete(&RedemptionBatchClaim{}).Error)
	require.NoError(t, DB.Session(&gorm.Session{AllowGlobalUpdate: true}).Unscoped().Delete(&Redemption{}).Error)
	DB.Exec("DELETE FROM users")
	DB.Exec("DELETE FROM logs")
	t.Cleanup(func() {
		require.NoError(t, DB.Session(&gorm.Session{AllowGlobalUpdate: true}).Delete(&RedemptionBatchClaim{}).Error)
		require.NoError(t, DB.Session(&gorm.Session{AllowGlobalUpdate: true}).Unscoped().Delete(&Redemption{}).Error)
		DB.Exec("DELETE FROM users")
		DB.Exec("DELETE FROM logs")
	})

	users = []User{
		{Username: "batch-redeem-user-1", Password: "password", Status: common.UserStatusEnabled, AffCode: "batch-user-1"},
		{Username: "batch-redeem-user-2", Password: "password", Status: common.UserStatusEnabled, AffCode: "batch-user-2"},
	}
	require.NoError(t, DB.Create(&users).Error)
	return users
}

func createBatchCodes(t *testing.T, batchId string, limitOnePerUser bool, count int, quota int) []Redemption {
	t.Helper()
	redemptions := make([]Redemption, count)
	for i := range redemptions {
		redemptions[i] = Redemption{
			Name:            "batch-" + batchId,
			Key:             common.GetUUID(),
			Status:          common.RedemptionCodeStatusEnabled,
			Quota:           quota,
			CreatedTime:     common.GetTimestamp(),
			BatchId:         batchId,
			LimitOnePerUser: limitOnePerUser,
		}
	}
	require.NoError(t, DB.Create(&redemptions).Error)
	return redemptions
}

func TestRedeemBatchLimit(t *testing.T) {
	users := setupBatchRedeemFixture(t)
	limitedBatch := createBatchCodes(t, "limited-batch", true, 3, 100)
	otherBatch := createBatchCodes(t, "other-batch", true, 1, 100)
	unlimitedBatch := createBatchCodes(t, "unlimited-batch", false, 2, 100)

	_, err := Redeem(limitedBatch[0].Key, users[0].Id)
	require.NoError(t, err)
	_, err = Redeem(limitedBatch[1].Key, users[0].Id)
	require.ErrorIs(t, err, ErrRedemptionBatchLimit, "same user must not redeem a second code from the same limited batch")

	_, err = Redeem(limitedBatch[1].Key, users[1].Id)
	require.NoError(t, err, "another user may redeem one code from the same batch")
	_, err = Redeem(otherBatch[0].Key, users[0].Id)
	require.NoError(t, err, "the same user may redeem a code from another batch")
	_, err = Redeem(unlimitedBatch[0].Key, users[0].Id)
	require.NoError(t, err)
	_, err = Redeem(unlimitedBatch[1].Key, users[0].Id)
	require.NoError(t, err, "an unlimited batch may be redeemed more than once")

	var firstUser User
	require.NoError(t, DB.First(&firstUser, users[0].Id).Error)
	assert.Equal(t, 400, firstUser.Quota)
	var claims int64
	require.NoError(t, DB.Model(&RedemptionBatchClaim{}).Where("user_id = ?", users[0].Id).Count(&claims).Error)
	assert.Equal(t, int64(2), claims)
}

func TestRedeemReturnsActionableBusinessErrors(t *testing.T) {
	userId, key := setupRedeemFixture(t, 100)

	_, err := Redeem("missing-redemption-code", userId)
	require.ErrorIs(t, err, ErrRedemptionInvalid)

	require.NoError(t, DB.Model(&Redemption{}).Where("key = ?", key).Update("expired_time", common.GetTimestamp()-1).Error)
	_, err = Redeem(key, userId)
	require.ErrorIs(t, err, ErrRedemptionExpired)

	_, err = Redeem("", userId)
	require.ErrorIs(t, err, ErrRedemptionNotProvided)
}

func TestRedeemConcurrentDifferentCodesInLimitedBatch(t *testing.T) {
	users := setupBatchRedeemFixture(t)
	codes := createBatchCodes(t, "concurrent-batch", true, 5, 250)

	successes := make([]bool, len(codes))
	var wg sync.WaitGroup
	wg.Add(len(codes))
	for i := range codes {
		go func(idx int) {
			defer wg.Done()
			if _, err := Redeem(codes[idx].Key, users[0].Id); err == nil {
				successes[idx] = true
			}
		}(i)
	}
	wg.Wait()

	successCount := 0
	for _, success := range successes {
		if success {
			successCount++
		}
	}
	assert.Equal(t, 1, successCount)

	var user User
	require.NoError(t, DB.First(&user, users[0].Id).Error)
	assert.Equal(t, 250, user.Quota)
}

func TestCreateRedemptionsCreatesOneAtomicBatch(t *testing.T) {
	setupBatchRedeemFixture(t)
	request := &Redemption{
		UserId:          7,
		Name:            "summer-campaign",
		Quota:           500,
		Count:           3,
		LimitOnePerUser: true,
	}

	keys, err := CreateRedemptions(request)
	require.NoError(t, err)
	require.Len(t, keys, 3)

	var redemptions []Redemption
	require.NoError(t, DB.Where("name = ?", request.Name).Order("id").Find(&redemptions).Error)
	require.Len(t, redemptions, 3)
	batchId := redemptions[0].BatchId
	assert.NotEmpty(t, batchId)
	for i, redemption := range redemptions {
		assert.Equal(t, batchId, redemption.BatchId)
		assert.True(t, redemption.LimitOnePerUser)
		assert.Equal(t, keys[i], redemption.Key)
	}
}

func TestBatchDeleteRedemptions(t *testing.T) {
	require.NoError(t, DB.AutoMigrate(&Redemption{}))
	require.NoError(t, DB.Session(&gorm.Session{AllowGlobalUpdate: true}).Unscoped().Delete(&Redemption{}).Error)
	t.Cleanup(func() {
		require.NoError(t, DB.Session(&gorm.Session{AllowGlobalUpdate: true}).Unscoped().Delete(&Redemption{}).Error)
	})

	redemptions := []Redemption{
		{Name: "batch-delete-1", Key: common.GetUUID(), Status: common.RedemptionCodeStatusEnabled},
		{Name: "batch-delete-2", Key: common.GetUUID(), Status: common.RedemptionCodeStatusEnabled},
		{Name: "batch-keep", Key: common.GetUUID(), Status: common.RedemptionCodeStatusEnabled},
	}
	require.NoError(t, DB.Create(&redemptions).Error)

	count, err := BatchDeleteRedemptions([]int{redemptions[0].Id, redemptions[1].Id, redemptions[0].Id})
	require.NoError(t, err)
	assert.Equal(t, int64(2), count)

	var remaining []Redemption
	require.NoError(t, DB.Order("id").Find(&remaining).Error)
	require.Len(t, remaining, 1)
	assert.Equal(t, redemptions[2].Id, remaining[0].Id)
}

func TestBatchDeleteRedemptionsRejectsInvalidIDs(t *testing.T) {
	_, err := BatchDeleteRedemptions(nil)
	require.Error(t, err)

	_, err = BatchDeleteRedemptions([]int{0})
	require.Error(t, err)

	_, err = BatchDeleteRedemptions(make([]int, 1001))
	require.Error(t, err)
}
