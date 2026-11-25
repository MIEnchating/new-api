package service

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/gin-gonic/gin"
)

const (
	BillingSourceWallet       = "wallet"
	BillingSourceSubscription = "subscription"
)

// PreConsumeBilling 根据用户计费偏好创建 BillingSession 并执行预扣费。
// 会话存储在 relayInfo.Billing 上，供后续 Settle / Refund 使用。
// 会话已存在时（任务重试换到另一个渠道）把预扣补到 preConsumedQuota，
// 和首次预扣一样必须由余额覆盖。
func PreConsumeBilling(c *gin.Context, preConsumedQuota int, relayInfo *relaycommon.RelayInfo) *types.NewAPIError {
	if relayInfo != nil && relayInfo.QuotaClamp != nil {
		return types.NewErrorWithStatusCode(
			relayInfo.QuotaClamp,
			types.ErrorCodeModelPriceError,
			http.StatusBadRequest,
			types.ErrOptionWithSkipRetry(),
		)
	}
	if preConsumedQuota < 0 {
		return types.NewErrorWithStatusCode(
			fmt.Errorf("pre-consume quota cannot be negative: %d", preConsumedQuota),
			types.ErrorCodeModelPriceError,
			http.StatusBadRequest,
			types.ErrOptionWithSkipRetry(),
		)
	}
	if relayInfo != nil && relayInfo.Billing != nil {
		if err := relayInfo.Billing.ReserveBeforeSubmit(preConsumedQuota); err != nil {
			var apiErr *types.NewAPIError
			if errors.As(err, &apiErr) {
				return apiErr
			}
			return types.NewErrorWithStatusCode(err, types.ErrorCodeInsufficientUserQuota, http.StatusForbidden, types.ErrOptionWithSkipRetry())
		}
		return nil
	}
	session, apiErr := NewBillingSession(c, relayInfo, preConsumedQuota)
	if apiErr != nil {
		return apiErr
	}
	relayInfo.Billing = session
	return nil
}

// ---------------------------------------------------------------------------
// SettleBilling — 后结算辅助函数
// ---------------------------------------------------------------------------

// SettleBilling 执行计费结算。如果 RelayInfo 上有 BillingSession 则通过 session 结算，
// 否则回退到旧的 PostConsumeQuota 路径（兼容按次计费等场景）。
func SettleBilling(ctx *gin.Context, relayInfo *relaycommon.RelayInfo, actualQuota int) error {
	var chargeKey string
	if relayInfo.RequestId != "" {
		chargeKey = "request:" + relayInfo.RequestId
	}
	return settleBilling(ctx, relayInfo, actualQuota, chargeKey)
}

// SettleTaskSubmissionBilling defers the referral reward for pending tasks
// until polling finalizes the charge. Immediate successes settle here.
func SettleTaskSubmissionBilling(ctx *gin.Context, relayInfo *relaycommon.RelayInfo, task *model.Task, actualQuota int) error {
	var chargeKey string
	if task.Status == model.TaskStatusSuccess && task.TaskID != "" {
		chargeKey = "task:" + task.TaskID
	}
	return settleBilling(ctx, relayInfo, actualQuota, chargeKey)
}

func settleBilling(ctx *gin.Context, relayInfo *relaycommon.RelayInfo, actualQuota int, chargeKey string) error {
	if relayInfo.Billing != nil {
		preConsumed := relayInfo.Billing.GetPreConsumedQuota()
		delta := actualQuota - preConsumed

		if delta > 0 {
			logger.LogInfo(ctx, common.LogText("charging the difference after pre-consume: %s (actual %s, pre-consumed %s)",
				logger.FormatQuota(delta),
				logger.FormatQuota(actualQuota),
				logger.FormatQuota(preConsumed),
			))
		} else if delta < 0 {
			logger.LogInfo(ctx, common.LogText("refunding the difference after pre-consume: %s (actual %s, pre-consumed %s)",
				logger.FormatQuota(-delta),
				logger.FormatQuota(actualQuota),
				logger.FormatQuota(preConsumed),
			))
		} else {
			logger.LogInfo(ctx, common.LogText("pre-consumed quota matches the actual quota, no adjustment: %s (per-request billing)",
				logger.FormatQuota(actualQuota),
			))
		}

		settledQuota := actualQuota
		var err error
		if session, ok := relayInfo.Billing.(*BillingSession); ok {
			settledQuota, err = session.settleCharge(actualQuota)
		} else if err = relayInfo.Billing.Settle(actualQuota); err != nil {
			settledQuota = 0
		}
		if relayInfo.BillingSource != BillingSourceSubscription {
			recordWalletUsageReward(ctx, relayInfo.UserId, chargeKey, settledQuota)
		}
		if err != nil {
			return err
		}

		// 发送额度通知（订阅计费使用订阅剩余额度）
		if actualQuota != 0 {
			if relayInfo.BillingSource == BillingSourceSubscription {
				checkAndSendSubscriptionQuotaNotify(relayInfo)
			} else {
				checkAndSendQuotaNotify(relayInfo, actualQuota-preConsumed, preConsumed)
			}
		}
		return nil
	}

	// 回退：无 BillingSession 时使用旧路径
	quotaDelta := actualQuota - relayInfo.FinalPreConsumedQuota
	if quotaDelta != 0 {
		result, err := postConsumeQuotaWithResult(relayInfo, quotaDelta, relayInfo.FinalPreConsumedQuota, true)
		if result.FundingApplied && relayInfo.BillingSource != BillingSourceSubscription {
			recordWalletUsageReward(ctx, relayInfo.UserId, chargeKey, actualQuota)
		}
		return err
	}
	if relayInfo.BillingSource != BillingSourceSubscription {
		recordWalletUsageReward(ctx, relayInfo.UserId, chargeKey, actualQuota)
	}
	return nil
}

// RunAffiliateUsageRewardRetry processes persisted credits on the master node.
func RunAffiliateUsageRewardRetry() {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for {
		if err := model.RetryPendingAffiliateUsageRewards(context.Background(), common.GetTimestamp()); err != nil {
			common.SysError(common.LogText("retrying wallet usage referral rewards: %s", err.Error()))
		}
		<-ticker.C
	}
}

func recordWalletUsageReward(ctx context.Context, userID int, chargeKey string, quota int) {
	if chargeKey == "" || quota <= 0 {
		return
	}
	settledAt := common.GetTimestamp()
	if err := model.CreditAffiliateUsageReward(userID, chargeKey, quota, settledAt); err != nil {
		logger.LogError(ctx, common.LogText("failed to credit wallet usage referral reward (userId=%d, charge=%s, quota=%d, settledAt=%d): %s", userID, chargeKey, quota, settledAt, err.Error()))
	}
}
