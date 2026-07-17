package model

import (
	"errors"
	"fmt"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/shopspring/decimal"
	"gorm.io/gorm"
)

type TopUp struct {
	Id              int     `json:"id"`
	UserId          int     `json:"user_id" gorm:"index"`
	Amount          int64   `json:"amount"`
	Money           float64 `json:"money"`
	TradeNo         string  `json:"trade_no" gorm:"unique;type:varchar(255);index"`
	PaymentMethod   string  `json:"payment_method" gorm:"type:varchar(50)"`
	PaymentProvider string  `json:"payment_provider" gorm:"type:varchar(50);default:''"`
	CreateTime      int64   `json:"create_time"`
	CompleteTime    int64   `json:"complete_time" gorm:"index:idx_topups_status_complete,priority:2"`
	Status          string  `json:"status" gorm:"index:idx_topups_status_complete,priority:1"`
}

type TopUpStatsSummary struct {
	OrderCount int64   `json:"order_count"`
	UserCount  int64   `json:"user_count"`
	TotalMoney float64 `json:"total_money"`
}

type TopUpStatsOrder struct {
	Id              int     `json:"id"`
	TradeNo         string  `json:"trade_no"`
	UserId          int     `json:"user_id"`
	Username        string  `json:"username"`
	DisplayName     string  `json:"display_name"`
	PaymentMethod   string  `json:"payment_method"`
	PaymentProvider string  `json:"payment_provider"`
	Money           float64 `json:"money"`
	CompleteTime    int64   `json:"complete_time"`
}

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

var (
	ErrPaymentMethodMismatch = errors.New("payment method mismatch")
	ErrTopUpNotFound         = errors.New("topup not found")
	ErrTopUpStatusInvalid    = errors.New("topup status invalid")
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
	return int(decimal.NewFromInt(int64(quotaToAdd)).Mul(decimal.NewFromFloat(common.InviteRechargeRebateRatio)).IntPart())
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
		return nil, errors.New("无效的充值额度")
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

	updates := map[string]interface{}{
		"quota": gorm.Expr("quota + ?", quotaToAdd),
	}
	for key, value := range userUpdates {
		updates[key] = value
	}
	if err := tx.Model(&User{}).Where("id = ?", topUp.UserId).Updates(updates).Error; err != nil {
		return nil, err
	}

	rebateQuota := calculateInviteRechargeRebateQuota(quotaToAdd)
	if !isFirstTopUp || user.InviterId <= 0 || rebateQuota <= 0 || !operation_setting.IsPaymentComplianceConfirmed() {
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

func (topUp *TopUp) Update() error {
	var err error
	err = DB.Save(topUp).Error
	return err
}

func GetTopUpById(id int) *TopUp {
	var topUp *TopUp
	var err error
	err = DB.Where("id = ?", id).First(&topUp).Error
	if err != nil {
		return nil
	}
	return topUp
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

func Recharge(referenceId string, customerId string, callerIp string) (err error) {
	if referenceId == "" {
		return errors.New("未提供支付单号")
	}

	var quotaToAdd int
	var rebateResult *inviteRechargeRebateResult
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

		if topUp.Status != common.TopUpStatusPending {
			return errors.New("充值订单状态错误")
		}

		quotaToAdd = int(decimal.NewFromFloat(topUp.Money).Mul(decimal.NewFromFloat(common.QuotaPerUnit)).IntPart())
		rebateResult, err = completePendingTopUpTx(tx, topUp, quotaToAdd, map[string]interface{}{
			"stripe_customer": customerId,
		})
		return err
	})

	if err != nil {
		common.SysError("topup failed: " + err.Error())
		return errors.New("充值失败，请稍后重试")
	}

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

func applyTopUpStatsKeyword(query *gorm.DB, keyword string) (*gorm.DB, error) {
	keyword = strings.TrimSpace(keyword)
	if keyword == "" {
		return query, nil
	}

	conditions := make([]string, 0, 2)
	args := make([]interface{}, 0, 4)
	if userId, err := strconv.Atoi(keyword); err == nil && userId > 0 {
		conditions = append(conditions, "t.user_id = ?")
		args = append(args, userId)
	}

	lowerKeyword := strings.ToLower(keyword)
	if utf8.RuneCountInString(keyword) >= 2 {
		pattern, err := sanitizeLikePattern("%" + lowerKeyword + "%")
		if err != nil {
			return nil, err
		}
		conditions = append(conditions, "(LOWER(COALESCE(u.username, '')) LIKE ? ESCAPE '!' OR LOWER(COALESCE(u.display_name, '')) LIKE ? ESCAPE '!' OR LOWER(COALESCE(t.trade_no, '')) LIKE ? ESCAPE '!')")
		args = append(args, pattern, pattern, pattern)
	} else {
		conditions = append(conditions, "(LOWER(COALESCE(u.username, '')) = ? OR LOWER(COALESCE(u.display_name, '')) = ? OR LOWER(COALESCE(t.trade_no, '')) = ?)")
		args = append(args, lowerKeyword, lowerKeyword, lowerKeyword)
	}

	return query.Where("("+strings.Join(conditions, " OR ")+")", args...), nil
}

// GetUserTopUpStats returns a summary and paginated successful orders for an
// inclusive completion-time range. It is called only by the admin controller.
func GetUserTopUpStats(startTime int64, endTime int64, keyword string, pageInfo *common.PageInfo) (summary TopUpStatsSummary, items []TopUpStatsOrder, total int64, err error) {
	query := DB.Table("top_ups AS t").
		Joins("LEFT JOIN users AS u ON u.id = t.user_id").
		Where("t.status = ? AND t.complete_time >= ? AND t.complete_time <= ?", common.TopUpStatusSuccess, startTime, endTime)
	query, err = applyTopUpStatsKeyword(query, keyword)
	if err != nil {
		return summary, nil, 0, err
	}

	if err = query.Session(&gorm.Session{}).
		Select("COUNT(*) AS order_count, COUNT(DISTINCT t.user_id) AS user_count, COALESCE(SUM(t.money), 0) AS total_money").
		Scan(&summary).Error; err != nil {
		return summary, nil, 0, err
	}

	if err = query.Session(&gorm.Session{}).Count(&total).Error; err != nil {
		return summary, nil, 0, err
	}

	items = make([]TopUpStatsOrder, 0)
	if total == 0 {
		return summary, items, 0, nil
	}

	err = query.Session(&gorm.Session{}).
		Select("t.id AS id, t.trade_no AS trade_no, t.user_id AS user_id, COALESCE(u.username, '') AS username, COALESCE(u.display_name, '') AS display_name, COALESCE(t.payment_method, '') AS payment_method, COALESCE(t.payment_provider, '') AS payment_provider, t.money AS money, t.complete_time AS complete_time").
		Order("t.complete_time DESC, t.id DESC").
		Limit(pageInfo.GetPageSize()).
		Offset(pageInfo.GetStartIdx()).
		Scan(&items).Error
	return summary, items, total, err
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

		// 计算应充值额度：
		// - Stripe 订单：Money 代表经分组倍率换算后的美元数量，直接 * QuotaPerUnit
		// - 其他订单（如易支付）：Amount 为美元数量，* QuotaPerUnit
		if topUp.PaymentProvider == PaymentProviderStripe {
			dQuotaPerUnit := decimal.NewFromFloat(common.QuotaPerUnit)
			quotaToAdd = int(decimal.NewFromFloat(topUp.Money).Mul(dQuotaPerUnit).IntPart())
		} else {
			dAmount := decimal.NewFromInt(topUp.Amount)
			dQuotaPerUnit := decimal.NewFromFloat(common.QuotaPerUnit)
			quotaToAdd = int(dAmount.Mul(dQuotaPerUnit).IntPart())
		}
		if quotaToAdd <= 0 {
			return errors.New("无效的充值额度")
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
	RecordTopupLog(userId, fmt.Sprintf("管理员补单成功，充值金额: %v，支付金额：%f", logger.FormatQuota(quotaToAdd), payMoney), callerIp, paymentMethod, "admin")
	recordInviteRechargeRebateLog(rebateResult, quotaToAdd, payMoney)
	return nil
}

func RechargeEpay(tradeNo string, actualPaymentMethod string, callerIp string) (err error) {
	if tradeNo == "" {
		return errors.New("未提供支付单号")
	}

	var quotaToAdd int
	var rebateResult *inviteRechargeRebateResult
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

		if topUp.PaymentProvider != PaymentProviderEpay {
			return ErrPaymentMethodMismatch
		}

		if topUp.Status == common.TopUpStatusSuccess {
			return nil
		}

		if topUp.Status != common.TopUpStatusPending {
			return errors.New("充值订单状态错误")
		}

		if actualPaymentMethod != "" && topUp.PaymentMethod != actualPaymentMethod {
			topUp.PaymentMethod = actualPaymentMethod
		}

		dAmount := decimal.NewFromInt(topUp.Amount)
		dQuotaPerUnit := decimal.NewFromFloat(common.QuotaPerUnit)
		quotaToAdd = int(dAmount.Mul(dQuotaPerUnit).IntPart())
		if quotaToAdd <= 0 {
			return errors.New("无效的充值额度")
		}

		rebateResult, err = completePendingTopUpTx(tx, topUp, quotaToAdd, nil)
		return err
	})

	if err != nil {
		common.SysError("epay topup failed: " + err.Error())
		return errors.New("充值失败，请稍后重试")
	}

	if quotaToAdd > 0 {
		RecordTopupLog(topUp.UserId, fmt.Sprintf("使用在线充值成功，充值金额: %v，支付金额：%f", logger.LogQuota(quotaToAdd), topUp.Money), callerIp, topUp.PaymentMethod, PaymentProviderEpay)
		recordInviteRechargeRebateLog(rebateResult, quotaToAdd, topUp.Money)
	}

	return nil
}

func RechargeCreem(referenceId string, customerEmail string, customerName string, callerIp string) (err error) {
	if referenceId == "" {
		return errors.New("未提供支付单号")
	}

	var quotaToAdd int
	var rebateResult *inviteRechargeRebateResult
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

		if topUp.Status != common.TopUpStatusPending {
			return errors.New("充值订单状态错误")
		}

		// Creem 直接使用 Amount 作为充值额度（整数）
		quotaToAdd = int(topUp.Amount)

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
		return err
	})

	if err != nil {
		common.SysError("creem topup failed: " + err.Error())
		return errors.New("充值失败，请稍后重试")
	}

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

		dAmount := decimal.NewFromInt(topUp.Amount)
		dQuotaPerUnit := decimal.NewFromFloat(common.QuotaPerUnit)
		quotaToAdd = int(dAmount.Mul(dQuotaPerUnit).IntPart())
		if quotaToAdd <= 0 {
			return errors.New("无效的充值额度")
		}

		rebateResult, err = completePendingTopUpTx(tx, topUp, quotaToAdd, nil)
		return err
	})

	if err != nil {
		common.SysError("waffo topup failed: " + err.Error())
		return errors.New("充值失败，请稍后重试")
	}

	if quotaToAdd > 0 {
		RecordTopupLog(topUp.UserId, fmt.Sprintf("Waffo充值成功，充值额度: %v，支付金额: %.2f", logger.FormatQuota(quotaToAdd), topUp.Money), callerIp, topUp.PaymentMethod, PaymentMethodWaffo)
		recordInviteRechargeRebateLog(rebateResult, quotaToAdd, topUp.Money)
	}

	return nil
}

func RechargeWaffoPancake(tradeNo string) (err error) {
	if tradeNo == "" {
		return errors.New("未提供支付单号")
	}

	var quotaToAdd int
	var rebateResult *inviteRechargeRebateResult
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

		quotaToAdd = int(decimal.NewFromInt(topUp.Amount).Mul(decimal.NewFromFloat(common.QuotaPerUnit)).IntPart())
		if quotaToAdd <= 0 {
			return errors.New("无效的充值额度")
		}

		rebateResult, err = completePendingTopUpTx(tx, topUp, quotaToAdd, nil)
		return err
	})

	if err != nil {
		common.SysError("waffo pancake topup failed: " + err.Error())
		return errors.New("充值失败，请稍后重试")
	}

	if quotaToAdd > 0 {
		RecordLog(topUp.UserId, LogTypeTopup, fmt.Sprintf("Waffo Pancake充值成功，充值额度: %v，支付金额: %.2f", logger.FormatQuota(quotaToAdd), topUp.Money))
		recordInviteRechargeRebateLog(rebateResult, quotaToAdd, topUp.Money)
	}

	return nil
}
