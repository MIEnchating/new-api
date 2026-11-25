package model

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/shopspring/decimal"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	AffiliateRewardTypeRegistration = "registration"
	AffiliateRewardTypeFirstTopUp   = "first_topup"
	AffiliateRewardTypeWalletUsage  = "wallet_usage"
)

type AffiliateReward struct {
	Id        int64  `json:"id"`
	EventKey  string `json:"-" gorm:"type:varchar(128);uniqueIndex"`
	InviterId int    `json:"-" gorm:"index:idx_affiliate_reward_inviter_time,priority:1"`
	InviteeId int    `json:"-" gorm:"index"`
	Type      string `json:"type" gorm:"type:varchar(32);index"`
	Quota     int    `json:"quota"`
	SourceId  int64  `json:"-" gorm:"index"`
	CreatedAt int64  `json:"created_at" gorm:"bigint;index:idx_affiliate_reward_inviter_time,priority:2"`
}

// PendingAffiliateUsageReward stores the original reward amount before the
// separate ledger transaction so failed credits can be retried after restart.
type PendingAffiliateUsageReward struct {
	Id            int64
	EventKey      string `gorm:"type:varchar(128);uniqueIndex"`
	InviterId     int
	InviteeId     int
	Quota         int
	SettledAt     int64
	NextAttemptAt int64 `gorm:"index"`
}

type AffiliateRewardItem struct {
	Id             int64  `json:"id"`
	Type           string `json:"type"`
	Quota          int    `json:"quota"`
	InviteeDisplay string `json:"invitee_display"`
	CreatedAt      int64  `json:"created_at"`
}

type AffiliateRewardAdminItem struct {
	Id              int64  `json:"id"`
	Type            string `json:"type"`
	Quota           int    `json:"quota"`
	InviterId       int    `json:"inviter_id"`
	InviterUsername string `json:"inviter_username"`
	InviteeId       int    `json:"invitee_id"`
	InviteeUsername string `json:"invitee_username"`
	CreatedAt       int64  `json:"created_at"`
}

type AffiliateRewardAdminFilter struct {
	InviterKeyword string
	InviteeKeyword string
	Type           string
}

func createAffiliateRewardIfAbsent(tx *gorm.DB, reward *AffiliateReward) (bool, error) {
	if tx == nil {
		tx = DB
	}
	if reward == nil || reward.EventKey == "" || reward.InviterId <= 0 || reward.InviteeId <= 0 || reward.Quota <= 0 {
		return false, fmt.Errorf("invalid affiliate reward")
	}
	if reward.CreatedAt == 0 {
		reward.CreatedAt = common.GetTimestamp()
	}
	result := tx.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "event_key"}},
		DoNothing: true,
	}).Create(reward)
	if result.Error != nil {
		return false, result.Error
	}
	return result.RowsAffected > 0, nil
}

// creditAffiliateRewardTx records and credits a reward in the caller's transaction.
// Both balance columns are bounded atomically, including concurrent rewards.
func creditAffiliateRewardTx(tx *gorm.DB, reward *AffiliateReward) (bool, error) {
	created, err := createAffiliateRewardIfAbsent(tx, reward)
	if err != nil || !created {
		return false, err
	}
	if reward.Quota > common.MaxWalletQuota {
		return false, ErrWalletQuotaLimitExceeded
	}
	updates := map[string]any{
		"aff_quota":   gorm.Expr("aff_quota + ?", reward.Quota),
		"aff_history": gorm.Expr("aff_history + ?", reward.Quota),
	}
	if reward.Type == AffiliateRewardTypeRegistration {
		updates["aff_count"] = gorm.Expr("aff_count + ?", 1)
	}
	result := tx.Model(&User{}).Where("id = ?", reward.InviterId).
		Where("aff_quota <= ? AND aff_history <= ?", common.MaxWalletQuota-reward.Quota, common.MaxWalletQuota-reward.Quota).
		Updates(updates)
	if result.Error != nil {
		return false, result.Error
	}
	if result.RowsAffected == 0 {
		var inviter User
		if err := tx.Select("id").First(&inviter, reward.InviterId).Error; err != nil {
			return false, err
		}
		return false, ErrWalletQuotaLimitExceeded
	}
	return true, nil
}

// CreditAffiliateUsageReward credits a finalized wallet charge once. The caller
// supplies a server-generated key for the charge and its settlement timestamp.
func CreditAffiliateUsageReward(inviteeID int, chargeKey string, spentQuota int, settledAt int64) error {
	settings := operation_setting.GetAffiliateUsageRewardSetting()
	if !settings.Active() || spentQuota <= 0 || inviteeID <= 0 || chargeKey == "" || settledAt <= 0 || !operation_setting.IsPaymentComplianceConfirmed() {
		return nil
	}
	if err := common.ValidateWalletQuota(spentQuota); err != nil {
		return err
	}
	const windowSeconds = operation_setting.AffiliateUsageRewardDays * 24 * 60 * 60
	var invitee User
	if err := DB.Select("inviter_id").Where(
		"id = ? AND inviter_id > 0 AND inviter_id <> id AND created_at > 0 AND created_at <= ? AND created_at > ?",
		inviteeID, settledAt, settledAt-windowSeconds,
	).Limit(1).Find(&invitee).Error; err != nil || invitee.InviterId == 0 {
		return err
	}
	rewardQuota, err := common.WalletQuotaFromDecimalStrict(
		decimal.NewFromInt(int64(spentQuota)).Mul(decimal.NewFromFloat(settings.RatePercent)).Shift(-2).Truncate(0),
	)
	if err != nil || rewardQuota == 0 {
		return err
	}
	pending := PendingAffiliateUsageReward{
		EventKey:  "wallet-usage:" + chargeKey,
		InviterId: invitee.InviterId,
		InviteeId: inviteeID,
		Quota:     rewardQuota,
		SettledAt: settledAt,
	}
	if err := DB.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "event_key"}},
		DoNothing: true,
	}).Create(&pending).Error; err != nil {
		return fmt.Errorf("persist pending wallet usage reward: %w", err)
	}
	return applyPendingAffiliateUsageReward(DB, pending.EventKey, common.GetTimestamp())
}

func applyPendingAffiliateUsageReward(db *gorm.DB, eventKey string, now int64) error {
	var pending PendingAffiliateUsageReward
	err := db.Transaction(func(tx *gorm.DB) error {
		if err := lockForUpdate(tx).Where("event_key = ? AND next_attempt_at <= ?", eventKey, now).
			Limit(1).Find(&pending).Error; err != nil || pending.Id == 0 {
			return err
		}
		var inviter User
		if err := lockForUpdate(tx).Select("id").Where("id = ?", pending.InviterId).
			Limit(1).Find(&inviter).Error; err != nil {
			return err
		}
		if inviter.Id != 0 {
			// A replay may enqueue a reward that already reached the ledger.
			// Do not depend on MySQL's affected-rows behavior for no-op upserts.
			var existing AffiliateReward
			if err := tx.Select("id").Where("event_key = ?", pending.EventKey).
				Limit(1).Find(&existing).Error; err != nil {
				return err
			}
			if existing.Id == 0 {
				if _, err := creditAffiliateRewardTx(tx, &AffiliateReward{
					EventKey:  pending.EventKey,
					InviterId: pending.InviterId,
					InviteeId: pending.InviteeId,
					Type:      AffiliateRewardTypeWalletUsage,
					Quota:     pending.Quota,
					CreatedAt: pending.SettledAt,
				}); err != nil {
					return err
				}
			}
		}
		return tx.Delete(&pending).Error
	})
	if err == nil || pending.Id == 0 {
		return err
	}
	// Move a failed row behind other due rewards. The transaction has rolled
	// back, so a failed ledger write never leaves a partial positive credit.
	retryErr := db.Model(&PendingAffiliateUsageReward{}).
		Where("id = ? AND next_attempt_at <= ?", pending.Id, now).
		Update("next_attempt_at", now+60).Error
	return errors.Join(err, retryErr)
}

// RetryPendingAffiliateUsageRewards resumes saved rewards with their original
// amounts and settlement dates. The current rate only affects future charges.
func RetryPendingAffiliateUsageRewards(ctx context.Context, now int64) error {
	if !operation_setting.IsPaymentComplianceConfirmed() {
		return nil
	}
	db := DB.WithContext(ctx)
	var pending []PendingAffiliateUsageReward
	if err := db.Select("event_key").Where("next_attempt_at <= ?", now).
		Order("next_attempt_at, id").Limit(100).Find(&pending).Error; err != nil {
		return err
	}
	var result error
	for _, reward := range pending {
		if err := applyPendingAffiliateUsageReward(db, reward.EventKey, now); err != nil {
			result = errors.Join(result, fmt.Errorf("retry wallet usage reward %s: %w", reward.EventKey, err))
		}
	}
	return result
}

func GetAffiliateRewards(inviterId int, pageInfo *common.PageInfo) ([]AffiliateRewardItem, int64, error) {
	if inviterId <= 0 {
		return nil, 0, fmt.Errorf("invalid inviter")
	}
	if pageInfo == nil {
		pageInfo = &common.PageInfo{Page: 1, PageSize: 10}
	}
	query := DB.Table("affiliate_rewards AS rewards").Where("rewards.inviter_id = ?", inviterId)
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	type rewardRow struct {
		Id              int64
		Type            string
		Quota           int
		InviteeUsername string
		CreatedAt       int64
	}
	rows := make([]rewardRow, 0, pageInfo.GetPageSize())
	err := query.
		Joins("LEFT JOIN users AS invitees ON invitees.id = rewards.invitee_id").
		Select("rewards.id, rewards.type, rewards.quota, COALESCE(invitees.username, '') AS invitee_username, rewards.created_at").
		Order("rewards.created_at DESC, rewards.id DESC").
		Offset(pageInfo.GetStartIdx()).
		Limit(pageInfo.GetPageSize()).
		Scan(&rows).Error
	if err != nil {
		return nil, 0, err
	}

	items := make([]AffiliateRewardItem, 0, len(rows))
	for _, row := range rows {
		items = append(items, AffiliateRewardItem{
			Id:             row.Id,
			Type:           row.Type,
			Quota:          row.Quota,
			InviteeDisplay: maskAffiliateUsername(row.InviteeUsername),
			CreatedAt:      row.CreatedAt,
		})
	}
	return items, total, nil
}

func GetAllAffiliateRewards(pageInfo *common.PageInfo, filter AffiliateRewardAdminFilter) ([]AffiliateRewardAdminItem, int64, error) {
	if pageInfo == nil {
		pageInfo = &common.PageInfo{Page: 1, PageSize: 10}
	}
	switch filter.Type {
	case "", AffiliateRewardTypeRegistration, AffiliateRewardTypeFirstTopUp, AffiliateRewardTypeWalletUsage:
	default:
		return nil, 0, fmt.Errorf("invalid affiliate reward type")
	}

	query := DB.Table("affiliate_rewards AS rewards").
		Joins("LEFT JOIN users AS inviters ON inviters.id = rewards.inviter_id").
		Joins("LEFT JOIN users AS invitees ON invitees.id = rewards.invitee_id")
	var err error
	query, err = applyAffiliateRewardUserFilter(query, "rewards.inviter_id", "inviters", filter.InviterKeyword)
	if err != nil {
		return nil, 0, err
	}
	query, err = applyAffiliateRewardUserFilter(query, "rewards.invitee_id", "invitees", filter.InviteeKeyword)
	if err != nil {
		return nil, 0, err
	}
	if filter.Type != "" {
		query = query.Where("rewards.type = ?", filter.Type)
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	items := make([]AffiliateRewardAdminItem, 0, pageInfo.GetPageSize())
	err = query.
		Select("rewards.id, rewards.type, rewards.quota, rewards.inviter_id, COALESCE(inviters.username, '') AS inviter_username, rewards.invitee_id, COALESCE(invitees.username, '') AS invitee_username, rewards.created_at").
		Order("rewards.created_at DESC, rewards.id DESC").
		Offset(pageInfo.GetStartIdx()).
		Limit(pageInfo.GetPageSize()).
		Scan(&items).Error
	if err != nil {
		return nil, 0, err
	}
	return items, total, nil
}

func applyAffiliateRewardUserFilter(query *gorm.DB, userIdColumn string, userAlias string, keyword string) (*gorm.DB, error) {
	keyword = strings.TrimSpace(keyword)
	if keyword == "" {
		return query, nil
	}
	if userId, err := strconv.Atoi(keyword); err == nil && userId > 0 {
		return query.Where(userIdColumn+" = ?", userId), nil
	}
	pattern, err := sanitizeLikePattern("%" + strings.ToLower(keyword) + "%")
	if err != nil {
		return nil, err
	}
	return query.Where(
		"(LOWER(COALESCE("+userAlias+".username, '')) LIKE ? ESCAPE '!' OR LOWER(COALESCE("+userAlias+".display_name, '')) LIKE ? ESCAPE '!')",
		pattern,
		pattern,
	), nil
}

func maskAffiliateUsername(username string) string {
	runes := []rune(strings.TrimSpace(username))
	switch len(runes) {
	case 0, 1:
		return "****"
	case 2:
		return string(runes[0]) + "**"
	default:
		maskLength := len(runes) - 2
		if maskLength > 4 {
			maskLength = 4
		}
		return string(runes[0]) + strings.Repeat("*", maskLength) + string(runes[len(runes)-1])
	}
}
