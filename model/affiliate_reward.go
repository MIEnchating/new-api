package model

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	AffiliateRewardTypeRegistration = "registration"
	AffiliateRewardTypeFirstTopUp   = "first_topup"
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
		Id        int64
		Type      string
		Quota     int
		InviteeId int
		CreatedAt int64
	}
	rows := make([]rewardRow, 0, pageInfo.GetPageSize())
	err := query.
		Select("rewards.id, rewards.type, rewards.quota, rewards.invitee_id, rewards.created_at").
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
			InviteeDisplay: maskAffiliateInvitee(row.InviteeId),
			CreatedAt:      row.CreatedAt,
		})
	}
	return items, total, nil
}

func GetAllAffiliateRewards(pageInfo *common.PageInfo, filter AffiliateRewardAdminFilter) ([]AffiliateRewardAdminItem, int64, error) {
	if pageInfo == nil {
		pageInfo = &common.PageInfo{Page: 1, PageSize: 10}
	}
	if filter.Type != "" && filter.Type != AffiliateRewardTypeRegistration && filter.Type != AffiliateRewardTypeFirstTopUp {
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

func maskAffiliateInvitee(userId int) string {
	return fmt.Sprintf("****%02d", userId%100)
}
