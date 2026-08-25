package model

import (
	"errors"
	"fmt"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/shopspring/decimal"
	"gorm.io/gorm"
)

type TopUp struct {
	Id                int     `json:"id"`
	UserId            int     `json:"user_id" gorm:"index"`
	Amount            int64   `json:"amount"`
	Money             float64 `json:"money"`
	TradeNo           string  `json:"trade_no" gorm:"unique;type:varchar(255);index"`
	PaymentMethod     string  `json:"payment_method" gorm:"type:varchar(50)"`
	PaymentProvider   string  `json:"payment_provider" gorm:"type:varchar(50);default:''"`
	CreateTime        int64   `json:"create_time"`
	CompleteTime      int64   `json:"complete_time" gorm:"index:idx_topups_status_complete,priority:2"`
	Status            string  `json:"status" gorm:"index:idx_topups_status_complete,priority:1"`
	InvoiceStatus     int     `json:"invoice_status" gorm:"index"`
	InvoicedAt        int64   `json:"invoiced_at"`
	InvoicedBy        int     `json:"invoiced_by"`
	InvoiceReturnedAt int64   `json:"invoice_returned_at"`
	InvoiceReturnedBy int     `json:"invoice_returned_by"`
}

const (
	TopUpInvoiceStatusNone     = 0
	TopUpInvoiceStatusIssued   = 1
	TopUpInvoiceStatusReturned = 2

	TopUpInvoiceActionIssue  = "issue"
	TopUpInvoiceActionReturn = "return"
)

const (
	PaymentMethodStripe       = "stripe"
	PaymentMethodCreem        = "creem"
	PaymentMethodWaffo        = "waffo"
	PaymentMethodWaffoPancake = "waffo_pancake"
	PaymentMethodBalance      = "balance"
)

const (
	PaymentProviderEpay         = "epay"
	PaymentProviderStripe       = "stripe"
	PaymentProviderCreem        = "creem"
	PaymentProviderWaffo        = "waffo"
	PaymentProviderWaffoPancake = "waffo_pancake"
	PaymentProviderBalance      = "balance"
)

func calculateTopUpCreditedQuota(paymentProvider string, amount int64, money float64) int {
	switch paymentProvider {
	case PaymentProviderCreem:
		return common.QuotaFromDecimal(decimal.NewFromInt(amount))
	case PaymentProviderStripe:
		return common.QuotaFromDecimal(decimal.NewFromFloat(money).Mul(decimal.NewFromFloat(common.QuotaPerUnit)))
	default:
		return common.QuotaFromDecimal(decimal.NewFromInt(amount).Mul(decimal.NewFromFloat(common.QuotaPerUnit)))
	}
}

var (
	ErrPaymentMethodMismatch   = errors.New("payment method mismatch")
	ErrTopUpNotFound           = errors.New("topup not found")
	ErrTopUpStatusInvalid      = errors.New("topup status invalid")
	ErrInvalidTopUpQuota       = errors.New("invalid top-up quota")
	ErrTopUpQuotaLimitExceeded = errors.New("top-up quota limit exceeded")
	ErrTopUpInvoiceAction      = errors.New("invalid invoice action")
	ErrTopUpInvoiceStatus      = errors.New("invalid invoice status")
	ErrTopUpInvoiceBatch       = errors.New("invalid invoice batch")
)

type inviteRechargeRebateResult struct {
	InviterId   int
	InviteeId   int
	RebateQuota int
}

func calculateInviteRechargeRebateQuota(quotaToAdd int) int {
	if quotaToAdd <= 0 || common.InviteRechargeRebateRatio <= 0 {
		return 0
	}
	return common.QuotaFromDecimal(decimal.NewFromInt(int64(quotaToAdd)).Mul(decimal.NewFromFloat(common.InviteRechargeRebateRatio)))
}

func isFirstSuccessfulPaidTopUpTx(tx *gorm.DB, userId int) (bool, error) {
	var count int64
	err := tx.Model(&TopUp{}).
		Where("user_id = ? AND status = ? AND amount > 0", userId, common.TopUpStatusSuccess).
		Count(&count).Error
	return count == 0, err
}

func completePendingTopUpTx(tx *gorm.DB, topUp *TopUp, quotaToAdd int, userUpdates map[string]interface{}) (*inviteRechargeRebateResult, error) {
	if tx == nil || topUp == nil {
		return nil, errors.New("invalid topup")
	}
	if quotaToAdd <= 0 {
		return nil, ErrInvalidTopUpQuota
	}

	var user User
	if err := lockForUpdate(tx).Select("id", "inviter_id").Where("id = ?", topUp.UserId).First(&user).Error; err != nil {
		return nil, err
	}

	isFirstTopUp, err := isFirstSuccessfulPaidTopUpTx(tx, topUp.UserId)
	if err != nil {
		return nil, err
	}

	topUp.CompleteTime = common.GetTimestamp()
	topUp.Status = common.TopUpStatusSuccess
	if err := tx.Save(topUp).Error; err != nil {
		return nil, err
	}

	if err := creditTopUpQuota(tx, topUp.UserId, quotaToAdd, userUpdates); err != nil {
		return nil, err
	}

	// Generate recharge lottery grants as part of the successful top-up flow.
	// The status endpoint still performs a full idempotent sync for recovery,
	// but eligible users should see the grant without opening the lottery page.
	lotteryConfig := GetLotteryConfig()
	if len(lotteryConfig.GrantRules) > 0 {
		if err := syncLotteryRechargeGrants(
			tx,
			topUp.UserId,
			lotteryConfig.GrantRules,
			topUp.CompleteTime,
		); err != nil {
			return nil, err
		}
	}

	rebateQuota := calculateInviteRechargeRebateQuota(quotaToAdd)
	if !isFirstTopUp || user.InviterId <= 0 || rebateQuota <= 0 || !operation_setting.IsPaymentComplianceConfirmed() {
		return nil, nil
	}
	created, err := createAffiliateRewardIfAbsent(tx, &AffiliateReward{
		EventKey:  fmt.Sprintf("first-topup:%d", topUp.Id),
		InviterId: user.InviterId,
		InviteeId: topUp.UserId,
		Type:      AffiliateRewardTypeFirstTopUp,
		Quota:     rebateQuota,
		SourceId:  int64(topUp.Id),
	})
	if err != nil {
		return nil, err
	}
	if !created {
		return nil, nil
	}

	err = tx.Model(&User{}).Where("id = ?", user.InviterId).Updates(map[string]interface{}{
		"aff_quota":   gorm.Expr("aff_quota + ?", rebateQuota),
		"aff_history": gorm.Expr("aff_history + ?", rebateQuota),
	}).Error
	if err != nil {
		return nil, err
	}

	return &inviteRechargeRebateResult{
		InviterId:   user.InviterId,
		InviteeId:   topUp.UserId,
		RebateQuota: rebateQuota,
	}, nil
}

func recordInviteRechargeRebateLog(result *inviteRechargeRebateResult, quotaToAdd int, payMoney float64) {
	if result == nil || result.RebateQuota <= 0 {
		return
	}
	RecordLog(
		result.InviterId,
		LogTypeSystem,
		fmt.Sprintf(
			"邀请用户首充返利 %s，被邀请用户 ID: %d，首充到账额度: %s，支付金额: %.2f",
			logger.LogQuota(result.RebateQuota),
			result.InviteeId,
			logger.LogQuota(quotaToAdd),
			payMoney,
		),
	)
}

func (topUp *TopUp) Insert() error {
	var err error
	err = DB.Create(topUp).Error
	return err
}

func topUpQuotaMaxCurrent(creditedQuota int) (int, error) {
	if creditedQuota <= 0 || creditedQuota >= common.MaxQuota {
		return 0, ErrInvalidTopUpQuota
	}
	return common.MaxQuota - 1 - creditedQuota, nil
}

// ValidateTopUpQuotaCapacity performs the user-facing pre-payment check. The
// settlement path repeats the same invariant with an atomic conditional
// update, because the wallet balance can change after checkout creation.
func ValidateTopUpQuotaCapacity(userId int, creditedQuota int) error {
	maxCurrentQuota, err := topUpQuotaMaxCurrent(creditedQuota)
	if err != nil {
		return err
	}

	var user User
	if err := DB.Select("quota").Where("id = ?", userId).First(&user).Error; err != nil {
		return err
	}
	if user.Quota > maxCurrentQuota {
		return ErrTopUpQuotaLimitExceeded
	}
	return nil
}

// creditTopUpQuota atomically enforces the int32 wallet ceiling while adding
// quota. Keeping the predicate and increment in one UPDATE prevents two
// concurrent callbacks from both passing a separate read/check.
func creditTopUpQuota(tx *gorm.DB, userId int, creditedQuota int, updates map[string]interface{}) error {
	maxCurrentQuota, err := topUpQuotaMaxCurrent(creditedQuota)
	if err != nil {
		return err
	}

	updateFields := make(map[string]interface{}, len(updates)+1)
	for key, value := range updates {
		updateFields[key] = value
	}
	updateFields["quota"] = gorm.Expr("quota + ?", creditedQuota)

	result := tx.Model(&User{}).
		Where("id = ? AND quota <= ?", userId, maxCurrentQuota).
		Updates(updateFields)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 1 {
		return nil
	}

	var count int64
	if err := tx.Model(&User{}).Where("id = ?", userId).Count(&count).Error; err != nil {
		return err
	}
	if count == 0 {
		return gorm.ErrRecordNotFound
	}
	return ErrTopUpQuotaLimitExceeded
}

func (topUp *TopUp) Update() error {
	var err error
	err = DB.Save(topUp).Error
	return err
}

func GetTopUpByTradeNo(tradeNo string) *TopUp {
	var topUp *TopUp
	var err error
	err = DB.Where("trade_no = ?", tradeNo).First(&topUp).Error
	if err != nil {
		return nil
	}
	return topUp
}

func UpdatePendingTopUpStatus(tradeNo string, expectedPaymentProvider string, targetStatus string) error {
	if tradeNo == "" {
		return errors.New("未提供支付单号")
	}

	refCol := "`trade_no`"
	if common.UsingMainDatabase(common.DatabaseTypePostgreSQL) {
		refCol = `"trade_no"`
	}

	return DB.Transaction(func(tx *gorm.DB) error {
		topUp := &TopUp{}
		if err := lockForUpdate(tx).Where(refCol+" = ?", tradeNo).First(topUp).Error; err != nil {
			return ErrTopUpNotFound
		}
		if expectedPaymentProvider != "" && topUp.PaymentProvider != expectedPaymentProvider {
			return ErrPaymentMethodMismatch
		}
		if topUp.Status != common.TopUpStatusPending {
			return ErrTopUpStatusInvalid
		}

		topUp.Status = targetStatus
		return tx.Save(topUp).Error
	})
}

// RechargeEpay 原子完成易支付订单：订单行锁、状态校验、成功更新与用户额度增加
// 在同一个事务内完成，因此同一订单的并发/重复回调（包括多实例部署下）最多充值一次。
// alreadyDone=true 表示订单此前已完成，本次为幂等重复回调。
// 进程内的 LockOrder 只是优化，正确性由本函数的数据库行锁保证。
func RechargeEpay(tradeNo string, actualPaymentMethod string, callerIp string) (alreadyDone bool, err error) {
	if tradeNo == "" {
		return false, errors.New("未提供支付单号")
	}

	refCol := "`trade_no`"
	if common.UsingMainDatabase(common.DatabaseTypePostgreSQL) {
		refCol = `"trade_no"`
	}

	var quotaToAdd int
	var rebateResult *inviteRechargeRebateResult
	topUp := &TopUp{}
	err = DB.Transaction(func(tx *gorm.DB) error {
		if err := lockForUpdate(tx).Where(refCol+" = ?", tradeNo).First(topUp).Error; err != nil {
			return ErrTopUpNotFound
		}
		if topUp.PaymentProvider != PaymentProviderEpay {
			return ErrPaymentMethodMismatch
		}
		if topUp.Status == common.TopUpStatusSuccess {
			alreadyDone = true
			return nil
		}
		if topUp.Status != common.TopUpStatusPending {
			return ErrTopUpStatusInvalid
		}
		if actualPaymentMethod != "" && topUp.PaymentMethod != actualPaymentMethod {
			topUp.PaymentMethod = actualPaymentMethod
		}
		var quotaErr error
		quotaToAdd, quotaErr = common.QuotaFromDecimalStrict(
			decimal.NewFromInt(topUp.Amount).Mul(decimal.NewFromFloat(common.QuotaPerUnit)),
		)
		if quotaErr != nil || quotaToAdd <= 0 {
			return ErrInvalidTopUpQuota
		}
		rebateResult, quotaErr = completePendingTopUpTx(tx, topUp, quotaToAdd, nil)
		return quotaErr
	})
	if err != nil {
		if !errors.Is(err, ErrTopUpNotFound) && !errors.Is(err, ErrPaymentMethodMismatch) && !errors.Is(err, ErrTopUpStatusInvalid) {
			common.SysError("epay topup failed: " + err.Error())
		}
		return false, err
	}
	if alreadyDone {
		return true, nil
	}
	syncCreditUserQuotaCache(topUp.UserId, quotaToAdd, "epay topup")

	common.SysLog(fmt.Sprintf("易支付充值成功 trade_no=%s user_id=%d quota_to_add=%d money=%.2f", topUp.TradeNo, topUp.UserId, quotaToAdd, topUp.Money))
	RecordTopupLog(topUp.UserId, fmt.Sprintf("使用在线充值成功，充值金额: %v，支付金额：%f", logger.LogQuota(quotaToAdd), topUp.Money), callerIp, topUp.PaymentMethod, PaymentProviderEpay)
	recordInviteRechargeRebateLog(rebateResult, quotaToAdd, topUp.Money)
	return false, nil
}

func Recharge(referenceId string, customerId string, callerIp string) (err error) {
	if referenceId == "" {
		return errors.New("未提供支付单号")
	}

	var quotaToAdd int
	var rebateResult *inviteRechargeRebateResult
	var completed bool
	topUp := &TopUp{}

	refCol := "`trade_no`"
	if common.UsingMainDatabase(common.DatabaseTypePostgreSQL) {
		refCol = `"trade_no"`
	}

	err = DB.Transaction(func(tx *gorm.DB) error {
		err := lockForUpdate(tx).Where(refCol+" = ?", referenceId).First(topUp).Error
		if err != nil {
			return errors.New("充值订单不存在")
		}

		if topUp.PaymentProvider != PaymentProviderStripe {
			return ErrPaymentMethodMismatch
		}

		if topUp.Status == common.TopUpStatusSuccess {
			return nil
		}

		if topUp.Status != common.TopUpStatusPending {
			return errors.New("充值订单状态错误")
		}

		quotaToAdd, err = common.QuotaFromDecimalStrict(
			decimal.NewFromFloat(topUp.Money).Mul(decimal.NewFromFloat(common.QuotaPerUnit)),
		)
		if err != nil || quotaToAdd <= 0 {
			return ErrInvalidTopUpQuota
		}
		rebateResult, err = completePendingTopUpTx(tx, topUp, quotaToAdd, map[string]interface{}{
			"stripe_customer": customerId,
		})
		if err == nil {
			completed = true
		}
		return err
	})

	if err != nil {
		common.SysError("topup failed: " + err.Error())
		return errors.New("充值失败，请稍后重试")
	}
	if !completed {
		return nil
	}
	syncCreditUserQuotaCache(topUp.UserId, quotaToAdd, "stripe topup")
	RecordTopupLog(topUp.UserId, fmt.Sprintf("使用在线充值成功，充值金额: %v，支付金额：%d", logger.FormatQuota(quotaToAdd), topUp.Amount), callerIp, topUp.PaymentMethod, PaymentMethodStripe)
	recordInviteRechargeRebateLog(rebateResult, quotaToAdd, topUp.Money)

	return nil
}

// topUpQueryWindowSeconds 限制充值记录查询的时间窗口（秒）。
const topUpQueryWindowSeconds int64 = 30 * 24 * 60 * 60

// topUpQueryCutoff 返回允许查询的最早 create_time（秒级 Unix 时间戳）。
func topUpQueryCutoff() int64 {
	return common.GetTimestamp() - topUpQueryWindowSeconds
}

func GetUserTopUps(userId int, pageInfo *common.PageInfo) (topups []*TopUp, total int64, err error) {
	// Start transaction
	tx := DB.Begin()
	if tx.Error != nil {
		return nil, 0, tx.Error
	}
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	cutoff := topUpQueryCutoff()

	// Get total count within transaction
	err = tx.Model(&TopUp{}).Where("user_id = ? AND create_time >= ?", userId, cutoff).Count(&total).Error
	if err != nil {
		tx.Rollback()
		return nil, 0, err
	}

	// Get paginated topups within same transaction
	err = tx.Where("user_id = ? AND create_time >= ?", userId, cutoff).Order("id desc").Limit(pageInfo.GetPageSize()).Offset(pageInfo.GetStartIdx()).Find(&topups).Error
	if err != nil {
		tx.Rollback()
		return nil, 0, err
	}

	// Commit transaction
	if err = tx.Commit().Error; err != nil {
		return nil, 0, err
	}

	return topups, total, nil
}

// GetAllTopUps 获取全平台的充值记录（管理员使用，不限制时间窗口）
func GetAllTopUps(pageInfo *common.PageInfo) (topups []*TopUp, total int64, err error) {
	tx := DB.Begin()
	if tx.Error != nil {
		return nil, 0, tx.Error
	}
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	if err = tx.Model(&TopUp{}).Count(&total).Error; err != nil {
		tx.Rollback()
		return nil, 0, err
	}

	if err = tx.Order("id desc").Limit(pageInfo.GetPageSize()).Offset(pageInfo.GetStartIdx()).Find(&topups).Error; err != nil {
		tx.Rollback()
		return nil, 0, err
	}

	if err = tx.Commit().Error; err != nil {
		return nil, 0, err
	}

	return topups, total, nil
}

// UpdateTopUpInvoiceStatus changes only the internal invoice marker. It never
// modifies payment state, user quota, or billing transactions.
func UpdateTopUpInvoiceStatus(id int, action string, operatorId int) (*TopUp, error) {
	topUps, err := UpdateTopUpInvoiceStatuses([]int{id}, action, operatorId)
	if err != nil {
		return nil, err
	}
	return topUps[0], nil
}

func UpdateTopUpInvoiceStatuses(ids []int, action string, operatorId int) ([]*TopUp, error) {
	if len(ids) == 0 || len(ids) > 100 || operatorId <= 0 {
		return nil, ErrTopUpInvoiceBatch
	}
	seen := make(map[int]struct{}, len(ids))
	uniqueIds := make([]int, 0, len(ids))
	for _, id := range ids {
		if id <= 0 {
			return nil, ErrTopUpInvoiceBatch
		}
		if _, exists := seen[id]; !exists {
			seen[id] = struct{}{}
			uniqueIds = append(uniqueIds, id)
		}
	}
	if action != TopUpInvoiceActionIssue && action != TopUpInvoiceActionReturn {
		return nil, ErrTopUpInvoiceAction
	}

	topUps := make([]*TopUp, 0, len(uniqueIds))
	now := common.GetTimestamp()
	err := DB.Transaction(func(tx *gorm.DB) error {
		locked := make([]TopUp, 0, len(uniqueIds))
		if err := lockForUpdate(tx).Where("id IN ?", uniqueIds).Order("id ASC").Find(&locked).Error; err != nil {
			return err
		}
		if len(locked) != len(uniqueIds) {
			return ErrTopUpNotFound
		}
		for index := range locked {
			if locked[index].Status != common.TopUpStatusSuccess {
				return ErrTopUpStatusInvalid
			}
			if action == TopUpInvoiceActionIssue && locked[index].InvoiceStatus == TopUpInvoiceStatusIssued {
				return ErrTopUpInvoiceStatus
			}
			if action == TopUpInvoiceActionReturn && locked[index].InvoiceStatus != TopUpInvoiceStatusIssued {
				return ErrTopUpInvoiceStatus
			}
		}

		var updates map[string]interface{}
		if action == TopUpInvoiceActionIssue {
			updates = map[string]interface{}{
				"invoice_status":      TopUpInvoiceStatusIssued,
				"invoiced_at":         now,
				"invoiced_by":         operatorId,
				"invoice_returned_at": 0,
				"invoice_returned_by": 0,
			}
		} else {
			updates = map[string]interface{}{
				"invoice_status":      TopUpInvoiceStatusReturned,
				"invoice_returned_at": now,
				"invoice_returned_by": operatorId,
			}
		}
		if err := tx.Model(&TopUp{}).Where("id IN ?", uniqueIds).Updates(updates).Error; err != nil {
			return err
		}
		for _, topUp := range locked {
			copy := topUp
			topUps = append(topUps, &copy)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	for _, topUp := range topUps {
		if action == TopUpInvoiceActionIssue {
			topUp.InvoiceStatus = TopUpInvoiceStatusIssued
			topUp.InvoicedAt = now
			topUp.InvoicedBy = operatorId
			topUp.InvoiceReturnedAt = 0
			topUp.InvoiceReturnedBy = 0
		} else {
			topUp.InvoiceStatus = TopUpInvoiceStatusReturned
			topUp.InvoiceReturnedAt = now
			topUp.InvoiceReturnedBy = operatorId
		}
	}
	return topUps, nil
}

func initializeTopUpInvoiceFields() error {
	columns := []string{
		"invoice_status",
		"invoiced_at",
		"invoiced_by",
		"invoice_returned_at",
		"invoice_returned_by",
	}
	for _, column := range columns {
		if err := DB.Model(&TopUp{}).Where(column+" IS NULL").Update(column, 0).Error; err != nil {
			return err
		}
	}
	return nil
}

// searchTopUpCountHardLimit 搜索充值记录时 COUNT 的安全上限，
// 防止对超大表执行无界 COUNT 触发 DoS。
const searchTopUpCountHardLimit = 10000

// SearchUserTopUps 按订单号搜索某用户的充值记录
func SearchUserTopUps(userId int, keyword string, pageInfo *common.PageInfo) (topups []*TopUp, total int64, err error) {
	tx := DB.Begin()
	if tx.Error != nil {
		return nil, 0, tx.Error
	}
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	query := tx.Model(&TopUp{}).Where("user_id = ? AND create_time >= ?", userId, topUpQueryCutoff())
	if keyword != "" {
		pattern, perr := sanitizeLikePattern(keyword)
		if perr != nil {
			tx.Rollback()
			return nil, 0, perr
		}
		query = query.Where("trade_no LIKE ? ESCAPE '!'", pattern)
	}

	if err = query.Limit(searchTopUpCountHardLimit).Count(&total).Error; err != nil {
		tx.Rollback()
		common.SysError("failed to count search topups: " + err.Error())
		return nil, 0, errors.New("搜索充值记录失败")
	}

	if err = query.Order("id desc").Limit(pageInfo.GetPageSize()).Offset(pageInfo.GetStartIdx()).Find(&topups).Error; err != nil {
		tx.Rollback()
		common.SysError("failed to search topups: " + err.Error())
		return nil, 0, errors.New("搜索充值记录失败")
	}

	if err = tx.Commit().Error; err != nil {
		return nil, 0, err
	}
	return topups, total, nil
}

// SearchAllTopUps 按订单号搜索全平台充值记录（管理员使用，不限制时间窗口）
func SearchAllTopUps(keyword string, pageInfo *common.PageInfo) (topups []*TopUp, total int64, err error) {
	tx := DB.Begin()
	if tx.Error != nil {
		return nil, 0, tx.Error
	}
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	query := tx.Model(&TopUp{})
	if keyword != "" {
		pattern, perr := sanitizeLikePattern(keyword)
		if perr != nil {
			tx.Rollback()
			return nil, 0, perr
		}
		query = query.Where("trade_no LIKE ? ESCAPE '!'", pattern)
	}

	if err = query.Limit(searchTopUpCountHardLimit).Count(&total).Error; err != nil {
		tx.Rollback()
		common.SysError("failed to count search topups: " + err.Error())
		return nil, 0, errors.New("搜索充值记录失败")
	}

	if err = query.Order("id desc").Limit(pageInfo.GetPageSize()).Offset(pageInfo.GetStartIdx()).Find(&topups).Error; err != nil {
		tx.Rollback()
		common.SysError("failed to search topups: " + err.Error())
		return nil, 0, errors.New("搜索充值记录失败")
	}

	if err = tx.Commit().Error; err != nil {
		return nil, 0, err
	}
	return topups, total, nil
}

// ManualCompleteTopUp 管理员手动完成订单并给用户充值
func ManualCompleteTopUp(tradeNo string, callerIp string) error {
	if tradeNo == "" {
		return errors.New("未提供订单号")
	}

	refCol := "`trade_no`"
	if common.UsingMainDatabase(common.DatabaseTypePostgreSQL) {
		refCol = `"trade_no"`
	}

	var userId int
	var quotaToAdd int
	var payMoney float64
	var paymentMethod string
	var completed bool
	var rebateResult *inviteRechargeRebateResult

	err := DB.Transaction(func(tx *gorm.DB) error {
		topUp := &TopUp{}
		// 行级锁，避免并发补单
		if err := lockForUpdate(tx).Where(refCol+" = ?", tradeNo).First(topUp).Error; err != nil {
			return errors.New("充值订单不存在")
		}

		// 幂等处理：已成功直接返回
		if topUp.Status == common.TopUpStatusSuccess {
			return nil
		}

		if topUp.Status != common.TopUpStatusPending {
			return errors.New("订单状态不是待支付，无法补单")
		}

		var quotaErr error
		switch topUp.PaymentProvider {
		case PaymentProviderCreem:
			quotaToAdd, quotaErr = common.QuotaFromDecimalStrict(decimal.NewFromInt(topUp.Amount))
		case PaymentProviderStripe:
			quotaToAdd, quotaErr = common.QuotaFromDecimalStrict(
				decimal.NewFromFloat(topUp.Money).Mul(decimal.NewFromFloat(common.QuotaPerUnit)),
			)
		default:
			quotaToAdd, quotaErr = common.QuotaFromDecimalStrict(
				decimal.NewFromInt(topUp.Amount).Mul(decimal.NewFromFloat(common.QuotaPerUnit)),
			)
		}
		if quotaErr != nil || quotaToAdd <= 0 {
			return ErrInvalidTopUpQuota
		}

		var err error
		rebateResult, err = completePendingTopUpTx(tx, topUp, quotaToAdd, nil)
		if err != nil {
			return err
		}

		userId = topUp.UserId
		payMoney = topUp.Money
		paymentMethod = topUp.PaymentMethod
		completed = true
		return nil
	})

	if err != nil {
		return err
	}

	if !completed {
		return nil
	}

	// 事务外记录日志，避免阻塞
	syncCreditUserQuotaCache(userId, quotaToAdd, "manual topup")
	RecordTopupLog(userId, fmt.Sprintf("管理员补单成功，充值金额: %v，支付金额：%f", logger.FormatQuota(quotaToAdd), payMoney), callerIp, paymentMethod, "admin")
	recordInviteRechargeRebateLog(rebateResult, quotaToAdd, payMoney)
	return nil
}

func RechargeCreem(referenceId string, customerEmail string, customerName string, callerIp string) (err error) {
	if referenceId == "" {
		return errors.New("未提供支付单号")
	}

	var quotaToAdd int
	var rebateResult *inviteRechargeRebateResult
	var completed bool
	topUp := &TopUp{}

	refCol := "`trade_no`"
	if common.UsingMainDatabase(common.DatabaseTypePostgreSQL) {
		refCol = `"trade_no"`
	}

	err = DB.Transaction(func(tx *gorm.DB) error {
		err := lockForUpdate(tx).Where(refCol+" = ?", referenceId).First(topUp).Error
		if err != nil {
			return errors.New("充值订单不存在")
		}

		if topUp.PaymentProvider != PaymentProviderCreem {
			return ErrPaymentMethodMismatch
		}

		if topUp.Status == common.TopUpStatusSuccess {
			return nil
		}

		if topUp.Status != common.TopUpStatusPending {
			return errors.New("充值订单状态错误")
		}

		// Creem 直接使用 Amount 作为充值额度（整数）
		quotaToAdd, err = common.QuotaFromDecimalStrict(decimal.NewFromInt(topUp.Amount))
		if err != nil || quotaToAdd <= 0 {
			return ErrInvalidTopUpQuota
		}

		// 构建更新字段，优先使用邮箱，如果邮箱为空则使用用户名
		updateFields := map[string]interface{}{}

		// 如果有客户邮箱，尝试更新用户邮箱（仅当用户邮箱为空时）
		if customerEmail != "" {
			// 先检查用户当前邮箱是否为空
			var user User
			err = tx.Where("id = ?", topUp.UserId).First(&user).Error
			if err != nil {
				return err
			}

			// 如果用户邮箱为空，则更新为支付时使用的邮箱
			if user.Email == "" {
				updateFields["email"] = customerEmail
			}
		}

		rebateResult, err = completePendingTopUpTx(tx, topUp, quotaToAdd, updateFields)
		if err == nil {
			completed = true
		}
		return err
	})

	if err != nil {
		common.SysError("creem topup failed: " + err.Error())
		return errors.New("充值失败，请稍后重试")
	}
	if !completed {
		return nil
	}
	syncCreditUserQuotaCache(topUp.UserId, quotaToAdd, "creem topup")
	RecordTopupLog(topUp.UserId, fmt.Sprintf("使用Creem充值成功，充值额度: %v，支付金额：%.2f", quotaToAdd, topUp.Money), callerIp, topUp.PaymentMethod, PaymentMethodCreem)
	recordInviteRechargeRebateLog(rebateResult, quotaToAdd, topUp.Money)

	return nil
}

func RechargeWaffo(tradeNo string, callerIp string) (err error) {
	if tradeNo == "" {
		return errors.New("未提供支付单号")
	}

	var quotaToAdd int
	var rebateResult *inviteRechargeRebateResult
	var completed bool
	topUp := &TopUp{}

	refCol := "`trade_no`"
	if common.UsingMainDatabase(common.DatabaseTypePostgreSQL) {
		refCol = `"trade_no"`
	}

	err = DB.Transaction(func(tx *gorm.DB) error {
		err := lockForUpdate(tx).Where(refCol+" = ?", tradeNo).First(topUp).Error
		if err != nil {
			return errors.New("充值订单不存在")
		}

		if topUp.PaymentProvider != PaymentProviderWaffo {
			return ErrPaymentMethodMismatch
		}

		if topUp.Status == common.TopUpStatusSuccess {
			return nil // 幂等：已成功直接返回
		}

		if topUp.Status != common.TopUpStatusPending {
			return errors.New("充值订单状态错误")
		}

		quotaToAdd, err = common.QuotaFromDecimalStrict(
			decimal.NewFromInt(topUp.Amount).Mul(decimal.NewFromFloat(common.QuotaPerUnit)),
		)
		if err != nil || quotaToAdd <= 0 {
			return ErrInvalidTopUpQuota
		}

		rebateResult, err = completePendingTopUpTx(tx, topUp, quotaToAdd, nil)
		if err == nil {
			completed = true
		}
		return err
	})

	if err != nil {
		common.SysError("waffo topup failed: " + err.Error())
		return errors.New("充值失败，请稍后重试")
	}
	if !completed {
		return nil
	}
	syncCreditUserQuotaCache(topUp.UserId, quotaToAdd, "waffo topup")
	RecordTopupLog(topUp.UserId, fmt.Sprintf("Waffo充值成功，充值额度: %v，支付金额: %.2f", logger.FormatQuota(quotaToAdd), topUp.Money), callerIp, topUp.PaymentMethod, PaymentMethodWaffo)
	recordInviteRechargeRebateLog(rebateResult, quotaToAdd, topUp.Money)

	return nil
}

func RechargeWaffoPancake(tradeNo string) (err error) {
	if tradeNo == "" {
		return errors.New("未提供支付单号")
	}

	var quotaToAdd int
	var rebateResult *inviteRechargeRebateResult
	var completed bool
	topUp := &TopUp{}

	refCol := "`trade_no`"
	if common.UsingMainDatabase(common.DatabaseTypePostgreSQL) {
		refCol = `"trade_no"`
	}

	err = DB.Transaction(func(tx *gorm.DB) error {
		err := lockForUpdate(tx).Where(refCol+" = ?", tradeNo).First(topUp).Error
		if err != nil {
			return errors.New("充值订单不存在")
		}

		if topUp.PaymentProvider != PaymentProviderWaffoPancake {
			return ErrPaymentMethodMismatch
		}

		if topUp.Status == common.TopUpStatusSuccess {
			return nil
		}

		if topUp.Status != common.TopUpStatusPending {
			return errors.New("充值订单状态错误")
		}

		quotaToAdd, err = common.QuotaFromDecimalStrict(
			decimal.NewFromInt(topUp.Amount).Mul(decimal.NewFromFloat(common.QuotaPerUnit)),
		)
		if err != nil || quotaToAdd <= 0 {
			return ErrInvalidTopUpQuota
		}

		rebateResult, err = completePendingTopUpTx(tx, topUp, quotaToAdd, nil)
		if err == nil {
			completed = true
		}
		return err
	})

	if err != nil {
		common.SysError("waffo pancake topup failed: " + err.Error())
		return errors.New("充值失败，请稍后重试")
	}
	if !completed {
		return nil
	}
	syncCreditUserQuotaCache(topUp.UserId, quotaToAdd, "waffo pancake topup")
	RecordLog(topUp.UserId, LogTypeTopup, fmt.Sprintf("Waffo Pancake充值成功，充值额度: %v，支付金额: %.2f", logger.FormatQuota(quotaToAdd), topUp.Money))
	recordInviteRechargeRebateLog(rebateResult, quotaToAdd, topUp.Money)

	return nil
}
