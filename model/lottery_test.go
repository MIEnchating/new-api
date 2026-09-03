package model

import (
	"fmt"
	"strconv"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func setLotteryPrizePoolForTest(t *testing.T, prizes []LotteryPrize) {
	t.Helper()
	data, err := common.Marshal(prizes)
	require.NoError(t, err)
	common.OptionMapRWMutex.Lock()
	if common.OptionMap == nil {
		common.OptionMap = make(map[string]string)
	}
	oldValue, existed := common.OptionMap[LotteryPrizePoolOptionKey]
	common.OptionMap[LotteryPrizePoolOptionKey] = string(data)
	common.OptionMapRWMutex.Unlock()
	t.Cleanup(func() {
		common.OptionMapRWMutex.Lock()
		defer common.OptionMapRWMutex.Unlock()
		if existed {
			common.OptionMap[LotteryPrizePoolOptionKey] = oldValue
		} else {
			delete(common.OptionMap, LotteryPrizePoolOptionKey)
		}
	})
}

func setLotteryConfigForTest(t *testing.T, config LotteryConfig) {
	t.Helper()
	data, err := common.Marshal(config)
	require.NoError(t, err)
	common.OptionMapRWMutex.Lock()
	if common.OptionMap == nil {
		common.OptionMap = make(map[string]string)
	}
	oldValue, existed := common.OptionMap[LotteryConfigOptionKey]
	common.OptionMap[LotteryConfigOptionKey] = string(data)
	common.OptionMapRWMutex.Unlock()
	t.Cleanup(func() {
		common.OptionMapRWMutex.Lock()
		defer common.OptionMapRWMutex.Unlock()
		if existed {
			common.OptionMap[LotteryConfigOptionKey] = oldValue
		} else {
			delete(common.OptionMap, LotteryConfigOptionKey)
		}
	})
}

func setupLotteryTest(t *testing.T) (int, time.Time) {
	t.Helper()
	truncateTables(t)
	oldQuotaPerUnit := common.QuotaPerUnit
	common.QuotaPerUnit = 100
	setLotteryPrizePoolForTest(t, lotteryPrizePool())
	t.Cleanup(func() {
		common.QuotaPerUnit = oldQuotaPerUnit
	})
	user := User{
		Id: 61, Username: "lottery-user", AffCode: "lottery_aff",
		Status: common.UserStatusEnabled, Quota: 1000,
	}
	require.NoError(t, DB.Create(&user).Error)
	now := time.Date(2026, time.August, 16, 12, 0, 0, 0, time.Local)
	require.NoError(t, DB.Create(&LotteryCampaign{
		Id: 1, StartedAt: lotteryDayStart(
			time.Date(2026, time.August, 10, 12, 0, 0, 0, time.Local),
		).Unix(),
	}).Error)
	return user.Id, now
}

func addLotteryConsumeLog(
	t *testing.T,
	userId int,
	at time.Time,
	quota int,
) {
	t.Helper()
	require.NoError(t, LOG_DB.Create(&Log{
		UserId: userId, Type: LogTypeConsume,
		CreatedAt: at.Unix(), Quota: quota,
		RequestId: common.GetUUID(),
	}).Error)
}

func TestLotteryStatusAwardsWeeklyAndStreakChancesIdempotently(
	t *testing.T,
) {
	userId, now := setupLotteryTest(t)
	for offset := 0; offset < 7; offset++ {
		day := time.Date(
			2026, time.August, 10+offset, 15, 0, 0, 0, time.Local,
		)
		addLotteryConsumeLog(t, userId, day, 20*100)
	}

	status, err := getLotteryStatusAt(userId, now)
	require.NoError(t, err)
	assert.Equal(t, 6, status.AvailableChances)
	assert.Equal(t, 140*100, status.WeeklySpendQuota)
	assert.Equal(t, 2, status.WeeklyEarnedChances)
	assert.True(t, status.TodayActive)
	assert.Equal(t, 7, status.CurrentStreak)

	repeated, err := getLotteryStatusAt(userId, now)
	require.NoError(t, err)
	assert.Equal(t, 6, repeated.AvailableChances)
	var grantCount int64
	require.NoError(t, DB.Model(&LotteryChanceGrant{}).
		Where("user_id = ?", userId).
		Count(&grantCount).Error)
	assert.EqualValues(t, 4, grantCount)
}

func TestLotteryWeeklySpendChancesAreCappedAtFive(t *testing.T) {
	userId, now := setupLotteryTest(t)
	addLotteryConsumeLog(t, userId, now, 400*100)

	status, err := getLotteryStatusAt(userId, now)
	require.NoError(t, err)
	assert.Equal(t, 5, status.WeeklyEarnedChances)
	assert.Equal(t, 5, status.AvailableChances)
}

func TestLotteryConfigurableBaseRules(t *testing.T) {
	userId, now := setupLotteryTest(t)
	config := defaultLotteryConfig()
	config.Rules = LotteryRules{
		WeeklySpendAmount: 100,
		WeeklyChanceLimit: 1,
		DailyActiveAmount: 30,
		StreakRewards:     []LotteryStreakReward{{Days: 2, Chances: 2}},
	}
	setLotteryConfigForTest(t, config)
	addLotteryConsumeLog(t, userId, now.AddDate(0, 0, -1), 50*100)
	addLotteryConsumeLog(t, userId, now, 50*100)

	status, err := getLotteryStatusAt(userId, now)
	require.NoError(t, err)
	assert.Equal(t, 3, status.AvailableChances)
	assert.Equal(t, 100*100, status.WeeklyTargetQuota)
	assert.Equal(t, 1, status.WeeklyEarnedChances)
	assert.Equal(t, 2, status.CurrentStreak)
	assert.Equal(t, config.Rules, status.Rules)
}

func TestLotteryRechargeGrantIsIdempotent(t *testing.T) {
	userId, now := setupLotteryTest(t)
	config := defaultLotteryConfig()
	config.GrantRules = []LotteryChanceGrantRule{{
		Id: "recharge-festival", Type: LotteryChanceGrantRuleRecharge,
		Name: "Recharge festival", Enabled: true, Threshold: 50, Chances: 2,
		StartAt: now.Add(-time.Hour).Unix(), EndAt: now.Add(72 * time.Hour).Unix(),
	}}
	setLotteryConfigForTest(t, config)
	topUp := TopUp{
		UserId: userId, Amount: 100, Money: 100,
		TradeNo: "lottery-recharge", Status: common.TopUpStatusSuccess,
		CreateTime: now.Add(-time.Minute).Unix(), CompleteTime: now.Unix(),
	}
	require.NoError(t, DB.Create(&topUp).Error)

	status, err := getLotteryStatusAt(userId, now)
	require.NoError(t, err)
	assert.Equal(t, 2, status.AvailableChances)
	repeated, err := getLotteryStatusAt(userId, now.Add(24*time.Hour))
	require.NoError(t, err)
	assert.Equal(t, 2, repeated.AvailableChances)
	var count int64
	require.NoError(t, DB.Model(&LotteryChanceGrant{}).
		Where("event_key = ?", fmt.Sprintf("recharge:recharge-festival:topup:%d", topUp.Id)).
		Count(&count).Error)
	assert.EqualValues(t, 1, count)
}

func TestRechargeCreatesLotteryGrantImmediately(t *testing.T) {
	userId, now := setupLotteryTest(t)
	ruleNow := time.Now()
	config := defaultLotteryConfig()
	config.GrantRules = []LotteryChanceGrantRule{{
		Id: "recharge-immediate", Type: LotteryChanceGrantRuleRecharge,
		Name: "Immediate recharge grant", Enabled: true, Threshold: 50, Chances: 2,
		StartAt: ruleNow.Add(-time.Hour).Unix(), EndAt: ruleNow.Add(time.Hour).Unix(),
	}}
	setLotteryConfigForTest(t, config)
	topUp := TopUp{
		UserId: userId, Amount: 50, Money: 50,
		TradeNo: "lottery-recharge-immediate", PaymentMethod: "alipay",
		PaymentProvider: PaymentProviderEpay, Status: common.TopUpStatusPending,
		CreateTime: now.Add(-time.Minute).Unix(),
	}
	require.NoError(t, DB.Create(&topUp).Error)

	oldQuotaPerUnit := common.QuotaPerUnit
	common.QuotaPerUnit = 100
	t.Cleanup(func() { common.QuotaPerUnit = oldQuotaPerUnit })
	_, err := RechargeEpay(topUp.TradeNo, "alipay", "127.0.0.1")
	require.NoError(t, err)

	var grant LotteryChanceGrant
	require.NoError(t, DB.Where(
		"event_key = ?",
		fmt.Sprintf("recharge:recharge-immediate:topup:%d", topUp.Id),
	).First(&grant).Error)
	assert.Equal(t, 2, grant.Chances)
	assert.Equal(t, "Immediate recharge grant", grant.SourceName)
}

func TestRechargeGrantUsesCreditedRechargeAmountBeforeDiscount(t *testing.T) {
	userId, now := setupLotteryTest(t)
	ruleNow := time.Now()
	config := defaultLotteryConfig()
	config.GrantRules = []LotteryChanceGrantRule{{
		Id: "discounted-recharge", Type: LotteryChanceGrantRuleRecharge,
		Name: "Discounted recharge", Enabled: true, Threshold: 50, Chances: 2,
		StartAt: ruleNow.Add(-time.Hour).Unix(), EndAt: ruleNow.Add(time.Hour).Unix(),
	}}
	setLotteryConfigForTest(t, config)
	topUp := TopUp{
		UserId: userId, Amount: 50, Money: 45,
		TradeNo: "lottery-recharge-discounted", PaymentMethod: "alipay",
		PaymentProvider: PaymentProviderEpay, Status: common.TopUpStatusPending,
		CreateTime: now.Add(-time.Minute).Unix(),
	}
	require.NoError(t, DB.Create(&topUp).Error)

	_, err := RechargeEpay(topUp.TradeNo, "alipay", "127.0.0.1")
	require.NoError(t, err)
	var grant LotteryChanceGrant
	require.NoError(t, DB.Where("type = ?", "recharge_discounted-recharge").First(&grant).Error)
	assert.Equal(t, 2, grant.Chances)
}

func TestCompletedRechargeCallbackRepairsMissingGrant(t *testing.T) {
	userId, now := setupLotteryTest(t)
	ruleNow := time.Now()
	config := defaultLotteryConfig()
	config.GrantRules = []LotteryChanceGrantRule{{
		Id: "callback-recovery", Type: LotteryChanceGrantRuleRecharge,
		Name: "Callback recovery", Enabled: true, Threshold: 50, Chances: 1,
		StartAt: ruleNow.Add(-time.Hour).Unix(), EndAt: ruleNow.Add(time.Hour).Unix(),
	}}
	setLotteryConfigForTest(t, config)
	topUp := TopUp{
		UserId: userId, Amount: 50, Money: 45,
		TradeNo: "lottery-recharge-recovery", PaymentMethod: "alipay",
		PaymentProvider: PaymentProviderEpay, Status: common.TopUpStatusSuccess,
		CreateTime: now.Add(-time.Minute).Unix(), CompleteTime: ruleNow.Unix(),
	}
	require.NoError(t, DB.Create(&topUp).Error)

	alreadyDone, err := RechargeEpay(topUp.TradeNo, "alipay", "127.0.0.1")
	require.NoError(t, err)
	assert.True(t, alreadyDone)
	var count int64
	require.NoError(t, DB.Model(&LotteryChanceGrant{}).
		Where("type = ?", "recharge_callback-recovery").Count(&count).Error)
	assert.EqualValues(t, 1, count)
}

func TestGetAllLotteryGrantsSupportsAdminFilters(t *testing.T) {
	userId, now := setupLotteryTest(t)
	config := defaultLotteryConfig()
	config.GrantRules = []LotteryChanceGrantRule{{
		Id: "admin-recharge", Type: LotteryChanceGrantRuleRecharge,
		Name: "Admin recharge campaign", Enabled: true, Threshold: 50, Chances: 2,
	}}
	setLotteryConfigForTest(t, config)
	require.NoError(t, DB.Create(&[]LotteryChanceGrant{
		{EventKey: "grant-admin-recharge", UserId: userId, Type: "recharge_admin-recharge", Chances: 2, CreatedAt: now.Unix()},
		{EventKey: "grant-admin-used", UserId: userId, Type: LotteryGrantTypeWeeklySpend, Chances: 1, Consumed: 1, CreatedAt: now.Add(-time.Minute).Unix()},
		{EventKey: "grant-admin-expired", UserId: userId, Type: "campaign_old", Chances: 3, ExpiresAt: now.Add(-time.Hour).Unix(), CreatedAt: now.Add(-2 * time.Minute).Unix()},
	}).Error)

	page, err := GetAllLotteryGrants(1, 20, LotteryGrantFilter{
		UserKeyword: "lottery-user", Source: "recharge", Status: "available",
	})
	require.NoError(t, err)
	require.Len(t, page.Items, 1)
	assert.EqualValues(t, 1, page.Total)
	assert.Equal(t, "Admin recharge campaign", page.Items[0].SourceName)
	assert.Equal(t, "grant-admin-recharge", page.Items[0].EventReference)

	expired, err := GetAllLotteryGrants(1, 20, LotteryGrantFilter{Status: "expired"})
	require.NoError(t, err)
	require.Len(t, expired.Items, 1)
	assert.Equal(t, "campaign_old", expired.Items[0].Type)
}

func TestCreateManualLotteryGrantIsAuditedAndIdempotent(t *testing.T) {
	userId, _ := setupLotteryTest(t)
	operator := User{
		Id: 62, Username: "lottery-admin", AffCode: "lottery_admin_aff",
		Status: common.UserStatusEnabled, Role: common.RoleAdminUser,
	}
	require.NoError(t, DB.Create(&operator).Error)
	expiresAt := time.Now().Add(24 * time.Hour).Unix()

	grant, err := CreateManualLotteryGrant("lottery-user", 3, "repair missed recharge grant", expiresAt, operator.Id, "manual-request-001")
	require.NoError(t, err)
	assert.Equal(t, userId, grant.UserId)
	assert.Equal(t, LotteryGrantTypeManual, grant.Type)
	assert.Equal(t, LotteryGrantSourceManual, grant.SourceName)
	assert.Equal(t, operator.Id, grant.OperatorUserId)
	assert.Equal(t, "repair missed recharge grant", grant.Detail)

	repeated, err := CreateManualLotteryGrant(strconv.Itoa(userId), 3, "repair missed recharge grant", expiresAt, operator.Id, "manual-request-001")
	require.NoError(t, err)
	assert.Equal(t, grant.Id, repeated.Id)
	var count int64
	require.NoError(t, DB.Model(&LotteryChanceGrant{}).Where("type = ?", LotteryGrantTypeManual).Count(&count).Error)
	assert.EqualValues(t, 1, count)

	page, err := GetAllLotteryGrants(1, 20, LotteryGrantFilter{Source: "manual"})
	require.NoError(t, err)
	require.Len(t, page.Items, 1)
	assert.Equal(t, operator.Id, page.Items[0].OperatorUserId)
	assert.Equal(t, "repair missed recharge grant", page.Items[0].Detail)

	numericUsername := User{
		Id: 63, Username: "123456", AffCode: "numeric_username_aff",
		Status: common.UserStatusEnabled,
	}
	require.NoError(t, DB.Create(&numericUsername).Error)
	numericGrant, err := CreateManualLotteryGrant("123456", 1, "补发遗漏机会", 0, operator.Id, "manual-request-006")
	require.NoError(t, err)
	assert.Equal(t, numericUsername.Id, numericGrant.UserId)
}

func TestCreateManualLotteryGrantRejectsInvalidOrUnknownTargets(t *testing.T) {
	_, _ = setupLotteryTest(t)
	testCases := []struct {
		name      string
		user      string
		chances   int
		reason    string
		expiresAt int64
		requestId string
		expected  error
	}{
		{name: "unknown user", user: "missing-user", chances: 1, reason: "manual repair", requestId: "manual-request-002", expected: ErrLotteryGrantTargetNotFound},
		{name: "zero chances", user: "lottery-user", chances: 0, reason: "manual repair", requestId: "manual-request-003", expected: ErrInvalidLotteryManualGrant},
		{name: "missing reason", user: "lottery-user", chances: 1, reason: " ", requestId: "manual-request-004", expected: ErrInvalidLotteryManualGrant},
		{name: "expired grant", user: "lottery-user", chances: 1, reason: "manual repair", expiresAt: time.Now().Add(-time.Hour).Unix(), requestId: "manual-request-005", expected: ErrInvalidLotteryManualGrant},
	}
	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			_, err := CreateManualLotteryGrant(testCase.user, testCase.chances, testCase.reason, testCase.expiresAt, 99, testCase.requestId)
			assert.ErrorIs(t, err, testCase.expected)
		})
	}
}

func TestLotteryRechargeGrantDoesNotRewardSplitPaymentsTwice(t *testing.T) {
	userId, now := setupLotteryTest(t)
	config := defaultLotteryConfig()
	config.GrantRules = []LotteryChanceGrantRule{{
		Id: "recharge-split", Type: LotteryChanceGrantRuleRecharge,
		Name: "Recharge split", Enabled: true, Threshold: 100, Chances: 1,
		StartAt: now.Add(-time.Hour).Unix(), EndAt: now.Add(72 * time.Hour).Unix(),
	}}
	setLotteryConfigForTest(t, config)
	for index := 0; index < 2; index++ {
		topUp := TopUp{
			UserId: userId, Amount: 50, Money: 50,
			TradeNo: fmt.Sprintf("lottery-split-%d", index), Status: common.TopUpStatusSuccess,
			CreateTime: now.Add(-time.Duration(index+1) * time.Minute).Unix(), CompleteTime: now.Unix(),
		}
		require.NoError(t, DB.Create(&topUp).Error)
	}

	status, err := getLotteryStatusAt(userId, now)
	require.NoError(t, err)
	assert.Equal(t, 1, status.AvailableChances)
	var count int64
	require.NoError(t, DB.Model(&LotteryChanceGrant{}).
		Where("user_id = ? AND type = ?", userId, "recharge_recharge-split").
		Count(&count).Error)
	assert.EqualValues(t, 1, count)
}

func TestLotteryDailyRechargeGrantIsScopedPerUserAndIdempotent(t *testing.T) {
	firstUserId, now := setupLotteryTest(t)
	secondUser := User{
		Id: 62, Username: "lottery-user-two", AffCode: "lottery_aff_two",
		Status: common.UserStatusEnabled, Quota: 1000,
	}
	require.NoError(t, DB.Create(&secondUser).Error)
	config := defaultLotteryConfig()
	config.GrantRules = []LotteryChanceGrantRule{{
		Id: "recharge-daily", Type: LotteryChanceGrantRuleRecharge,
		Name: "Daily recharge", Enabled: true, Threshold: 50,
		Limit: LotteryRechargeGrantDaily, Chances: 1,
		StartAt: now.Add(-time.Hour).Unix(), EndAt: now.Add(72 * time.Hour).Unix(),
	}}
	setLotteryConfigForTest(t, config)
	for _, userId := range []int{firstUserId, secondUser.Id} {
		for index := 0; index < 2; index++ {
			require.NoError(t, DB.Create(&TopUp{
				UserId: userId, Amount: 25, Money: 25,
				TradeNo:      fmt.Sprintf("lottery-daily-%d-%d", userId, index),
				Status:       common.TopUpStatusSuccess,
				CreateTime:   now.Add(-time.Duration(index+1) * time.Minute).Unix(),
				CompleteTime: now.Unix(),
			}).Error)
		}
	}

	for _, userId := range []int{firstUserId, secondUser.Id} {
		status, err := getLotteryStatusAt(userId, now)
		require.NoError(t, err)
		assert.Equal(t, 1, status.AvailableChances)
		repeated, err := getLotteryStatusAt(userId, now)
		require.NoError(t, err)
		assert.Equal(t, 1, repeated.AvailableChances)

		var count int64
		eventKey := fmt.Sprintf(
			"recharge:recharge-daily:day:%s:user:%d",
			now.Format("2006-01-02"), userId,
		)
		require.NoError(t, DB.Model(&LotteryChanceGrant{}).
			Where("event_key = ? AND user_id = ?", eventKey, userId).
			Count(&count).Error)
		assert.EqualValues(t, 1, count)
	}
}

func TestLotteryDailyRechargeGrantPreservesLegacyRecipient(t *testing.T) {
	userId, now := setupLotteryTest(t)
	config := defaultLotteryConfig()
	config.GrantRules = []LotteryChanceGrantRule{{
		Id: "recharge-daily-legacy", Type: LotteryChanceGrantRuleRecharge,
		Name: "Daily recharge legacy", Enabled: true, Threshold: 50,
		Limit: LotteryRechargeGrantDaily, Chances: 1,
		StartAt: now.Add(-time.Hour).Unix(), EndAt: now.Add(72 * time.Hour).Unix(),
	}}
	setLotteryConfigForTest(t, config)
	require.NoError(t, DB.Create(&TopUp{
		UserId: userId, Amount: 50, Money: 50,
		TradeNo: "lottery-daily-legacy", Status: common.TopUpStatusSuccess,
		CreateTime: now.Add(-time.Minute).Unix(), CompleteTime: now.Unix(),
	}).Error)
	legacyEventKey := fmt.Sprintf(
		"recharge:recharge-daily-legacy:day:%s", now.Format("2006-01-02"),
	)
	require.NoError(t, DB.Create(&LotteryChanceGrant{
		EventKey: legacyEventKey, UserId: userId,
		Type: "recharge_recharge-daily-legacy", Chances: 1,
		CreatedAt: now.Add(-time.Minute).Unix(),
	}).Error)

	status, err := getLotteryStatusAt(userId, now)
	require.NoError(t, err)
	assert.Equal(t, 1, status.AvailableChances)
	var grants []LotteryChanceGrant
	require.NoError(t, DB.Where(
		"user_id = ? AND type = ?", userId, "recharge_recharge-daily-legacy",
	).Find(&grants).Error)
	require.Len(t, grants, 1)
	assert.Equal(t, legacyEventKey, grants[0].EventKey)
	assert.Equal(t, config.GrantRules[0].EndAt, grants[0].ExpiresAt)
}

func TestLotteryUnlimitedRechargeGrantRewardsEveryQualifyingTopUp(t *testing.T) {
	userId, now := setupLotteryTest(t)
	config := defaultLotteryConfig()
	config.GrantRules = []LotteryChanceGrantRule{{
		Id: "recharge-unlimited", Type: LotteryChanceGrantRuleRecharge,
		Name: "Unlimited recharge", Enabled: true, Threshold: 50,
		Limit: LotteryRechargeGrantUnlimited, Chances: 2,
		StartAt: now.Add(-time.Hour).Unix(), EndAt: now.Add(72 * time.Hour).Unix(),
	}}
	setLotteryConfigForTest(t, config)
	for index, amount := range []int64{50, 49, 100} {
		require.NoError(t, DB.Create(&TopUp{
			UserId: userId, Amount: amount, Money: float64(amount),
			TradeNo:      fmt.Sprintf("lottery-unlimited-%d", index),
			Status:       common.TopUpStatusSuccess,
			CreateTime:   now.Add(-time.Duration(index+1) * time.Minute).Unix(),
			CompleteTime: now.Unix(),
		}).Error)
	}

	status, err := getLotteryStatusAt(userId, now)
	require.NoError(t, err)
	assert.Equal(t, 4, status.AvailableChances)
	repeated, err := getLotteryStatusAt(userId, now)
	require.NoError(t, err)
	assert.Equal(t, 4, repeated.AvailableChances)
	var count int64
	require.NoError(t, DB.Model(&LotteryChanceGrant{}).
		Where("user_id = ? AND type = ?", userId, "recharge_recharge-unlimited").
		Count(&count).Error)
	assert.EqualValues(t, 2, count)
}

func TestLotteryEventGrantIsClaimedOncePerUser(t *testing.T) {
	userId, now := setupLotteryTest(t)
	config := defaultLotteryConfig()
	config.GrantRules = []LotteryChanceGrantRule{{
		Id: "spring-festival", Type: LotteryChanceGrantRuleEvent,
		Name: "Spring festival", Enabled: true, Chances: 3,
		StartAt: now.Add(-time.Hour).Unix(), EndAt: now.Add(72 * time.Hour).Unix(),
	}}
	setLotteryConfigForTest(t, config)

	status, err := getLotteryStatusAt(userId, now)
	require.NoError(t, err)
	assert.Equal(t, 3, status.AvailableChances)
	repeated, err := getLotteryStatusAt(userId, now.Add(24*time.Hour))
	require.NoError(t, err)
	assert.Equal(t, 3, repeated.AvailableChances)
	require.Len(t, repeated.ActiveGrantRules, 1)
	var count int64
	require.NoError(t, DB.Model(&LotteryChanceGrant{}).
		Where("event_key = ?", fmt.Sprintf("campaign:spring-festival:user:%d", userId)).
		Count(&count).Error)
	assert.EqualValues(t, 1, count)
}

func TestLotteryEventGrantCanReclaimUnusedChances(t *testing.T) {
	userId, now := setupLotteryTest(t)
	config := defaultLotteryConfig()
	config.GrantRules = []LotteryChanceGrantRule{{
		Id: "reclaim-event", Type: LotteryChanceGrantRuleEvent,
		Name: "Reclaim event", Enabled: true, Chances: 1, Reclaim: true,
		StartAt: now.Add(-time.Hour).Unix(), EndAt: now.Add(time.Hour).Unix(),
	}}
	setLotteryConfigForTest(t, config)
	status, err := getLotteryStatusAt(userId, now)
	require.NoError(t, err)
	assert.Equal(t, 1, status.AvailableChances)
	expired, err := getLotteryStatusAt(userId, now.Add(2*time.Hour))
	require.NoError(t, err)
	assert.Equal(t, 0, expired.AvailableChances)
}

func TestLotteryDrawConsumesChanceAndCreditsPrize(t *testing.T) {
	userId, now := setupLotteryTest(t)
	addLotteryConsumeLog(t, userId, now, 50*100)

	result, err := drawLotteryAt(userId, now, 50)
	require.NoError(t, err)
	assert.Equal(t, LotteryPrizeFive, result.Draw.Prize)
	assert.Equal(t, 5*100, result.Draw.Quota)
	assert.Equal(t, LotteryDrawStatusAwarded, result.Draw.Status)
	assert.Zero(t, result.Status.AvailableChances)

	var user User
	require.NoError(t, DB.First(&user, userId).Error)
	assert.Equal(t, 1500, user.Quota)
	var transaction BillingTransaction
	require.NoError(t, DB.Where(
		"event_key = ?", result.Draw.EventKey,
	).First(&transaction).Error)
	assert.Equal(t, BillingTypeLottery, transaction.Type)
	assert.Equal(t, 5*100, transaction.Quota)

	_, err = drawLotteryAt(userId, now, 0)
	assert.ErrorIs(t, err, ErrNoLotteryChances)
}

func TestLotteryDrawRejectsWalletOverflowWithoutConsumingChance(t *testing.T) {
	userId, now := setupLotteryTest(t)
	addLotteryConsumeLog(t, userId, now, 50*100)
	require.NoError(t, DB.Model(&User{}).Where("id = ?", userId).
		Update("quota", common.MaxWalletQuota).Error)

	_, err := drawLotteryAt(userId, now, 50)
	require.ErrorIs(t, err, ErrTopUpQuotaLimitExceeded)

	var user User
	require.NoError(t, DB.First(&user, userId).Error)
	assert.Equal(t, common.MaxWalletQuota, user.Quota)
	var drawCount int64
	require.NoError(t, DB.Model(&LotteryDraw{}).Where("user_id = ?", userId).Count(&drawCount).Error)
	assert.Zero(t, drawCount)
	status, err := getLotteryStatusAt(userId, now)
	require.NoError(t, err)
	assert.Equal(t, 1, status.AvailableChances)
}

func TestLotteryNoPrizeStillConsumesExactlyOneChance(t *testing.T) {
	userId, now := setupLotteryTest(t)
	addLotteryConsumeLog(t, userId, now, 100*100)

	result, err := drawLotteryAt(userId, now, 99)
	require.NoError(t, err)
	assert.Equal(t, LotteryPrizeNone, result.Draw.Prize)
	assert.Zero(t, result.Draw.Quota)
	assert.Equal(t, 1, result.Status.AvailableChances)

	var user User
	require.NoError(t, DB.First(&user, userId).Error)
	assert.Equal(t, 1000, user.Quota)
	var transactionCount int64
	require.NoError(t, DB.Model(&BillingTransaction{}).
		Where("event_key = ?", result.Draw.EventKey).
		Count(&transactionCount).Error)
	assert.Zero(t, transactionCount)
}

func TestLotteryRewardReversalIsTraceableAndIdempotent(t *testing.T) {
	userId, now := setupLotteryTest(t)
	addLotteryConsumeLog(t, userId, now, 50*100)
	result, err := drawLotteryAt(userId, now, 50)
	require.NoError(t, err)
	require.NoError(t, DB.Model(&User{}).Where("id = ?", userId).Update("quota", 100).Error)

	require.NoError(t, RevokeLotteryReward(result.Draw.Id, 99, "fraud review"))
	var user User
	require.NoError(t, DB.First(&user, userId).Error)
	assert.Equal(t, -400, user.Quota)
	var draw LotteryDraw
	require.NoError(t, DB.First(&draw, result.Draw.Id).Error)
	assert.Equal(t, LotteryDrawStatusRevoked, draw.Status)
	assert.Equal(t, 99, draw.RevokedBy)
	assert.Equal(t, "fraud review", draw.RevokeReason)
	assert.Positive(t, draw.RevokedAt)

	var reversal BillingTransaction
	require.NoError(t, DB.Where("event_key = ?", "lottery-reversal:"+strconv.FormatInt(draw.Id, 10)).First(&reversal).Error)
	assert.Equal(t, BillingTypeLotteryReversal, reversal.Type)
	assert.Equal(t, -result.Draw.Quota, reversal.Quota)
	assert.Equal(t, result.Draw.EventKey, reversal.Reference)
	assert.Equal(t, 99, reversal.OperatorUserId)
	history, total, _, _, err := GetBillingHistoryWithTypeStats(BillingHistoryFilter{
		UserId: userId, Types: []string{BillingTypeLotteryReversal},
		PageInfo: &common.PageInfo{Page: 1, PageSize: 10},
	})
	require.NoError(t, err)
	assert.EqualValues(t, 1, total)
	require.Len(t, history, 1)
	assert.Equal(t, result.Draw.EventKey, history[0].Reference)
	assert.Equal(t, -result.Draw.Quota, history[0].Quota)

	err = RevokeLotteryReward(result.Draw.Id, 99, "repeat")
	assert.ErrorIs(t, err, ErrLotteryDrawAlreadyRevoked)
	require.NoError(t, DB.First(&user, userId).Error)
	assert.Equal(t, -400, user.Quota)
}

func TestUserLotteryDrawsArePaginated(t *testing.T) {
	userId, now := setupLotteryTest(t)
	for index := 1; index <= 3; index++ {
		require.NoError(t, DB.Create(&LotteryDraw{
			EventKey: common.GetUUID(), UserId: userId,
			Prize: LotteryPrizeOne, Quota: 100,
			Status:    LotteryDrawStatusAwarded,
			CreatedAt: now.Unix() + int64(index),
		}).Error)
	}
	page, err := GetUserLotteryDraws(userId, 2, 2)
	require.NoError(t, err)
	assert.EqualValues(t, 3, page.Total)
	require.Len(t, page.Items, 1)
	assert.Equal(t, now.Unix()+1, page.Items[0].CreatedAt)
}

func TestLotteryStreakRemainsVisibleBeforeTodayBecomesActive(t *testing.T) {
	userId, _ := setupLotteryTest(t)
	for offset := 0; offset < 3; offset++ {
		addLotteryConsumeLog(
			t,
			userId,
			time.Date(
				2026, time.August, 10+offset, 15, 0, 0, 0, time.Local,
			),
			20*100,
		)
	}
	now := time.Date(
		2026, time.August, 13, 9, 0, 0, 0, time.Local,
	)
	status, err := getLotteryStatusAt(userId, now)
	require.NoError(t, err)
	assert.False(t, status.TodayActive)
	assert.Equal(t, 3, status.CurrentStreak)
}

func TestLotteryPrizeRollBoundaries(t *testing.T) {
	prizes := lotteryPrizePool()
	tests := []struct {
		roll  int
		prize string
	}{
		{0, LotteryPrizeOne},
		{49, LotteryPrizeOne},
		{50, LotteryPrizeFive},
		{69, LotteryPrizeFive},
		{70, LotteryPrizeEight},
		{74, LotteryPrizeEight},
		{75, LotteryPrizeNone},
		{99, LotteryPrizeNone},
	}
	for _, test := range tests {
		assert.Equal(t, test.prize, lotteryPrizeForRoll(test.roll, prizes).Type)
	}
}

func TestLotteryPrizePoolCanBeConfigured(t *testing.T) {
	setupLotteryTest(t)
	prizes := []LotteryPrize{
		{Type: LotteryPrizeOne, Amount: 2, Probability: 10},
		{Type: LotteryPrizeFive, Amount: 6, Probability: 20},
		{Type: LotteryPrizeEight, Amount: 10, Probability: 30},
		{Type: LotteryPrizeNone, Probability: 40},
	}
	setLotteryPrizePoolForTest(t, prizes)
	assert.Equal(t, 2, lotteryPrizeForRoll(0, GetLotteryPrizePool()).Amount)
	assert.Equal(t, 6, lotteryPrizeForRoll(10, GetLotteryPrizePool()).Amount)
	assert.Equal(t, 10, lotteryPrizeForRoll(30, GetLotteryPrizePool()).Amount)
	assert.Equal(t, LotteryPrizeNone, lotteryPrizeForRoll(99, GetLotteryPrizePool()).Type)
}

func TestLotteryPrizePoolRejectsInvalidProbabilityTotal(t *testing.T) {
	prizes := lotteryPrizePool()
	prizes[0].Probability = 49
	assert.Error(t, validateLotteryPrizePool(prizes))
}

func TestGetAllLotteryDrawsIncludesUser(t *testing.T) {
	userId, now := setupLotteryTest(t)
	require.NoError(t, DB.Create(&LotteryDraw{
		EventKey: common.GetUUID(), UserId: userId, Prize: LotteryPrizeFive,
		Quota: 500, CreatedAt: now.Unix(),
	}).Error)

	page, err := GetAllLotteryDraws(1, 20, LotteryDrawFilter{})
	require.NoError(t, err)
	require.Len(t, page.Items, 1)
	assert.Equal(t, userId, page.Items[0].UserId)
	assert.Equal(t, "lottery-user", page.Items[0].Username)
	assert.EqualValues(t, 1, page.Total)

	filtered, err := GetAllLotteryDraws(1, 20, LotteryDrawFilter{
		UserKeyword: "lottery-user",
		Result:      "won",
	})
	require.NoError(t, err)
	require.Len(t, filtered.Items, 1)
	assert.Equal(t, page.Items[0].Id, filtered.Items[0].Id)

	empty, err := GetAllLotteryDraws(1, 20, LotteryDrawFilter{Result: "none"})
	require.NoError(t, err)
	assert.Empty(t, empty.Items)
}
