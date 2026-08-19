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
