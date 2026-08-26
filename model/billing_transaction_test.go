package model

import (
	"fmt"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
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
	require.NoError(t, DB.Create(&Redemption{
		UserId: 1, Key: fmt.Sprintf("%032d", (now+1)%1_000_000_000), Name: "billing-campaign",
		Status: common.RedemptionCodeStatusUsed, Quota: 800, UsedUserId: userOneID,
		CreatedTime: now - 45, RedeemedTime: now - 8, LimitOnePerUser: true,
	}).Error)
	require.NoError(t, CreateBillingTransaction(nil, &BillingTransaction{
		EventKey: "billing-affiliate-test", UserId: userOneID, Type: BillingTypeAffiliate,
		Quota: 300, Reference: "affiliate-test", Status: "success", CreatedAt: now,
	}))
	require.NoError(t, CreateBillingTransaction(nil, &BillingTransaction{
		EventKey: "billing-admin-test", UserId: userTwoID, Type: BillingTypeAdminAdjustment,
		Quota: -100, Reference: "admin-test", Status: "success", CreatedAt: now - 5,
	}))

	items, total, typeCounts, typeQuotas, err := GetBillingHistoryWithTypeStats(BillingHistoryFilter{
		UserId: userOneID, StartTime: now - 100, EndTime: now + 1,
		PageInfo: &common.PageInfo{Page: 1, PageSize: 10},
	})
	require.NoError(t, err)
	require.Equal(t, int64(4), total)
	require.Len(t, items, 4)
	require.Equal(t, int64(1), typeCounts[BillingTypeOnlineTopup])
	require.Equal(t, int64(1), typeCounts[BillingTypeRedemption])
	require.Equal(t, int64(1), typeCounts[BillingTypeAffiliate])
	require.Zero(t, typeCounts[BillingTypeAdminAdjustment])
	require.Equal(t, int64(calculateTopUpCreditedQuota(PaymentProviderStripe, 2, 1.9)), typeQuotas[BillingTypeOnlineTopup])
	require.Equal(t, int64(500), typeQuotas[BillingTypeRedemption])
	require.Equal(t, int64(300), typeQuotas[BillingTypeAffiliate])
	require.Zero(t, typeQuotas[BillingTypeAdminAdjustment])
	require.Equal(t, BillingTypeAffiliate, items[0].Type)
	require.ElementsMatch(t, []string{BillingTypeAffiliate, BillingTypeRedemption, BillingTypeRedemption, BillingTypeOnlineTopup}, []string{items[0].Type, items[1].Type, items[2].Type, items[3].Type})
	campaignItems := make([]BillingHistoryItem, 0, 1)
	for _, item := range items {
		if item.ExcludedFromStats {
			campaignItems = append(campaignItems, item)
		}
		if item.Type == BillingTypeRedemption {
			require.Equal(t, 1, item.OperatorUserId)
		}
	}
	require.Len(t, campaignItems, 1)
	require.False(t, campaignItems[0].InvoiceEligible)

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

func TestGetBillingHistoryIncludesLotteryRewards(t *testing.T) {
	userOneID, _ := setupBillingHistoryTest(t)
	now := common.GetTimestamp()
	require.NoError(t, CreateBillingTransaction(nil, &BillingTransaction{
		EventKey: "lottery-history-test", UserId: userOneID,
		Type: BillingTypeLottery, Quota: 500,
		Reference: "lottery-history-test", PaymentMethod: "lottery",
		Status: "success", CreatedAt: now, Detail: LotteryPrizeOne,
	}))

	items, total, typeCounts, typeQuotas, err :=
		GetBillingHistoryWithTypeStats(BillingHistoryFilter{
			UserId:   userOneID,
			Types:    []string{BillingTypeLottery},
			PageInfo: &common.PageInfo{Page: 1, PageSize: 10},
		})
	require.NoError(t, err)
	require.EqualValues(t, 1, total)
	require.Len(t, items, 1)
	require.Equal(t, BillingTypeLottery, items[0].Type)
	require.False(t, items[0].InvoiceEligible)
	require.EqualValues(t, 1, typeCounts[BillingTypeLottery])
	require.EqualValues(t, 500, typeQuotas[BillingTypeLottery])
}

func TestUpdateBillingInvoiceStatusesSupportsRegularRedemptions(t *testing.T) {
	userOneID, _ := setupBillingHistoryTest(t)
	now := common.GetTimestamp()
	topup := TopUp{
		UserId: userOneID, Amount: 2, Money: 2, TradeNo: fmt.Sprintf("billing-invoice-%d", now),
		PaymentMethod: PaymentMethodStripe, PaymentProvider: PaymentProviderStripe,
		CreateTime: now - 20, CompleteTime: now - 10, Status: common.TopUpStatusSuccess,
	}
	require.NoError(t, DB.Create(&topup).Error)
	redemption := Redemption{
		UserId: 1, Key: fmt.Sprintf("%032d", (now+2)%1_000_000_000), Name: "invoice-redemption",
		Status: common.RedemptionCodeStatusUsed, Quota: 500, UsedUserId: userOneID,
		CreatedTime: now - 20, RedeemedTime: now - 5,
	}
	require.NoError(t, DB.Create(&redemption).Error)

	records, err := UpdateBillingInvoiceStatuses([]BillingInvoiceTarget{
		{Id: topup.Id, Type: BillingTypeOnlineTopup},
		{Id: redemption.Id, Type: BillingTypeRedemption},
	}, TopUpInvoiceActionIssue, 91)
	require.NoError(t, err)
	require.Len(t, records, 2)
	require.NoError(t, DB.First(&topup, topup.Id).Error)
	require.NoError(t, DB.Unscoped().First(&redemption, redemption.Id).Error)
	require.Equal(t, TopUpInvoiceStatusIssued, topup.InvoiceStatus)
	require.Equal(t, TopUpInvoiceStatusIssued, redemption.InvoiceStatus)

	_, err = UpdateBillingInvoiceStatuses([]BillingInvoiceTarget{
		{Id: topup.Id, Type: BillingTypeOnlineTopup},
		{Id: redemption.Id, Type: BillingTypeRedemption},
	}, TopUpInvoiceActionReturn, 92)
	require.NoError(t, err)
	require.NoError(t, DB.First(&topup, topup.Id).Error)
	require.NoError(t, DB.Unscoped().First(&redemption, redemption.Id).Error)
	require.Equal(t, TopUpInvoiceStatusReturned, topup.InvoiceStatus)
	require.Equal(t, TopUpInvoiceStatusReturned, redemption.InvoiceStatus)
}

func TestUpdateBillingInvoiceStatusesRejectsCampaignRedemptions(t *testing.T) {
	userOneID, _ := setupBillingHistoryTest(t)
	now := common.GetTimestamp()
	redemption := Redemption{
		UserId: 1, Key: fmt.Sprintf("%032d", (now+3)%1_000_000_000), Name: "campaign-redemption",
		Status: common.RedemptionCodeStatusUsed, Quota: 500, UsedUserId: userOneID,
		CreatedTime: now - 20, RedeemedTime: now - 5, LimitOnePerUser: true,
	}
	require.NoError(t, DB.Create(&redemption).Error)

	_, err := UpdateBillingInvoiceStatuses([]BillingInvoiceTarget{{
		Id: redemption.Id, Type: BillingTypeRedemption,
	}}, TopUpInvoiceActionIssue, 91)
	require.ErrorIs(t, err, ErrBillingInvoiceIneligible)
	require.NoError(t, DB.Unscoped().First(&redemption, redemption.Id).Error)
	require.Zero(t, redemption.InvoiceStatus)
}

func TestGetBillingHistoryUsesStripeCreditedQuota(t *testing.T) {
	userOneID, _ := setupBillingHistoryTest(t)
	originalQuotaPerUnit := common.QuotaPerUnit
	common.QuotaPerUnit = 1000
	t.Cleanup(func() {
		common.QuotaPerUnit = originalQuotaPerUnit
	})

	now := common.GetTimestamp()
	require.NoError(t, DB.Create(&TopUp{
		UserId: userOneID, Amount: 5, Money: 2.75, TradeNo: fmt.Sprintf("billing-stripe-quota-%d", now),
		PaymentMethod: PaymentMethodStripe, PaymentProvider: PaymentProviderStripe,
		CreateTime: now - 10, CompleteTime: now - 5, Status: common.TopUpStatusSuccess,
	}).Error)

	items, total, err := GetBillingHistory(BillingHistoryFilter{
		UserId: userOneID, Types: []string{BillingTypeOnlineTopup},
		StartTime: now - 20, EndTime: now,
		PageInfo: &common.PageInfo{Page: 1, PageSize: 10},
	})
	require.NoError(t, err)
	require.Equal(t, int64(1), total)
	require.Len(t, items, 1)
	require.Equal(t, 2750, items[0].Quota)
}

func TestCalculateTopUpCreditedQuotaByProvider(t *testing.T) {
	originalQuotaPerUnit := common.QuotaPerUnit
	common.QuotaPerUnit = 1000
	t.Cleanup(func() {
		common.QuotaPerUnit = originalQuotaPerUnit
	})

	tests := []struct {
		name     string
		provider string
		amount   int64
		money    float64
		want     int
	}{
		{name: "stripe uses charged money", provider: PaymentProviderStripe, amount: 5, money: 2.75, want: 2750},
		{name: "creem amount is already quota", provider: PaymentProviderCreem, amount: 2750, money: 2.75, want: 2750},
		{name: "creem preserves quota above legacy int32 range", provider: PaymentProviderCreem, amount: int64(common.MaxQuota) + 1, want: common.MaxQuota + 1},
		{name: "epay converts amount to quota", provider: PaymentProviderEpay, amount: 5, money: 2.75, want: 5000},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			require.Equal(t, tt.want, calculateTopUpCreditedQuota(tt.provider, tt.amount, tt.money))
		})
	}
}

func TestGetBillingHistoryUsesEffectiveTopUpTimeForFilterAndOrder(t *testing.T) {
	userOneID, _ := setupBillingHistoryTest(t)
	baseTime := common.GetTimestamp()
	topups := []TopUp{
		{
			UserId: userOneID, Amount: 1, Money: 1, TradeNo: fmt.Sprintf("billing-completed-in-range-%d", baseTime),
			PaymentMethod: "alipay", PaymentProvider: PaymentProviderEpay,
			CreateTime: baseTime - 200, CompleteTime: baseTime - 50, Status: common.TopUpStatusSuccess,
		},
		{
			UserId: userOneID, Amount: 1, Money: 1, TradeNo: fmt.Sprintf("billing-completed-after-range-%d", baseTime),
			PaymentMethod: "alipay", PaymentProvider: PaymentProviderEpay,
			CreateTime: baseTime - 40, CompleteTime: baseTime + 50, Status: common.TopUpStatusSuccess,
		},
		{
			UserId: userOneID, Amount: 1, Money: 1, TradeNo: fmt.Sprintf("billing-pending-in-range-%d", baseTime),
			PaymentMethod: "alipay", PaymentProvider: PaymentProviderEpay,
			CreateTime: baseTime - 20, Status: common.TopUpStatusPending,
		},
	}
	require.NoError(t, DB.Create(&topups).Error)

	items, total, err := GetBillingHistory(BillingHistoryFilter{
		UserId: userOneID, Types: []string{BillingTypeOnlineTopup},
		StartTime: baseTime - 100, EndTime: baseTime,
		PageInfo: &common.PageInfo{Page: 1, PageSize: 10},
	})
	require.NoError(t, err)
	require.Equal(t, int64(2), total)
	require.Len(t, items, 2)
	require.Equal(t, topups[2].TradeNo, items[0].Reference)
	require.Equal(t, baseTime-20, items[0].CreatedAt)
	require.Equal(t, topups[0].TradeNo, items[1].Reference)
	require.Equal(t, baseTime-50, items[1].CreatedAt)
}

func TestGetBillingHistoryNormalizesInvalidPagination(t *testing.T) {
	userOneID, _ := setupBillingHistoryTest(t)
	pageInfo := &common.PageInfo{Page: -1, PageSize: -10}

	items, total, err := GetBillingHistory(BillingHistoryFilter{
		UserId:   userOneID,
		Types:    []string{BillingTypeOnlineTopup},
		PageInfo: pageInfo,
	})
	require.NoError(t, err)
	require.Empty(t, items)
	require.Zero(t, total)
	require.Equal(t, 1, pageInfo.Page)
	require.Equal(t, defaultBillingHistoryPageSize, pageInfo.PageSize)
}

func TestGetBillingHistoryRejectsExcessivePaginationWindow(t *testing.T) {
	_, _, err := GetBillingHistory(BillingHistoryFilter{
		Types:    []string{BillingTypeOnlineTopup},
		PageInfo: &common.PageInfo{Page: 101, PageSize: 100},
	})
	require.ErrorContains(t, err, "pagination exceeds")
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

func TestAdjustUserQuotaWithBillingIsIdempotentByEventKey(t *testing.T) {
	userOneID, _ := setupBillingHistoryTest(t)
	const eventKey = "admin-adjustment:test-idempotent"

	_, _, _, err := AdjustUserQuotaWithBilling(userOneID, 250, "add", 99, eventKey)
	require.NoError(t, err)
	oldQuota, newQuota, delta, err := AdjustUserQuotaWithBilling(userOneID, 250, "add", 99, eventKey)
	require.NoError(t, err)
	require.Equal(t, 1250, oldQuota)
	require.Equal(t, 1250, newQuota)
	require.Zero(t, delta)

	var updated User
	require.NoError(t, DB.First(&updated, userOneID).Error)
	require.Equal(t, 1250, updated.Quota)
	var count int64
	require.NoError(t, DB.Model(&BillingTransaction{}).Where("event_key = ?", eventKey).Count(&count).Error)
	require.Equal(t, int64(1), count)
}

func TestAdjustUserQuotaWithBillingRejectsEventKeyCollision(t *testing.T) {
	userOneID, userTwoID := setupBillingHistoryTest(t)
	const eventKey = "admin-adjustment:test-collision"

	_, _, _, err := AdjustUserQuotaWithBilling(userOneID, 250, "add", 99, eventKey)
	require.NoError(t, err)
	_, _, _, err = AdjustUserQuotaWithBilling(userTwoID, 250, "add", 99, eventKey)
	require.ErrorContains(t, err, "already used by another transaction")

	var updated User
	require.NoError(t, DB.First(&updated, userTwoID).Error)
	require.Equal(t, 2000, updated.Quota)
}

func TestAdjustUserQuotaWithBillingRejectsModeCollision(t *testing.T) {
	userOneID, _ := setupBillingHistoryTest(t)
	const eventKey = "admin-adjustment:test-mode-collision"

	_, _, _, err := AdjustUserQuotaWithBilling(userOneID, 250, "add", 99, eventKey)
	require.NoError(t, err)
	_, _, _, err = AdjustUserQuotaWithBilling(userOneID, 1250, "override", 99, eventKey)
	require.ErrorContains(t, err, "already used by another transaction")

	var updated User
	require.NoError(t, DB.First(&updated, userOneID).Error)
	require.Equal(t, 1250, updated.Quota)
}

func TestAdjustUserQuotaWithBillingRejectsOperatorCollision(t *testing.T) {
	userOneID, _ := setupBillingHistoryTest(t)
	const eventKey = "admin-adjustment:test-operator-collision"

	_, _, _, err := AdjustUserQuotaWithBilling(userOneID, 250, "add", 99, eventKey)
	require.NoError(t, err)
	_, _, _, err = AdjustUserQuotaWithBilling(userOneID, 250, "add", 100, eventKey)
	require.ErrorContains(t, err, "already used by another transaction")

	var updated User
	require.NoError(t, DB.First(&updated, userOneID).Error)
	require.Equal(t, 1250, updated.Quota)
}

func TestAdjustUserQuotaWithBillingOverrideReplayAfterAnotherChange(t *testing.T) {
	userOneID, _ := setupBillingHistoryTest(t)
	const eventKey = "admin-adjustment:test-override-replay"

	_, _, _, err := AdjustUserQuotaWithBilling(userOneID, 500, "override", 99, eventKey)
	require.NoError(t, err)
	_, _, _, err = AdjustUserQuotaWithBilling(userOneID, 100, "add", 99, "admin-adjustment:intervening")
	require.NoError(t, err)

	oldQuota, newQuota, delta, err := AdjustUserQuotaWithBilling(userOneID, 500, "override", 99, eventKey)
	require.NoError(t, err)
	require.Equal(t, 600, oldQuota)
	require.Equal(t, 600, newQuota)
	require.Zero(t, delta)
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

func TestTransferAffQuotaToQuotaIsIdempotentByEventKey(t *testing.T) {
	userOneID, _ := setupBillingHistoryTest(t)
	transferQuota := int(common.QuotaPerUnit)
	require.NoError(t, DB.Model(&User{}).Where("id = ?", userOneID).Update("aff_quota", transferQuota*2).Error)
	user, err := GetUserById(userOneID, true)
	require.NoError(t, err)
	const eventKey = "affiliate-transfer:test-idempotent"

	require.NoError(t, user.TransferAffQuotaToQuota(transferQuota, eventKey))
	require.NoError(t, user.TransferAffQuotaToQuota(transferQuota, eventKey))

	var updated User
	require.NoError(t, DB.First(&updated, userOneID).Error)
	require.Equal(t, 1000+transferQuota, updated.Quota)
	require.Equal(t, transferQuota, updated.AffQuota)
	var count int64
	require.NoError(t, DB.Model(&BillingTransaction{}).Where("event_key = ?", eventKey).Count(&count).Error)
	require.Equal(t, int64(1), count)
}

func TestTransferAffQuotaToQuotaRejectsEventKeyCollision(t *testing.T) {
	userOneID, userTwoID := setupBillingHistoryTest(t)
	transferQuota := int(common.QuotaPerUnit)
	require.NoError(t, DB.Model(&User{}).Where("id IN ?", []int{userOneID, userTwoID}).Update("aff_quota", transferQuota).Error)
	userOne, err := GetUserById(userOneID, true)
	require.NoError(t, err)
	const eventKey = "affiliate-transfer:test-collision"
	require.NoError(t, userOne.TransferAffQuotaToQuota(transferQuota, eventKey))

	userTwo, err := GetUserById(userTwoID, true)
	require.NoError(t, err)
	err = userTwo.TransferAffQuotaToQuota(transferQuota, eventKey)
	require.ErrorContains(t, err, "already used by another transaction")

	var updated User
	require.NoError(t, DB.First(&updated, userTwoID).Error)
	require.Equal(t, 2000, updated.Quota)
}

func TestTransferAffQuotaToQuotaRejectsWalletOverflow(t *testing.T) {
	userOneID, _ := setupBillingHistoryTest(t)
	transferQuota := int(common.QuotaPerUnit)
	require.NoError(t, DB.Model(&User{}).Where("id = ?", userOneID).Updates(map[string]interface{}{
		"quota":     common.MaxWalletQuota,
		"aff_quota": transferQuota,
	}).Error)
	user, err := GetUserById(userOneID, true)
	require.NoError(t, err)

	err = user.TransferAffQuotaToQuota(transferQuota, "affiliate-transfer:test-overflow")
	require.ErrorIs(t, err, ErrWalletQuotaLimitExceeded)

	var updated User
	require.NoError(t, DB.First(&updated, userOneID).Error)
	assert.Equal(t, common.MaxWalletQuota, updated.Quota)
	assert.Equal(t, transferQuota, updated.AffQuota)
	var count int64
	require.NoError(t, DB.Model(&BillingTransaction{}).
		Where("event_key = ?", "affiliate-transfer:test-overflow").Count(&count).Error)
	assert.Zero(t, count)
}
