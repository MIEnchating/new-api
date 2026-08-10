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

type TopUpStatsSummary struct {
	OrderCount   int64   `json:"order_count"`
	UserCount    int64   `json:"user_count"`
	TotalMoney   float64 `json:"total_money"`
	InvoiceCount int64   `json:"invoice_count"`
}

type TopUpStatsOrder struct {
	Id                int     `json:"id"`
	TradeNo           string  `json:"trade_no"`
	UserId            int     `json:"user_id"`
	Username          string  `json:"username"`
	DisplayName       string  `json:"display_name"`
	PaymentMethod     string  `json:"payment_method"`
	PaymentProvider   string  `json:"payment_provider"`
	Amount            int64   `json:"amount"`
	Money             float64 `json:"money"`
	Status            string  `json:"status"`
	CreateTime        int64   `json:"create_time"`
	CompleteTime      int64   `json:"complete_time"`
	OrderTime         int64   `json:"order_time"`
	InvoiceStatus     int     `json:"invoice_status"`
	InvoicedAt        int64   `json:"invoiced_at"`
	InvoicedBy        int     `json:"invoiced_by"`
	InvoiceReturnedAt int64   `json:"invoice_returned_at"`
	InvoiceReturnedBy int     `json:"invoice_returned_by"`
}

type TopUpStatsFilter struct {
	Keyword         string
	Reference       string
	UserKeyword     string
	Statuses        []string
	PaymentMethods  []string
	InvoiceStatuses []int
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
		return int(amount)
	case PaymentProviderStripe:
		return int(decimal.NewFromFloat(money).Mul(decimal.NewFromFloat(common.QuotaPerUnit)).IntPart())
	default:
		return int(decimal.NewFromInt(amount).Mul(decimal.NewFromFloat(common.QuotaPerUnit)).IntPart())
	}
}

var (
	ErrPaymentMethodMismatch = errors.New("payment method mismatch")
	ErrTopUpNotFound         = errors.New("topup not found")
	ErrTopUpStatusInvalid    = errors.New("topup status invalid")
	ErrTopUpInvoiceAction    = errors.New("invalid invoice action")
	ErrTopUpInvoiceStatus    = errors.New("invalid invoice status")
	ErrTopUpInvoiceBatch     = errors.New("invalid invoice batch")
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

func invalidateTopUpUserCache(userId int) {
	if userId <= 0 {
		return
	}
	if err := invalidateUserCache(userId); err != nil {
		common.SysLog(fmt.Sprintf("failed to invalidate user cache after topup: user=%d error=%s", userId, err.Error()))
	}
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

		if topUp.Status == common.TopUpStatusSuccess {
			return nil
		}

		if topUp.Status != common.TopUpStatusPending {
			return errors.New("充值订单状态错误")
		}

		quotaToAdd = calculateTopUpCreditedQuota(topUp.PaymentProvider, topUp.Amount, topUp.Money)
		rebateResult, err = completePendingTopUpTx(tx, topUp, quotaToAdd, map[string]interface{}{
			"stripe_customer": customerId,
		})
		return err
	})

	if err != nil {
		common.SysError("topup failed: " + err.Error())
		return errors.New("充值失败，请稍后重试")
	}

	if quotaToAdd > 0 {
		invalidateTopUpUserCache(topUp.UserId)
		RecordTopupLog(topUp.UserId, fmt.Sprintf("使用在线充值成功，充值金额: %v，支付金额：%d", logger.FormatQuota(quotaToAdd), topUp.Amount), callerIp, topUp.PaymentMethod, PaymentMethodStripe)
		recordInviteRechargeRebateLog(rebateResult, quotaToAdd, topUp.Money)
	}

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

// GetUserTopUpStats returns successful-order statistics and all top-up orders
// in an inclusive time range. It uses the same timestamp rule as wallet
// billing history: positive complete_time first, otherwise create_time.
func GetUserTopUpStats(startTime int64, endTime int64, keyword string, pageInfo *common.PageInfo, filters ...TopUpStatsFilter) (summary TopUpStatsSummary, items []TopUpStatsOrder, total int64, err error) {
	filter := TopUpStatsFilter{Keyword: keyword}
	if len(filters) > 0 {
		filter = filters[0]
		filter.Keyword = keyword
	}
	baseQuery := DB.Table("top_ups AS t").
		Joins("LEFT JOIN users AS u ON u.id = t.user_id")
	baseQuery, err = applyTopUpStatsKeyword(baseQuery, filter.Keyword)
	if err != nil {
		return summary, nil, 0, err
	}
	if reference := strings.TrimSpace(filter.Reference); reference != "" {
		pattern, patternErr := sanitizeLikePattern("%" + reference + "%")
		if patternErr != nil {
			return summary, nil, 0, patternErr
		}
		baseQuery = baseQuery.Where("t.trade_no LIKE ? ESCAPE '!'", pattern)
	}
	baseQuery, err = applyBillingUserFilter(baseQuery, "t.user_id", BillingHistoryFilter{UserKeyword: filter.UserKeyword})
	if err != nil {
		return summary, nil, 0, err
	}
	if len(filter.Statuses) > 0 {
		baseQuery = baseQuery.Where("t.status IN ?", filter.Statuses)
	}
	if len(filter.PaymentMethods) > 0 {
		baseQuery = baseQuery.Where("t.payment_method IN ?", filter.PaymentMethods)
	}
	if len(filter.InvoiceStatuses) > 0 {
		baseQuery = baseQuery.Where("t.invoice_status IN ?", filter.InvoiceStatuses)
	}

	effectiveOrderTimeExpr := "CASE WHEN t.complete_time > 0 THEN t.complete_time ELSE t.create_time END"
	if err = baseQuery.Session(&gorm.Session{}).
		Where("t.status = ? AND ("+effectiveOrderTimeExpr+") >= ? AND ("+effectiveOrderTimeExpr+") <= ?", common.TopUpStatusSuccess, startTime, endTime).
		Select("COUNT(*) AS order_count, COUNT(DISTINCT t.user_id) AS user_count, COALESCE(SUM(t.money), 0) AS total_money, COALESCE(SUM(CASE WHEN t.invoice_status = ? THEN 1 ELSE 0 END), 0) AS invoice_count", TopUpInvoiceStatusIssued).
		Scan(&summary).Error; err != nil {
		return summary, nil, 0, err
	}

	orderTimeExpr := effectiveOrderTimeExpr
	listQuery := baseQuery.Session(&gorm.Session{}).
		Where("("+orderTimeExpr+") >= ? AND ("+orderTimeExpr+") <= ?", startTime, endTime)
	if err = listQuery.Session(&gorm.Session{}).Count(&total).Error; err != nil {
		return summary, nil, 0, err
	}

	items = make([]TopUpStatsOrder, 0)
	if total == 0 {
		return summary, items, 0, nil
	}

	err = listQuery.Session(&gorm.Session{}).
		Select("t.id AS id, t.trade_no AS trade_no, t.user_id AS user_id, COALESCE(u.username, '') AS username, COALESCE(u.display_name, '') AS display_name, COALESCE(t.payment_method, '') AS payment_method, COALESCE(t.payment_provider, '') AS payment_provider, t.amount AS amount, t.money AS money, t.status AS status, t.create_time AS create_time, t.complete_time AS complete_time, " + orderTimeExpr + " AS order_time, COALESCE(t.invoice_status, 0) AS invoice_status, COALESCE(t.invoiced_at, 0) AS invoiced_at, COALESCE(t.invoiced_by, 0) AS invoiced_by, COALESCE(t.invoice_returned_at, 0) AS invoice_returned_at, COALESCE(t.invoice_returned_by, 0) AS invoice_returned_by").
		Order("order_time DESC, t.id DESC").
		Limit(pageInfo.GetPageSize()).
		Offset(pageInfo.GetStartIdx()).
		Scan(&items).Error
	return summary, items, total, err
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

		updates := map[string]interface{}{}
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

		// 按支付渠道保持与自动回调相同的入账口径。
		quotaToAdd = calculateTopUpCreditedQuota(topUp.PaymentProvider, topUp.Amount, topUp.Money)
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

	invalidateTopUpUserCache(userId)
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

		quotaToAdd = calculateTopUpCreditedQuota(topUp.PaymentProvider, topUp.Amount, topUp.Money)
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
		invalidateTopUpUserCache(topUp.UserId)
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

		if topUp.Status == common.TopUpStatusSuccess {
			return nil
		}

		if topUp.Status != common.TopUpStatusPending {
			return errors.New("充值订单状态错误")
		}

		quotaToAdd = calculateTopUpCreditedQuota(topUp.PaymentProvider, topUp.Amount, topUp.Money)

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

	if quotaToAdd > 0 {
		invalidateTopUpUserCache(topUp.UserId)
		RecordTopupLog(topUp.UserId, fmt.Sprintf("使用Creem充值成功，充值额度: %v，支付金额：%.2f", quotaToAdd, topUp.Money), callerIp, topUp.PaymentMethod, PaymentMethodCreem)
		recordInviteRechargeRebateLog(rebateResult, quotaToAdd, topUp.Money)
	}

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

		quotaToAdd = calculateTopUpCreditedQuota(topUp.PaymentProvider, topUp.Amount, topUp.Money)
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
		invalidateTopUpUserCache(topUp.UserId)
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

		quotaToAdd = calculateTopUpCreditedQuota(topUp.PaymentProvider, topUp.Amount, topUp.Money)
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
		invalidateTopUpUserCache(topUp.UserId)
		RecordLog(topUp.UserId, LogTypeTopup, fmt.Sprintf("Waffo Pancake充值成功，充值额度: %v，支付金额: %.2f", logger.FormatQuota(quotaToAdd), topUp.Money))
		recordInviteRechargeRebateLog(rebateResult, quotaToAdd, topUp.Money)
	}

	return nil
}
