package model

import (
	"fmt"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupBillingHistoryTest(t *testing.T) (int, int) {
	t.Helper()
	require.NoError(t, DB.AutoMigrate(&BillingTransaction{}, &TopUp{}, &Redemption{}, &User{}))
	userOneID := 910001
	userTwoID := 910002
	require.NoError(t, DB.Where("user_id IN ?", []int{userOneID, userTwoID}).Delete(&BillingTransaction{}).Error)
	require.NoError(t, DB.Where("user_id IN ?", []int{userOneID, userTwoID}).Delete(&TopUp{}).Error)
	require.NoError(t, DB.Session(&gorm.Session{AllowGlobalUpdate: true}).Unscoped().Where("used_user_id IN ?", []int{userOneID, userTwoID}).Delete(&Redemption{}).Error)
	require.NoError(t, DB.Unscoped().Where("id IN ?", []int{userOneID, userTwoID}).Delete(&User{}).Error)
	require.NoError(t, DB.Create(&[]User{
		{Id: userOneID, Username: "billing-history-one", Password: "password", Status: common.UserStatusEnabled, Quota: 1000, AffCode: "bh01"},
		{Id: userTwoID, Username: "billing-history-two", Password: "password", Status: common.UserStatusEnabled, Quota: 2000, AffCode: "bh02"},
	}).Error)
	t.Cleanup(func() {
		_ = DB.Where("user_id IN ?", []int{userOneID, userTwoID}).Delete(&BillingTransaction{}).Error
		_ = DB.Where("user_id IN ?", []int{userOneID, userTwoID}).Delete(&TopUp{}).Error
		_ = DB.Session(&gorm.Session{AllowGlobalUpdate: true}).Unscoped().Where("used_user_id IN ?", []int{userOneID, userTwoID}).Delete(&Redemption{}).Error
		_ = DB.Unscoped().Where("id IN ?", []int{userOneID, userTwoID}).Delete(&User{}).Error
	})
	return userOneID, userTwoID
}

func TestGetBillingHistoryMergesSourcesAndFilters(t *testing.T) {
	userOneID, userTwoID := setupBillingHistoryTest(t)
	now := common.GetTimestamp()
	require.NoError(t, DB.Create(&TopUp{
		UserId: userOneID, Amount: 2, Money: 1.9, TradeNo: fmt.Sprintf("billing-topup-%d", now),
		PaymentMethod: "stripe", PaymentProvider: PaymentProviderStripe,
		CreateTime: now - 30, CompleteTime: now - 20, Status: common.TopUpStatusSuccess,
	}).Error)
	require.NoError(t, DB.Create(&Redemption{
		UserId: 1, Key: fmt.Sprintf("%032d", now%1_000_000_000), Name: "billing-redemption",
		Status: common.RedemptionCodeStatusUsed, Quota: 500, UsedUserId: userOneID,
		CreatedTime: now - 50, RedeemedTime: now - 10,
	}).Error)
	require.NoError(t, CreateBillingTransaction(nil, &BillingTransaction{
		EventKey: "billing-affiliate-test", UserId: userOneID, Type: BillingTypeAffiliate,
		Quota: 300, Reference: "affiliate-test", Status: "success", CreatedAt: now,
	}))
	require.NoError(t, CreateBillingTransaction(nil, &BillingTransaction{
		EventKey: "billing-admin-test", UserId: userTwoID, Type: BillingTypeAdminAdjustment,
		Quota: -100, Reference: "admin-test", Status: "success", CreatedAt: now - 5,
	}))

	items, total, err := GetBillingHistory(BillingHistoryFilter{
		UserId: userOneID, StartTime: now - 100, EndTime: now + 1,
		PageInfo: &common.PageInfo{Page: 1, PageSize: 10},
	})
	require.NoError(t, err)
	require.Equal(t, int64(3), total)
	require.Len(t, items, 3)
	require.Equal(t, BillingTypeAffiliate, items[0].Type)
	require.ElementsMatch(t, []string{BillingTypeAffiliate, BillingTypeRedemption, BillingTypeOnlineTopup}, []string{items[0].Type, items[1].Type, items[2].Type})

	items, total, err = GetBillingHistory(BillingHistoryFilter{
		UserKeyword: "billing-history-two", Types: []string{BillingTypeAdminAdjustment},
		StartTime: now - 100, EndTime: now + 1,
		PageInfo: &common.PageInfo{Page: 1, PageSize: 10},
	})
	require.NoError(t, err)
	require.Equal(t, int64(1), total)
	require.Len(t, items, 1)
	require.Equal(t, userTwoID, items[0].UserId)
}

func TestAdjustUserQuotaWithBillingRecordsSignedDelta(t *testing.T) {
	userOneID, _ := setupBillingHistoryTest(t)
	oldQuota, newQuota, delta, err := AdjustUserQuotaWithBilling(userOneID, 250, "add", 99, "admin-adjustment:test-add")
	require.NoError(t, err)
	require.Equal(t, 1000, oldQuota)
	require.Equal(t, 1250, newQuota)
	require.Equal(t, 250, delta)

	var transaction BillingTransaction
	require.NoError(t, DB.Where("event_key = ?", "admin-adjustment:test-add").First(&transaction).Error)
	require.Equal(t, BillingTypeAdminAdjustment, transaction.Type)
	require.Equal(t, 250, transaction.Quota)
	require.Equal(t, 99, transaction.OperatorUserId)
}

func TestTransferAffQuotaToQuotaRecordsBillingTransaction(t *testing.T) {
	userOneID, _ := setupBillingHistoryTest(t)
	transferQuota := int(common.QuotaPerUnit)
	require.NoError(t, DB.Model(&User{}).Where("id = ?", userOneID).Update("aff_quota", transferQuota+100).Error)
	user, err := GetUserById(userOneID, true)
	require.NoError(t, err)
	require.NoError(t, user.TransferAffQuotaToQuota(transferQuota, "affiliate-transfer:test"))

	var transaction BillingTransaction
	require.NoError(t, DB.Where("event_key = ?", "affiliate-transfer:test").First(&transaction).Error)
	require.Equal(t, BillingTypeAffiliate, transaction.Type)
	require.Equal(t, transferQuota, transaction.Quota)

	var updated User
	require.NoError(t, DB.First(&updated, userOneID).Error)
	require.Equal(t, 1000+transferQuota, updated.Quota)
	require.Equal(t, 100, updated.AffQuota)
}
