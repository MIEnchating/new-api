package model

import (
	"fmt"
	"sort"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	BillingTypeOnlineTopup     = "online_topup"
	BillingTypeRedemption      = "redemption"
	BillingTypeAffiliate       = "affiliate_transfer"
	BillingTypeAdminAdjustment = "admin_adjustment"
)

var billingHistoryTypes = map[string]struct{}{
	BillingTypeOnlineTopup:     {},
	BillingTypeRedemption:      {},
	BillingTypeAffiliate:       {},
	BillingTypeAdminAdjustment: {},
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
	Id             string  `json:"id"`
	UserId         int     `json:"user_id"`
	Username       string  `json:"username"`
	DisplayName    string  `json:"display_name"`
	Type           string  `json:"type"`
	Quota          int     `json:"quota"`
	Money          float64 `json:"money"`
	Reference      string  `json:"reference"`
	PaymentMethod  string  `json:"payment_method"`
	Status         string  `json:"status"`
	OperatorUserId int     `json:"operator_user_id,omitempty"`
	CreatedAt      int64   `json:"created_at"`
	Detail         string  `json:"detail,omitempty"`
}

type BillingHistoryFilter struct {
	UserId      int
	UserKeyword string
	Reference   string
	Types       []string
	StartTime   int64
	EndTime     int64
	PageInfo    *common.PageInfo
}

func normalizeBillingHistoryTypes(types []string) []string {
	if len(types) == 0 {
		return []string{
			BillingTypeOnlineTopup,
			BillingTypeRedemption,
			BillingTypeAffiliate,
			BillingTypeAdminAdjustment,
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

func CreateBillingTransaction(tx *gorm.DB, transaction *BillingTransaction) error {
	if transaction == nil || transaction.UserId <= 0 || transaction.EventKey == "" {
		return fmt.Errorf("invalid billing transaction")
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
	return tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "event_key"}}, DoNothing: true}).Create(transaction).Error
}

func AdjustUserQuotaWithBilling(userId int, value int, mode string, operatorUserId int, reference string) (oldQuota int, newQuota int, delta int, err error) {
	if userId <= 0 || value < 0 {
		return 0, 0, 0, fmt.Errorf("invalid quota adjustment")
	}
	if reference == "" || strings.HasSuffix(reference, ":") {
		reference = fmt.Sprintf("admin-adjustment:%d:%d", userId, common.GetTimestamp())
	}
	var user User
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
		if err := tx.Model(&User{}).Where("id = ?", userId).Update("quota", newQuota).Error; err != nil {
			return err
		}
		return CreateBillingTransaction(tx, &BillingTransaction{
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
	})
	if err != nil {
		return 0, 0, 0, err
	}
	user.Quota = newQuota
	if cacheErr := updateUserCache(user); cacheErr != nil {
		common.SysLog(fmt.Sprintf("failed to update user cache after quota adjustment: %s", cacheErr.Error()))
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

func billingFetchLimit(pageInfo *common.PageInfo) int {
	if pageInfo == nil {
		return 20
	}
	limit := pageInfo.GetStartIdx() + pageInfo.GetPageSize()
	if limit <= 0 {
		return 20
	}
	return limit
}

func queryOnlineTopups(filter BillingHistoryFilter, limit int) ([]BillingHistoryItem, int64, error) {
	query := DB.Table("top_ups AS t").Joins("LEFT JOIN users AS u ON u.id = t.user_id")
	var err error
	query, err = applyBillingUserFilter(query, "t.user_id", filter)
	if err != nil {
		return nil, 0, err
	}
	query = applyBillingTimeRange(query, "t.create_time", filter.StartTime, filter.EndTime)
	if reference := strings.TrimSpace(filter.Reference); reference != "" {
		pattern, patternErr := sanitizeLikePattern("%" + reference + "%")
		if patternErr != nil {
			return nil, 0, patternErr
		}
		query = query.Where("t.trade_no LIKE ? ESCAPE '!'", pattern)
	}
	var total int64
	if err := query.Session(&gorm.Session{}).Count(&total).Error; err != nil {
		return nil, 0, err
	}
	type row struct {
		Id              int
		UserId          int
		Username        string
		DisplayName     string
		Amount          int64
		Money           float64
		TradeNo         string
		PaymentMethod   string
		PaymentProvider string
		CreateTime      int64
		CompleteTime    int64
		Status          string
	}
	rows := make([]row, 0)
	if err := query.Session(&gorm.Session{}).
		Select("t.id, t.user_id, COALESCE(u.username, '') AS username, COALESCE(u.display_name, '') AS display_name, t.amount, t.money, t.trade_no, t.payment_method, t.payment_provider, t.create_time, t.complete_time, t.status").
		Order("t.create_time DESC, t.id DESC").Limit(limit).Scan(&rows).Error; err != nil {
		return nil, 0, err
	}
	items := make([]BillingHistoryItem, 0, len(rows))
	for _, topup := range rows {
		quota := int(topup.Amount)
		if topup.PaymentProvider != PaymentProviderCreem {
			quota = int(float64(topup.Amount) * common.QuotaPerUnit)
		}
		createdAt := topup.CreateTime
		if topup.CompleteTime > 0 {
			createdAt = topup.CompleteTime
		}
		items = append(items, BillingHistoryItem{
			Id: fmt.Sprintf("topup:%d", topup.Id), UserId: topup.UserId,
			Username: topup.Username, DisplayName: topup.DisplayName,
			Type: BillingTypeOnlineTopup, Quota: quota, Money: topup.Money,
			Reference: topup.TradeNo, PaymentMethod: topup.PaymentMethod,
			Status: topup.Status, CreatedAt: createdAt,
		})
	}
	return items, total, nil
}

func queryRedemptions(filter BillingHistoryFilter, limit int) ([]BillingHistoryItem, int64, error) {
	query := DB.Unscoped().Table("redemptions AS r").
		Joins("LEFT JOIN users AS u ON u.id = r.used_user_id").
		Where("r.used_user_id > 0 AND r.redeemed_time > 0")
	var err error
	query, err = applyBillingUserFilter(query, "r.used_user_id", filter)
	if err != nil {
		return nil, 0, err
	}
	query = applyBillingTimeRange(query, "r.redeemed_time", filter.StartTime, filter.EndTime)
	if reference := strings.TrimSpace(filter.Reference); reference != "" {
		pattern, patternErr := sanitizeLikePattern("%" + reference + "%")
		if patternErr != nil {
			return nil, 0, patternErr
		}
		query = query.Where("r.name LIKE ? ESCAPE '!'", pattern)
	}
	var total int64
	if err := query.Session(&gorm.Session{}).Count(&total).Error; err != nil {
		return nil, 0, err
	}
	type row struct {
		Id           int
		UsedUserId   int
		Username     string
		DisplayName  string
		Name         string
		Quota        int
		RedeemedTime int64
	}
	rows := make([]row, 0)
	if err := query.Session(&gorm.Session{}).
		Select("r.id, r.used_user_id, COALESCE(u.username, '') AS username, COALESCE(u.display_name, '') AS display_name, r.name, r.quota, r.redeemed_time").
		Order("r.redeemed_time DESC, r.id DESC").Limit(limit).Scan(&rows).Error; err != nil {
		return nil, 0, err
	}
	items := make([]BillingHistoryItem, 0, len(rows))
	for _, redemption := range rows {
		items = append(items, BillingHistoryItem{
			Id: fmt.Sprintf("redemption:%d", redemption.Id), UserId: redemption.UsedUserId,
			Username: redemption.Username, DisplayName: redemption.DisplayName,
			Type: BillingTypeRedemption, Quota: redemption.Quota,
			Reference: redemption.Name, PaymentMethod: BillingTypeRedemption,
			Status: "success", CreatedAt: redemption.RedeemedTime,
		})
	}
	return items, total, nil
}

func queryStoredBillingTransactions(filter BillingHistoryFilter, types []string, limit int) ([]BillingHistoryItem, int64, error) {
	query := DB.Table("billing_transactions AS b").
		Joins("LEFT JOIN users AS u ON u.id = b.user_id").
		Where("b.type IN ?", types)
	var err error
	query, err = applyBillingUserFilter(query, "b.user_id", filter)
	if err != nil {
		return nil, 0, err
	}
	query = applyBillingTimeRange(query, "b.created_at", filter.StartTime, filter.EndTime)
	if reference := strings.TrimSpace(filter.Reference); reference != "" {
		pattern, patternErr := sanitizeLikePattern("%" + reference + "%")
		if patternErr != nil {
			return nil, 0, patternErr
		}
		query = query.Where("b.reference LIKE ? ESCAPE '!'", pattern)
	}
	var total int64
	if err := query.Session(&gorm.Session{}).Count(&total).Error; err != nil {
		return nil, 0, err
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
		return nil, 0, err
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
	return items, total, nil
}

func GetBillingHistory(filter BillingHistoryFilter) ([]BillingHistoryItem, int64, error) {
	filter.Types = normalizeBillingHistoryTypes(filter.Types)
	if len(filter.Types) == 0 {
		return []BillingHistoryItem{}, 0, nil
	}
	limit := billingFetchLimit(filter.PageInfo)
	items := make([]BillingHistoryItem, 0, limit*2)
	var total int64
	if containsBillingType(filter.Types, BillingTypeOnlineTopup) {
		topupItems, count, err := queryOnlineTopups(filter, limit)
		if err != nil {
			return nil, 0, err
		}
		items = append(items, topupItems...)
		total += count
	}
	if containsBillingType(filter.Types, BillingTypeRedemption) {
		redemptionItems, count, err := queryRedemptions(filter, limit)
		if err != nil {
			return nil, 0, err
		}
		items = append(items, redemptionItems...)
		total += count
	}
	storedTypes := make([]string, 0, 2)
	for _, billingType := range filter.Types {
		if billingType == BillingTypeAffiliate || billingType == BillingTypeAdminAdjustment {
			storedTypes = append(storedTypes, billingType)
		}
	}
	if len(storedTypes) > 0 {
		storedItems, count, err := queryStoredBillingTransactions(filter, storedTypes, limit)
		if err != nil {
			return nil, 0, err
		}
		items = append(items, storedItems...)
		total += count
	}
	sort.SliceStable(items, func(i, j int) bool {
		if items[i].CreatedAt != items[j].CreatedAt {
			return items[i].CreatedAt > items[j].CreatedAt
		}
		return items[i].Id > items[j].Id
	})
	offset := 0
	pageSize := limit
	if filter.PageInfo != nil {
		offset = filter.PageInfo.GetStartIdx()
		pageSize = filter.PageInfo.GetPageSize()
	}
	if offset >= len(items) {
		return []BillingHistoryItem{}, total, nil
	}
	end := offset + pageSize
	if end > len(items) {
		end = len(items)
	}
	return items[offset:end], total, nil
}
