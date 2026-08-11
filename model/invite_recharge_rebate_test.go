package model

import (
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func enablePaymentComplianceForInviteRebateTest(t *testing.T) {
	t.Helper()
	paymentSetting := operation_setting.GetPaymentSetting()
	originalConfirmed := paymentSetting.ComplianceConfirmed
	originalTermsVersion := paymentSetting.ComplianceTermsVersion
	t.Cleanup(func() {
		paymentSetting.ComplianceConfirmed = originalConfirmed
		paymentSetting.ComplianceTermsVersion = originalTermsVersion
	})
	paymentSetting.ComplianceConfirmed = true
	paymentSetting.ComplianceTermsVersion = operation_setting.CurrentComplianceTermsVersion
}

func configureInviteRechargeRebateForTest(t *testing.T, ratio float64, quotaPerUnit float64) {
	t.Helper()
	originalRatio := common.InviteRechargeRebateRatio
	originalQuotaPerUnit := common.QuotaPerUnit
	t.Cleanup(func() {
		common.InviteRechargeRebateRatio = originalRatio
		common.QuotaPerUnit = originalQuotaPerUnit
	})
	common.InviteRechargeRebateRatio = ratio
	common.QuotaPerUnit = quotaPerUnit
}

func insertInviteRebateUser(t *testing.T, id int, username string, inviterId int) {
	t.Helper()
	require.NoError(t, DB.Create(&User{
		Id:        id,
		Username:  username,
		Status:    common.UserStatusEnabled,
		AffCode:   username + "_aff",
		InviterId: inviterId,
	}).Error)
}

func insertInviteRebateTopUp(t *testing.T, tradeNo string, userId int, amount int64) {
	t.Helper()
	require.NoError(t, DB.Create(&TopUp{
		UserId:          userId,
		Amount:          amount,
		Money:           float64(amount),
		TradeNo:         tradeNo,
		PaymentMethod:   "alipay",
		PaymentProvider: PaymentProviderEpay,
		CreateTime:      time.Now().Unix(),
		Status:          common.TopUpStatusPending,
	}).Error)
}

func getInviteRebateUser(t *testing.T, id int) User {
	t.Helper()
	var user User
	require.NoError(t, DB.Where("id = ?", id).First(&user).Error)
	return user
}

func TestInviteRechargeRebate_FirstTopUpOnly(t *testing.T) {
	truncateTables(t)
	enablePaymentComplianceForInviteRebateTest(t)
	configureInviteRechargeRebateForTest(t, 0.2, 100)

	insertInviteRebateUser(t, 1, "rebate_inviter", 0)
	insertInviteRebateUser(t, 2, "rebate_invitee", 1)
	insertInviteRebateTopUp(t, "rebate-first", 2, 10)

	_, err := RechargeEpay("rebate-first", "alipay", "127.0.0.1")
	require.NoError(t, err)

	invitee := getInviteRebateUser(t, 2)
	inviter := getInviteRebateUser(t, 1)
	assert.Equal(t, 1000, invitee.Quota)
	assert.Equal(t, 200, inviter.AffQuota)
	assert.Equal(t, 200, inviter.AffHistoryQuota)
	var rewardCount int64
	require.NoError(t, DB.Model(&AffiliateReward{}).Where("inviter_id = ?", 1).Count(&rewardCount).Error)
	assert.EqualValues(t, 1, rewardCount)

	insertInviteRebateTopUp(t, "rebate-second", 2, 20)
	_, err = RechargeEpay("rebate-second", "alipay", "127.0.0.1")
	require.NoError(t, err)

	invitee = getInviteRebateUser(t, 2)
	inviter = getInviteRebateUser(t, 1)
	assert.Equal(t, 3000, invitee.Quota)
	assert.Equal(t, 200, inviter.AffQuota)
	assert.Equal(t, 200, inviter.AffHistoryQuota)
	require.NoError(t, DB.Model(&AffiliateReward{}).Where("inviter_id = ?", 1).Count(&rewardCount).Error)
	assert.EqualValues(t, 1, rewardCount)
}

func TestInviteRechargeRebate_NoInviterNoRebate(t *testing.T) {
	truncateTables(t)
	enablePaymentComplianceForInviteRebateTest(t)
	configureInviteRechargeRebateForTest(t, 0.5, 100)

	insertInviteRebateUser(t, 3, "rebate_solo", 0)
	insertInviteRebateTopUp(t, "rebate-solo-first", 3, 10)

	_, err := RechargeEpay("rebate-solo-first", "alipay", "127.0.0.1")
	require.NoError(t, err)

	user := getInviteRebateUser(t, 3)
	assert.Equal(t, 1000, user.Quota)
	assert.Zero(t, user.AffQuota)
	assert.Zero(t, user.AffHistoryQuota)
}
