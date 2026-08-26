package model

import (
	"fmt"
	"slices"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	BillingTypeOnlineTopup     = "online_topup"
	BillingTypeRedemption      = "redemption"
	BillingTypeAffiliate       = "affiliate_transfer"
	BillingTypeAdminAdjustment = "admin_adjustment"
	BillingTypeLottery         = "lottery_reward"
	BillingTypeLotteryReversal = "lottery_reversal"
)

var billingHistoryTypes = map[string]struct{}{
	BillingTypeOnlineTopup:     {},
	BillingTypeRedemption:      {},
	BillingTypeAffiliate:       {},
	BillingTypeAdminAdjustment: {},
	BillingTypeLottery:         {},
	BillingTypeLotteryReversal: {},
}

type BillingTransaction struct {
	Id             int64   `json:"id"`
	EventKey       string  `json:"-" gorm:"type:varchar(128);uniqueIndex"`
	UserId         int     `json:"user_id" gorm:"index:idx_billing_user_time,priority:1"`
	Type           string  `json:"type" gorm:"type:varchar(32);index:idx_billing_type_time,priority:1"`
	Quota          int     `json:"quota"`
	Money          float64 `json:"money"`
	Reference      string  `json:"reference" gorm:"type:varchar(255);index"`
	PaymentMethod  string  `json:"payment_method" gorm:"type:varchar(50)"`
	Status         string  `json:"status" gorm:"type:varchar(20)"`
	OperatorUserId int     `json:"operator_user_id" gorm:"index"`
	CreatedAt      int64   `json:"created_at" gorm:"bigint;index:idx_billing_user_time,priority:2;index:idx_billing_type_time,priority:2"`
	Detail         string  `json:"detail" gorm:"type:text"`
}

type BillingHistoryItem struct {
	Id                string  `json:"id"`
	TopUpId           int     `json:"topup_id,omitempty"`
	RedemptionId      int     `json:"redemption_id,omitempty"`
	UserId            int     `json:"user_id"`
	Username          string  `json:"username"`
	DisplayName       string  `json:"display_name"`
	Type              string  `json:"type"`
	Quota             int     `json:"quota"`
	Money             float64 `json:"money"`
	Reference         string  `json:"reference"`
	PaymentMethod     string  `json:"payment_method"`
	PaymentProvider   string  `json:"payment_provider,omitempty"`
	Status            string  `json:"status"`
	OperatorUserId    int     `json:"operator_user_id,omitempty"`
	CreatedAt         int64   `json:"created_at"`
	Detail            string  `json:"detail,omitempty"`
	InvoiceStatus     *int    `json:"invoice_status,omitempty"`
	InvoicedAt        int64   `json:"invoiced_at,omitempty"`
	InvoicedBy        int     `json:"invoiced_by,omitempty"`
	InvoiceReturnedAt int64   `json:"invoice_returned_at,omitempty"`
	InvoiceReturnedBy int     `json:"invoice_returned_by,omitempty"`
	InvoiceEligible   bool    `json:"invoice_eligible"`
	ExcludedFromStats bool    `json:"excluded_from_stats"`
}

type BillingHistoryFilter struct {
	UserId          int
	UserKeyword     string
	Reference       string
	Types           []string
	Statuses        []string
	PaymentMethods  []string
	InvoiceStatuses []int
	StartTime       int64
	EndTime         int64
	PageInfo        *common.PageInfo
}

type BillingHistoryTypeCounts map[string]int64
type BillingHistoryTypeQuotas map[string]int64

type BillingHistoryDailyStat struct {
	Date            string `json:"date"`
	OnlineTopup     int64  `json:"online_topup"`
	Redemption      int64  `json:"redemption"`
	AdminAdjustment int64  `json:"admin_adjustment"`
	Lottery         int64  `json:"lottery"`
	Total           int64  `json:"total"`
}

func newBillingHistoryTypeCounts() BillingHistoryTypeCounts {
	return BillingHistoryTypeCounts{
		BillingTypeOnlineTopup:     0,
		BillingTypeRedemption:      0,
		BillingTypeAffiliate:       0,
		BillingTypeAdminAdjustment: 0,
		BillingTypeLottery:         0,
		BillingTypeLotteryReversal: 0,
	}
}

func newBillingHistoryTypeQuotas() BillingHistoryTypeQuotas {
	return BillingHistoryTypeQuotas{
		BillingTypeOnlineTopup:     0,
		BillingTypeRedemption:      0,
		BillingTypeAffiliate:       0,
		BillingTypeAdminAdjustment: 0,
		BillingTypeLottery:         0,
		BillingTypeLotteryReversal: 0,
	}
}

func normalizeBillingHistoryTypes(types []string) []string {
	if len(types) == 0 {
		return []string{
			BillingTypeOnlineTopup,
			BillingTypeRedemption,
			BillingTypeAffiliate,
			BillingTypeAdminAdjustment,
			BillingTypeLottery,
			BillingTypeLotteryReversal,
		}
	}
	normalized := make([]string, 0, len(types))
	seen := make(map[string]struct{}, len(types))
	for _, billingType := range types {
		billingType = strings.TrimSpace(billingType)
		if _, valid := billingHistoryTypes[billingType]; !valid {
			continue
		}
		if _, exists := seen[billingType]; exists {
			continue
		}
		seen[billingType] = struct{}{}
		normalized = append(normalized, billingType)
	}
	return normalized
}

func containsBillingType(types []string, target string) bool {
	for _, billingType := range types {
		if billingType == target {
			return true
		}
	}
	return false
}

func createBillingTransactionIfAbsent(tx *gorm.DB, transaction *BillingTransaction) (bool, error) {
	if transaction == nil || transaction.UserId <= 0 || transaction.EventKey == "" {
		return false, fmt.Errorf("invalid billing transaction")
	}
	if tx == nil {
		tx = DB
	}
	if transaction.CreatedAt == 0 {
		transaction.CreatedAt = common.GetTimestamp()
	}
	if transaction.Status == "" {
		transaction.Status = "success"
	}
	result := tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "event_key"}}, DoNothing: true}).Create(transaction)
	if result.Error != nil {
		return false, result.Error
	}
	return result.RowsAffected > 0, nil
}

func CreateBillingTransaction(tx *gorm.DB, transaction *BillingTransaction) error {
	_, err := createBillingTransactionIfAbsent(tx, transaction)
	return err
}

// ensureBillingEventCompatible prevents an accidental event-key collision
// from being treated as a successful replay. Idempotent retries are accepted
// only when they describe the same user, operation, and operator. Stable-delta
// operations also require the same signed quota; override retries cannot use
// that comparison because later legitimate adjustments may change the delta.
func ensureBillingEventCompatible(tx *gorm.DB, eventKey string, userId int, transactionType string, detail string, operatorUserId int, quota int, checkQuota bool) error {
	if tx == nil {
		tx = DB
	}
	var existing BillingTransaction
	if err := tx.Where("event_key = ?", eventKey).First(&existing).Error; err != nil {
		return err
	}
	if existing.UserId != userId || existing.Type != transactionType ||
		existing.Detail != detail || existing.OperatorUserId != operatorUserId ||
		(checkQuota && existing.Quota != quota) {
		return fmt.Errorf("billing event key %q is already used by another transaction", eventKey)
	}
	return nil
}

func AdjustUserQuotaWithBilling(userId int, value int, mode string, operatorUserId int, reference string) (oldQuota int, newQuota int, delta int, err error) {
	if userId <= 0 || value < 0 {
		return 0, 0, 0, fmt.Errorf("invalid quota adjustment")
	}
	if reference == "" || strings.HasSuffix(reference, ":") {
		// A timestamp in seconds is not unique enough for two legitimate
		// adjustments made in the same second. Keep the fallback idempotency
		// key unique unless the caller supplies its own request-scoped key.
		reference = fmt.Sprintf("admin-adjustment:%d:%s", userId, common.GetUUID())
	}
	var user User
	applied := false
	err = DB.Transaction(func(tx *gorm.DB) error {
		if err := lockForUpdate(tx).First(&user, userId).Error; err != nil {
			return err
		}
		oldQuota = user.Quota
		switch mode {
		case "add":
			newQuota = oldQuota + value
		case "subtract":
			newQuota = oldQuota - value
		case "override":
			newQuota = value
		default:
			return fmt.Errorf("invalid quota adjustment mode")
		}
		delta = newQuota - oldQuota
		created, err := createBillingTransactionIfAbsent(tx, &BillingTransaction{
			EventKey:       reference,
			UserId:         userId,
			Type:           BillingTypeAdminAdjustment,
			Quota:          delta,
			Reference:      reference,
			PaymentMethod:  "admin",
			Status:         "success",
			OperatorUserId: operatorUserId,
			CreatedAt:      common.GetTimestamp(),
			Detail:         mode,
		})
		if err != nil {
			return err
		}
		if !created {
			if err := ensureBillingEventCompatible(tx, reference, userId, BillingTypeAdminAdjustment, mode, operatorUserId, delta, mode != "override"); err != nil {
				return err
			}
			newQuota = oldQuota
			delta = 0
			return nil
		}
		if err := tx.Model(&User{}).Where("id = ?", userId).Update("quota", newQuota).Error; err != nil {
			return err
		}
		applied = true
		return nil
	})
	if err != nil {
		return 0, 0, 0, err
	}
	if applied {
		if cacheErr := invalidateUserCache(userId); cacheErr != nil {
			common.SysLog(fmt.Sprintf("failed to invalidate user cache after quota adjustment: %s", cacheErr.Error()))
		}
	}
	return oldQuota, newQuota, delta, nil
}

func applyBillingTimeRange(query *gorm.DB, column string, startTime int64, endTime int64) *gorm.DB {
	if startTime > 0 {
		query = query.Where(column+" >= ?", startTime)
	}
	if endTime > 0 {
		query = query.Where(column+" <= ?", endTime)
	}
	return query
}

func applyBillingUserFilter(query *gorm.DB, userColumn string, filter BillingHistoryFilter) (*gorm.DB, error) {
	if filter.UserId > 0 {
		return query.Where(userColumn+" = ?", filter.UserId), nil
	}
	keyword := strings.TrimSpace(filter.UserKeyword)
	if keyword == "" {
		return query, nil
	}
	pattern, err := sanitizeLikePattern("%" + strings.ToLower(keyword) + "%")
	if err != nil {
		return nil, err
	}
	if userId, parseErr := strconv.Atoi(keyword); parseErr == nil && userId > 0 {
		return query.Where("("+userColumn+" = ? OR LOWER(COALESCE(u.username, '')) LIKE ? ESCAPE '!' OR LOWER(COALESCE(u.display_name, '')) LIKE ? ESCAPE '!')", userId, pattern, pattern), nil
	}
	return query.Where("(LOWER(COALESCE(u.username, '')) LIKE ? ESCAPE '!' OR LOWER(COALESCE(u.display_name, '')) LIKE ? ESCAPE '!')", pattern, pattern), nil
}

const (
	defaultBillingHistoryPageSize = 20
	maxBillingHistoryPageSize     = 100
	maxBillingHistoryFetchLimit   = 10000
)

func billingPageWindow(pageInfo *common.PageInfo) (offset int, pageSize int, limit int, err error) {
	page := 1
	pageSize = defaultBillingHistoryPageSize
	if pageInfo != nil {
		page = pageInfo.GetPage()
		pageSize = pageInfo.GetPageSize()
	}
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = defaultBillingHistoryPageSize
	} else if pageSize > maxBillingHistoryPageSize {
		pageSize = maxBillingHistoryPageSize
	}
	if page-1 > (maxBillingHistoryFetchLimit-pageSize)/pageSize {
		return 0, 0, 0, fmt.Errorf("billing history pagination exceeds the %d-record window", maxBillingHistoryFetchLimit)
	}
	offset = (page - 1) * pageSize
	limit = offset + pageSize
	if pageInfo != nil {
		pageInfo.Page = page
		pageInfo.PageSize = pageSize
	}
	return offset, pageSize, limit, nil
}

const onlineTopUpBillingTime = "CASE WHEN t.complete_time > 0 THEN t.complete_time ELSE t.create_time END"

func queryOnlineTopups(filter BillingHistoryFilter, limit int) ([]BillingHistoryItem, int64, int64, error) {
	query := DB.Table("top_ups AS t").Joins("LEFT JOIN users AS u ON u.id = t.user_id")
	var err error
	query, err = applyBillingUserFilter(query, "t.user_id", filter)
	if err != nil {
		return nil, 0, 0, err
	}
	query = applyBillingTimeRange(query, onlineTopUpBillingTime, filter.StartTime, filter.EndTime)
	if len(filter.Statuses) > 0 {
		query = query.Where("t.status IN ?", filter.Statuses)
	}
	if len(filter.PaymentMethods) > 0 {
		query = query.Where("t.payment_method IN ?", filter.PaymentMethods)
	}
	if len(filter.InvoiceStatuses) > 0 {
		query = query.Where("t.invoice_status IN ?", filter.InvoiceStatuses)
	}
	if reference := strings.TrimSpace(filter.Reference); reference != "" {
		pattern, patternErr := sanitizeLikePattern("%" + reference + "%")
		if patternErr != nil {
			return nil, 0, 0, patternErr
		}
		query = query.Where("t.trade_no LIKE ? ESCAPE '!'", pattern)
	}
	var total int64
	if err := query.Session(&gorm.Session{}).Count(&total).Error; err != nil {
		return nil, 0, 0, err
	}
	type quotaRow struct {
		Amount          int64
		Money           float64
		PaymentProvider string
	}
	quotaRows := make([]quotaRow, 0)
	if err := query.Session(&gorm.Session{}).
		Where("t.status = ?", common.TopUpStatusSuccess).
		Select("t.amount, t.money, t.payment_provider").
		Scan(&quotaRows).Error; err != nil {
		return nil, 0, 0, err
	}
	var quotaTotal int64
	for _, topup := range quotaRows {
		quotaTotal += int64(calculateTopUpCreditedQuota(topup.PaymentProvider, topup.Amount, topup.Money))
	}
	type row struct {
		Id                int
		UserId            int
		Username          string
		DisplayName       string
		Amount            int64
		Money             float64
		TradeNo           string
		PaymentMethod     string
		PaymentProvider   string
		CreateTime        int64
		CompleteTime      int64
		Status            string
		InvoiceStatus     int
		InvoicedAt        int64
		InvoicedBy        int
		InvoiceReturnedAt int64
		InvoiceReturnedBy int
	}
	rows := make([]row, 0)
	if err := query.Session(&gorm.Session{}).
		Select("t.id, t.user_id, COALESCE(u.username, '') AS username, COALESCE(u.display_name, '') AS display_name, t.amount, t.money, t.trade_no, t.payment_method, t.payment_provider, t.create_time, t.complete_time, t.status, COALESCE(t.invoice_status, 0) AS invoice_status, COALESCE(t.invoiced_at, 0) AS invoiced_at, COALESCE(t.invoiced_by, 0) AS invoiced_by, COALESCE(t.invoice_returned_at, 0) AS invoice_returned_at, COALESCE(t.invoice_returned_by, 0) AS invoice_returned_by").
		Order(onlineTopUpBillingTime + " DESC, t.id DESC").Limit(limit).Scan(&rows).Error; err != nil {
		return nil, 0, 0, err
	}
	items := make([]BillingHistoryItem, 0, len(rows))
	for _, topup := range rows {
		quota := calculateTopUpCreditedQuota(topup.PaymentProvider, topup.Amount, topup.Money)
		createdAt := topup.CreateTime
		if topup.CompleteTime > 0 {
			createdAt = topup.CompleteTime
		}
		invoiceStatus := topup.InvoiceStatus
		items = append(items, BillingHistoryItem{
			Id: fmt.Sprintf("topup:%d", topup.Id), TopUpId: topup.Id, UserId: topup.UserId,
			Username: topup.Username, DisplayName: topup.DisplayName,
			Type: BillingTypeOnlineTopup, Quota: quota, Money: topup.Money,
			Reference: topup.TradeNo, PaymentMethod: topup.PaymentMethod, PaymentProvider: topup.PaymentProvider,
			Status: topup.Status, CreatedAt: createdAt,
			InvoiceStatus: &invoiceStatus, InvoicedAt: topup.InvoicedAt,
			InvoicedBy: topup.InvoicedBy, InvoiceReturnedAt: topup.InvoiceReturnedAt,
			InvoiceReturnedBy: topup.InvoiceReturnedBy,
			InvoiceEligible:   topup.Status == common.TopUpStatusSuccess,
		})
	}
	return items, total, quotaTotal, nil
}

func queryRedemptions(filter BillingHistoryFilter, limit int) ([]BillingHistoryItem, int64, int64, int64, error) {
	if (len(filter.Statuses) > 0 && !slices.Contains(filter.Statuses, common.TopUpStatusSuccess)) || len(filter.PaymentMethods) > 0 {
		return []BillingHistoryItem{}, 0, 0, 0, nil
	}
	query := DB.Unscoped().Table("redemptions AS r").
		Joins("LEFT JOIN users AS u ON u.id = r.used_user_id").
		Where("r.used_user_id > 0 AND r.redeemed_time > 0")
	var err error
	query, err = applyBillingUserFilter(query, "r.used_user_id", filter)
	if err != nil {
		return nil, 0, 0, 0, err
	}
	query = applyBillingTimeRange(query, "r.redeemed_time", filter.StartTime, filter.EndTime)
	if len(filter.InvoiceStatuses) > 0 {
		query = query.Where("r.limit_one_per_user = ? AND r.invoice_status IN ?", false, filter.InvoiceStatuses)
	}
	if reference := strings.TrimSpace(filter.Reference); reference != "" {
		pattern, patternErr := sanitizeLikePattern("%" + reference + "%")
		if patternErr != nil {
			return nil, 0, 0, 0, patternErr
		}
		query = query.Where("r.name LIKE ? ESCAPE '!'", pattern)
	}
	var total int64
	if err := query.Session(&gorm.Session{}).Count(&total).Error; err != nil {
		return nil, 0, 0, 0, err
	}
	var statsCount int64
	if err := query.Session(&gorm.Session{}).
		Where("r.limit_one_per_user = ?", false).
		Count(&statsCount).Error; err != nil {
		return nil, 0, 0, 0, err
	}
	var quotaStats struct {
		Quota int64
	}
	if err := query.Session(&gorm.Session{}).
		Where("r.limit_one_per_user = ?", false).
		Select("COALESCE(SUM(r.quota), 0) AS quota").
		Scan(&quotaStats).Error; err != nil {
		return nil, 0, 0, 0, err
	}
	type row struct {
		Id                int
		CreatorUserId     int
		UsedUserId        int
		Username          string
		DisplayName       string
		Name              string
		Quota             int
		RedeemedTime      int64
		LimitOnePerUser   bool
		InvoiceStatus     int
		InvoicedAt        int64
		InvoicedBy        int
		InvoiceReturnedAt int64
		InvoiceReturnedBy int
	}
	rows := make([]row, 0)
	if err := query.Session(&gorm.Session{}).
		Select("r.id, r.user_id AS creator_user_id, r.used_user_id, COALESCE(u.username, '') AS username, COALESCE(u.display_name, '') AS display_name, r.name, r.quota, r.redeemed_time, r.limit_one_per_user, COALESCE(r.invoice_status, 0) AS invoice_status, COALESCE(r.invoiced_at, 0) AS invoiced_at, COALESCE(r.invoiced_by, 0) AS invoiced_by, COALESCE(r.invoice_returned_at, 0) AS invoice_returned_at, COALESCE(r.invoice_returned_by, 0) AS invoice_returned_by").
		Order("r.redeemed_time DESC, r.id DESC").Limit(limit).Scan(&rows).Error; err != nil {
		return nil, 0, 0, 0, err
	}
	items := make([]BillingHistoryItem, 0, len(rows))
	for _, redemption := range rows {
		invoiceStatus := redemption.InvoiceStatus
		item := BillingHistoryItem{
			Id: fmt.Sprintf("redemption:%d", redemption.Id), RedemptionId: redemption.Id,
			UserId:   redemption.UsedUserId,
			Username: redemption.Username, DisplayName: redemption.DisplayName,
			Type: BillingTypeRedemption, Quota: redemption.Quota,
			Reference: redemption.Name, PaymentMethod: BillingTypeRedemption,
			Status: "success", OperatorUserId: redemption.CreatorUserId,
			CreatedAt:         redemption.RedeemedTime,
			InvoiceEligible:   !redemption.LimitOnePerUser,
			ExcludedFromStats: redemption.LimitOnePerUser,
			InvoiceStatus:     &invoiceStatus,
			InvoicedAt:        redemption.InvoicedAt,
			InvoicedBy:        redemption.InvoicedBy,
			InvoiceReturnedAt: redemption.InvoiceReturnedAt,
			InvoiceReturnedBy: redemption.InvoiceReturnedBy,
		}
		items = append(items, item)
	}
	return items, total, statsCount, quotaStats.Quota, nil
}

func queryStoredBillingTransactions(filter BillingHistoryFilter, types []string, limit int) ([]BillingHistoryItem, int64, int64, error) {
	if len(filter.InvoiceStatuses) > 0 {
		return []BillingHistoryItem{}, 0, 0, nil
	}
	query := DB.Table("billing_transactions AS b").
		Joins("LEFT JOIN users AS u ON u.id = b.user_id").
		Where("b.type IN ?", types)
	var err error
	query, err = applyBillingUserFilter(query, "b.user_id", filter)
	if err != nil {
		return nil, 0, 0, err
	}
	query = applyBillingTimeRange(query, "b.created_at", filter.StartTime, filter.EndTime)
	if len(filter.Statuses) > 0 {
		query = query.Where("b.status IN ?", filter.Statuses)
	}
	if len(filter.PaymentMethods) > 0 {
		query = query.Where("b.payment_method IN ?", filter.PaymentMethods)
	}
	if reference := strings.TrimSpace(filter.Reference); reference != "" {
		pattern, patternErr := sanitizeLikePattern("%" + reference + "%")
		if patternErr != nil {
			return nil, 0, 0, patternErr
		}
		query = query.Where("b.reference LIKE ? ESCAPE '!'", pattern)
	}
	var total int64
	if err := query.Session(&gorm.Session{}).Count(&total).Error; err != nil {
		return nil, 0, 0, err
	}
	var quotaStats struct {
		Quota int64
	}
	if err := query.Session(&gorm.Session{}).
		Where("b.status = ?", "success").
		Select("COALESCE(SUM(b.quota), 0) AS quota").
		Scan(&quotaStats).Error; err != nil {
		return nil, 0, 0, err
	}
	type row struct {
		Id             int64
		UserId         int
		Username       string
		DisplayName    string
		Type           string
		Quota          int
		Money          float64
		Reference      string
		PaymentMethod  string
		Status         string
		OperatorUserId int
		CreatedAt      int64
		Detail         string
	}
	rows := make([]row, 0)
	if err := query.Session(&gorm.Session{}).
		Select("b.id, b.user_id, COALESCE(u.username, '') AS username, COALESCE(u.display_name, '') AS display_name, b.type, b.quota, b.money, b.reference, b.payment_method, b.status, b.operator_user_id, b.created_at, b.detail").
		Order("b.created_at DESC, b.id DESC").Limit(limit).Scan(&rows).Error; err != nil {
		return nil, 0, 0, err
	}
	items := make([]BillingHistoryItem, 0, len(rows))
	for _, transaction := range rows {
		items = append(items, BillingHistoryItem{
			Id: fmt.Sprintf("billing:%d", transaction.Id), UserId: transaction.UserId,
			Username: transaction.Username, DisplayName: transaction.DisplayName,
			Type: transaction.Type, Quota: transaction.Quota, Money: transaction.Money,
			Reference: transaction.Reference, PaymentMethod: transaction.PaymentMethod,
			Status: transaction.Status, OperatorUserId: transaction.OperatorUserId,
			CreatedAt: transaction.CreatedAt, Detail: transaction.Detail,
		})
	}
	return items, total, quotaStats.Quota, nil
}

func GetBillingHistoryWithTypeStats(filter BillingHistoryFilter) ([]BillingHistoryItem, int64, BillingHistoryTypeCounts, BillingHistoryTypeQuotas, error) {
	typeCounts := newBillingHistoryTypeCounts()
	typeQuotas := newBillingHistoryTypeQuotas()
	filter.Types = normalizeBillingHistoryTypes(filter.Types)
	if len(filter.Types) == 0 {
		return []BillingHistoryItem{}, 0, typeCounts, typeQuotas, nil
	}
	offset, pageSize, limit, err := billingPageWindow(filter.PageInfo)
	if err != nil {
		return nil, 0, nil, nil, err
	}
	items := make([]BillingHistoryItem, 0, limit*2)
	var total int64
	if containsBillingType(filter.Types, BillingTypeOnlineTopup) {
		topupItems, count, quota, err := queryOnlineTopups(filter, limit)
		if err != nil {
			return nil, 0, nil, nil, err
		}
		items = append(items, topupItems...)
		total += count
		typeCounts[BillingTypeOnlineTopup] = count
		typeQuotas[BillingTypeOnlineTopup] = quota
	}
	if containsBillingType(filter.Types, BillingTypeRedemption) {
		redemptionItems, count, statsCount, quota, err := queryRedemptions(filter, limit)
		if err != nil {
			return nil, 0, nil, nil, err
		}
		items = append(items, redemptionItems...)
		total += count
		typeCounts[BillingTypeRedemption] = statsCount
		typeQuotas[BillingTypeRedemption] = quota
	}
	for _, billingType := range filter.Types {
		if billingType == BillingTypeAffiliate ||
			billingType == BillingTypeAdminAdjustment ||
			billingType == BillingTypeLottery ||
			billingType == BillingTypeLotteryReversal {
			storedItems, count, quota, err := queryStoredBillingTransactions(filter, []string{billingType}, limit)
			if err != nil {
				return nil, 0, nil, nil, err
			}
			items = append(items, storedItems...)
			total += count
			typeCounts[billingType] = count
			typeQuotas[billingType] = quota
		}
	}
	sort.SliceStable(items, func(i, j int) bool {
		if items[i].CreatedAt != items[j].CreatedAt {
			return items[i].CreatedAt > items[j].CreatedAt
		}
		return items[i].Id > items[j].Id
	})
	if offset >= len(items) {
		return []BillingHistoryItem{}, total, typeCounts, typeQuotas, nil
	}
	end := offset + pageSize
	if end > len(items) {
		end = len(items)
	}
	return items[offset:end], total, typeCounts, typeQuotas, nil
}

func GetBillingHistoryWithTypeCounts(filter BillingHistoryFilter) ([]BillingHistoryItem, int64, BillingHistoryTypeCounts, error) {
	items, total, typeCounts, _, err := GetBillingHistoryWithTypeStats(filter)
	return items, total, typeCounts, err
}

// GetBillingHistoryDailyStats aggregates successful quota changes by local calendar day.
// It intentionally reuses the same filters and type semantics as the order table.
func GetBillingHistoryDailyStats(filter BillingHistoryFilter) ([]BillingHistoryDailyStat, error) {
	items := make([]BillingHistoryItem, 0)
	filter.Types = normalizeBillingHistoryTypes(filter.Types)
	if containsBillingType(filter.Types, BillingTypeOnlineTopup) {
		pageItems, _, _, err := queryOnlineTopups(filter, maxBillingHistoryFetchLimit)
		if err != nil {
			return nil, err
		}
		items = append(items, pageItems...)
	}
	if containsBillingType(filter.Types, BillingTypeRedemption) {
		pageItems, _, _, _, err := queryRedemptions(filter, maxBillingHistoryFetchLimit)
		if err != nil {
			return nil, err
		}
		items = append(items, pageItems...)
	}
	storedTypes := make([]string, 0, 3)
	for _, billingType := range filter.Types {
		if billingType == BillingTypeAdminAdjustment ||
			billingType == BillingTypeLottery ||
			billingType == BillingTypeLotteryReversal {
			storedTypes = append(storedTypes, billingType)
		}
	}
	if len(storedTypes) > 0 {
		pageItems, _, _, err := queryStoredBillingTransactions(filter, storedTypes, maxBillingHistoryFetchLimit)
		if err != nil {
			return nil, err
		}
		items = append(items, pageItems...)
	}

	byDate := make(map[string]*BillingHistoryDailyStat)
	for _, item := range items {
		if item.Status != common.TopUpStatusSuccess && item.Status != "success" {
			continue
		}
		date := time.Unix(item.CreatedAt, 0).In(time.Local).Format("2006-01-02")
		stat := byDate[date]
		if stat == nil {
			stat = &BillingHistoryDailyStat{Date: date}
			byDate[date] = stat
		}
		switch item.Type {
		case BillingTypeOnlineTopup:
			stat.OnlineTopup += int64(item.Quota)
		case BillingTypeRedemption:
			if !item.ExcludedFromStats {
				stat.Redemption += int64(item.Quota)
			}
		case BillingTypeAdminAdjustment:
			stat.AdminAdjustment += int64(item.Quota)
		case BillingTypeLottery, BillingTypeLotteryReversal:
			stat.Lottery += int64(item.Quota)
		}
	}

	localStart := time.Unix(filter.StartTime, 0).In(time.Local)
	localEnd := time.Unix(filter.EndTime, 0).In(time.Local)
	start := time.Date(localStart.Year(), localStart.Month(), localStart.Day(), 0, 0, 0, 0, time.Local)
	end := time.Date(localEnd.Year(), localEnd.Month(), localEnd.Day(), 0, 0, 0, 0, time.Local)
	if filter.StartTime <= 0 || filter.EndTime <= 0 || end.Before(start) {
		return []BillingHistoryDailyStat{}, nil
	}
	if end.Sub(start) > 366*24*time.Hour {
		return nil, fmt.Errorf("daily billing statistics range cannot exceed 366 days")
	}
	result := make([]BillingHistoryDailyStat, 0, int(end.Sub(start)/(24*time.Hour))+1)
	for day := start; !day.After(end); day = day.AddDate(0, 0, 1) {
		date := day.Format("2006-01-02")
		stat := byDate[date]
		if stat == nil {
			stat = &BillingHistoryDailyStat{Date: date}
		}
		stat.Total = stat.OnlineTopup + stat.Redemption + stat.AdminAdjustment + stat.Lottery
		result = append(result, *stat)
	}
	return result, nil
}

func GetBillingHistory(filter BillingHistoryFilter) ([]BillingHistoryItem, int64, error) {
	items, total, _, err := GetBillingHistoryWithTypeCounts(filter)
	return items, total, err
}
