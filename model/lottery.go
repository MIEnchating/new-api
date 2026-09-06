package model

import (
	"crypto/rand"
	"errors"
	"fmt"
	"math/big"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/shopspring/decimal"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	LotteryWeeklySpendAmount = 50
	LotteryWeeklyChanceLimit = 5
	LotteryDailyActiveAmount = 20

	LotteryGrantTypeWeeklySpend = "weekly_spend"
	LotteryGrantTypeStreak3     = "streak_3"
	LotteryGrantTypeStreak7     = "streak_7"

	LotteryPrizeOne   = "quota_1"
	LotteryPrizeFive  = "quota_5"
	LotteryPrizeEight = "quota_8"
	LotteryPrizeNone  = "none"

	LotteryDrawStatusAwarded = "awarded"
	LotteryDrawStatusNoPrize = "no_prize"
	LotteryDrawStatusRevoked = "revoked"

	LotteryPrizePoolOptionKey = "LotteryPrizePool"
	LotteryConfigOptionKey    = "LotteryConfig"

	LotteryChanceGrantRuleRecharge = "recharge"
	LotteryChanceGrantRuleEvent    = "event"
	LotteryGrantTypeManual         = "manual"
	LotteryGrantSourceManual       = "Manual grant"

	LotteryRechargeGrantDaily      = "daily"
	LotteryRechargeGrantCumulative = "cumulative"
	LotteryRechargeGrantUnlimited  = "unlimited"
)

var ErrNoLotteryChances = errors.New("no lottery chances available")
var ErrLotteryDrawNotReversible = errors.New("lottery draw cannot be reversed")
var ErrLotteryDrawAlreadyRevoked = errors.New("lottery reward already revoked")
var ErrInvalidLotteryManualGrant = errors.New("invalid manual lottery grant")
var ErrLotteryGrantTargetNotFound = errors.New("lottery grant target user not found")
var ErrLotteryManualGrantConflict = errors.New("manual lottery grant request conflicts with existing grant")

type LotteryCampaign struct {
	Id        int   `json:"id" gorm:"primaryKey"`
	StartedAt int64 `json:"started_at" gorm:"bigint"`
}

type LotteryProfile struct {
	UserId            int    `json:"-" gorm:"primaryKey"`
	LastFinalizedDate string `json:"-" gorm:"type:varchar(10)"`
	UpdatedAt         int64  `json:"-" gorm:"bigint"`
}

type LotteryDailyActivity struct {
	Id           int64  `json:"id"`
	UserId       int    `json:"-" gorm:"uniqueIndex:idx_lottery_activity_user_date,priority:1"`
	ActivityDate string `json:"date" gorm:"type:varchar(10);uniqueIndex:idx_lottery_activity_user_date,priority:2;index"`
	Quota        int    `json:"quota"`
	Active       bool   `json:"active"`
	UpdatedAt    int64  `json:"-" gorm:"bigint"`
}

type LotteryChanceGrant struct {
	Id             int64  `json:"id"`
	EventKey       string `json:"-" gorm:"type:varchar(128);uniqueIndex"`
	UserId         int    `json:"-" gorm:"index:idx_lottery_grant_user_time,priority:1"`
	Type           string `json:"type" gorm:"type:varchar(80);index"`
	SourceName     string `json:"source_name,omitempty" gorm:"type:varchar(80)"`
	Chances        int    `json:"chances"`
	Consumed       int    `json:"consumed"`
	ExpiresAt      int64  `json:"expires_at,omitempty" gorm:"bigint;index"`
	CreatedAt      int64  `json:"created_at" gorm:"bigint;index:idx_lottery_grant_user_time,priority:2"`
	OperatorUserId int    `json:"-" gorm:"index"`
	Detail         string `json:"-" gorm:"type:varchar(255)"`
}

type LotteryDraw struct {
	Id           int64  `json:"id"`
	EventKey     string `json:"-" gorm:"type:varchar(128);uniqueIndex"`
	UserId       int    `json:"-" gorm:"index:idx_lottery_draw_user_time,priority:1"`
	Prize        string `json:"prize" gorm:"type:varchar(32);index"`
	Quota        int    `json:"quota"`
	Status       string `json:"status" gorm:"type:varchar(20);index"`
	RevokedAt    int64  `json:"revoked_at" gorm:"bigint"`
	RevokedBy    int    `json:"-" gorm:"index"`
	RevokeReason string `json:"-" gorm:"type:varchar(255)"`
	CreatedAt    int64  `json:"created_at" gorm:"bigint;index:idx_lottery_draw_user_time,priority:2"`
}

type LotteryPrize struct {
	Type        string `json:"type"`
	Name        string `json:"name"`
	Amount      int    `json:"amount"`
	Probability int    `json:"probability"`
}

type LotteryStreakReward struct {
	Days    int `json:"days"`
	Chances int `json:"chances"`
}

type LotteryRules struct {
	WeeklySpendAmount int                   `json:"weekly_spend_amount"`
	WeeklyChanceLimit int                   `json:"weekly_chance_limit"`
	DailyActiveAmount int                   `json:"daily_active_amount"`
	StreakRewards     []LotteryStreakReward `json:"streak_rewards"`
}

type LotteryChanceGrantRule struct {
	Id        string  `json:"id"`
	Type      string  `json:"type"`
	Name      string  `json:"name"`
	Enabled   bool    `json:"enabled"`
	Threshold float64 `json:"threshold,omitempty"`
	Limit     string  `json:"limit,omitempty"`
	Reclaim   bool    `json:"reclaim"`
	Chances   int     `json:"chances"`
	StartAt   int64   `json:"start_at,omitempty"`
	EndAt     int64   `json:"end_at,omitempty"`
}

type LotteryConfig struct {
	Rules      LotteryRules             `json:"rules"`
	Prizes     []LotteryPrize           `json:"prizes"`
	GrantRules []LotteryChanceGrantRule `json:"grant_rules"`
}

type LotteryStatus struct {
	AvailableChances    int                      `json:"available_chances"`
	WeeklySpendQuota    int                      `json:"weekly_spend_quota"`
	WeeklyTargetQuota   int                      `json:"weekly_target_quota"`
	WeeklyEarnedChances int                      `json:"weekly_earned_chances"`
	WeeklyChanceLimit   int                      `json:"weekly_chance_limit"`
	TodaySpendQuota     int                      `json:"today_spend_quota"`
	DailyActiveQuota    int                      `json:"daily_active_quota"`
	TodayActive         bool                     `json:"today_active"`
	CurrentStreak       int                      `json:"current_streak"`
	Prizes              []LotteryPrize           `json:"prizes"`
	RecentDraws         []LotteryDraw            `json:"recent_draws"`
	RecentActivity      []LotteryDailyActivity   `json:"recent_activity"`
	Rules               LotteryRules             `json:"rules"`
	GrantRules          []LotteryChanceGrantRule `json:"grant_rules"`
	ActiveGrantRules    []LotteryChanceGrantRule `json:"active_grant_rules"`
}

type LotteryDrawResult struct {
	Draw   LotteryDraw   `json:"draw"`
	Status LotteryStatus `json:"status"`
}

type LotteryManualGrantInput struct {
	UserKeyword    string
	Chances        int
	Reason         string
	ExpiresAt      int64
	OperatorUserId int
	RequestId      string
	RechargeRuleId string
	RechargeDate   string
}

type LotteryDrawAdminItem struct {
	Id             int64  `json:"id"`
	UserId         int    `json:"user_id"`
	Username       string `json:"username"`
	Prize          string `json:"prize"`
	Quota          int    `json:"quota"`
	Status         string `json:"status"`
	EventReference string `json:"event_reference"`
	RevokedAt      int64  `json:"revoked_at"`
	RevokedBy      int    `json:"revoked_by"`
	RevokeReason   string `json:"revoke_reason"`
	CreatedAt      int64  `json:"created_at"`
}

type LotteryDrawPage struct {
	Items    []LotteryDrawAdminItem `json:"items"`
	Total    int64                  `json:"total"`
	Page     int                    `json:"page"`
	PageSize int                    `json:"page_size"`
}

type LotteryUserDrawPage struct {
	Items    []LotteryDraw `json:"items"`
	Total    int64         `json:"total"`
	Page     int           `json:"page"`
	PageSize int           `json:"page_size"`
}

type LotteryDrawFilter struct {
	UserKeyword string
	Result      string
}

type LotteryGrantAdminItem struct {
	Id             int64  `json:"id"`
	UserId         int    `json:"user_id"`
	Username       string `json:"username"`
	Type           string `json:"type"`
	SourceName     string `json:"source_name"`
	EventReference string `json:"event_reference"`
	Chances        int    `json:"chances"`
	Consumed       int    `json:"consumed"`
	ExpiresAt      int64  `json:"expires_at"`
	CreatedAt      int64  `json:"created_at"`
	OperatorUserId int    `json:"operator_user_id"`
	Detail         string `json:"detail"`
}

type LotteryGrantPage struct {
	Items    []LotteryGrantAdminItem `json:"items"`
	Total    int64                   `json:"total"`
	Page     int                     `json:"page"`
	PageSize int                     `json:"page_size"`
}

type LotteryGrantFilter struct {
	UserKeyword string
	Source      string
	Status      string
}

func lotteryPrizePool() []LotteryPrize {
	return []LotteryPrize{
		{Type: LotteryPrizeOne, Name: "1 元额度", Amount: 1, Probability: 50},
		{Type: LotteryPrizeFive, Name: "5 元额度", Amount: 5, Probability: 20},
		{Type: LotteryPrizeEight, Name: "8 元额度", Amount: 8, Probability: 5},
		{Type: LotteryPrizeNone, Name: "未中奖", Probability: 25},
	}
}

func normalizeLotteryPrizeName(prize LotteryPrize) string {
	name := strings.TrimSpace(prize.Name)
	switch name {
	case "1 quota":
		return "1 元额度"
	case "5 quota":
		return "5 元额度"
	case "8 quota":
		return "8 元额度"
	case "No prize":
		return "未中奖"
	case "":
		if prize.Amount <= 0 {
			return "未中奖"
		}
		return prize.Type
	default:
		return prize.Name
	}
}

func defaultLotteryRules() LotteryRules {
	return LotteryRules{
		WeeklySpendAmount: LotteryWeeklySpendAmount,
		WeeklyChanceLimit: LotteryWeeklyChanceLimit,
		DailyActiveAmount: LotteryDailyActiveAmount,
		StreakRewards: []LotteryStreakReward{
			{Days: 3, Chances: 1},
			{Days: 7, Chances: 3},
		},
	}
}

func defaultLotteryConfig() LotteryConfig {
	return LotteryConfig{Rules: defaultLotteryRules(), Prizes: lotteryPrizePool(), GrantRules: []LotteryChanceGrantRule{}}
}

func validateLotteryPrizePool(prizes []LotteryPrize) error {
	if len(prizes) < 2 || len(prizes) > 20 {
		return errors.New("lottery prize pool must contain between 2 and 20 entries")
	}
	seenTypes := make(map[string]bool, len(prizes))
	totalProbability := 0
	noPrizeCount := 0
	for _, prize := range prizes {
		if strings.TrimSpace(prize.Type) == "" || len(prize.Type) > 32 || seenTypes[prize.Type] {
			return errors.New("lottery prize identifiers must be unique and non-empty")
		}
		seenTypes[prize.Type] = true
		if len([]rune(strings.TrimSpace(prize.Name))) > 80 {
			return errors.New("lottery prize name is too long")
		}
		if prize.Probability < 0 || prize.Probability > 100 {
			return errors.New("lottery prize probability must be between 0 and 100")
		}
		if prize.Amount < 0 {
			return errors.New("lottery prize amount cannot be negative")
		} else if prize.Amount == 0 {
			noPrizeCount++
		} else if prize.Amount > 10000 {
			return errors.New("lottery prize amount must be between 1 and 10000")
		}
		totalProbability += prize.Probability
	}
	if totalProbability != 100 {
		return errors.New("lottery prize probabilities must total 100")
	}
	if noPrizeCount == 0 {
		return errors.New("lottery prize pool must contain a no-prize entry")
	}
	return nil
}

func validateLotteryRules(rules LotteryRules) error {
	if rules.WeeklySpendAmount < 0 || rules.WeeklySpendAmount > 1_000_000 ||
		rules.WeeklyChanceLimit < 0 || rules.WeeklyChanceLimit > 100 ||
		rules.DailyActiveAmount < 0 || rules.DailyActiveAmount > 1_000_000 {
		return errors.New("lottery base rule values are out of range")
	}
	if len(rules.StreakRewards) > 20 {
		return errors.New("too many lottery streak rewards")
	}
	seen := map[int]bool{}
	for _, reward := range rules.StreakRewards {
		if reward.Days <= 0 || reward.Days > 365 || reward.Chances <= 0 || reward.Chances > 100 {
			return errors.New("lottery streak reward is out of range")
		}
		if seen[reward.Days] {
			return errors.New("lottery streak reward days must be unique")
		}
		seen[reward.Days] = true
	}
	return nil
}

func validateLotteryGrantRules(rules []LotteryChanceGrantRule) error {
	if len(rules) > 100 {
		return errors.New("too many lottery chance grant rules")
	}
	seen := make(map[string]bool, len(rules))
	for _, rule := range rules {
		if strings.TrimSpace(rule.Id) == "" || len(rule.Id) > 64 || seen[rule.Id] {
			return errors.New("lottery chance grant rule identifiers must be unique")
		}
		seen[rule.Id] = true
		if rule.Type != LotteryChanceGrantRuleRecharge && rule.Type != LotteryChanceGrantRuleEvent {
			return errors.New("unsupported lottery chance grant rule type")
		}
		if strings.TrimSpace(rule.Name) == "" || len([]rune(rule.Name)) > 80 || rule.Chances <= 0 || rule.Chances > 100 {
			return errors.New("invalid lottery chance grant rule")
		}
		if rule.Type == LotteryChanceGrantRuleRecharge && (rule.Threshold <= 0 || rule.Threshold > 1_000_000_000) {
			return errors.New("invalid lottery recharge threshold")
		}
		if rule.Type == LotteryChanceGrantRuleRecharge && rule.Limit != "" &&
			rule.Limit != LotteryRechargeGrantDaily &&
			rule.Limit != LotteryRechargeGrantCumulative &&
			rule.Limit != LotteryRechargeGrantUnlimited {
			return errors.New("invalid lottery recharge grant limit")
		}
		if rule.StartAt < 0 || rule.EndAt < 0 || (rule.StartAt > 0 && rule.EndAt > 0 && rule.EndAt <= rule.StartAt) {
			return errors.New("invalid lottery chance grant time range")
		}
	}
	return nil
}

func validateLotteryConfig(config LotteryConfig) error {
	if err := validateLotteryRules(config.Rules); err != nil {
		return err
	}
	if err := validateLotteryPrizePool(config.Prizes); err != nil {
		return err
	}
	return validateLotteryGrantRules(config.GrantRules)
}

func getLotteryConfigRaw() LotteryConfig {
	common.OptionMapRWMutex.RLock()
	raw := common.OptionMap[LotteryConfigOptionKey]
	legacyRaw := common.OptionMap[LotteryPrizePoolOptionKey]
	common.OptionMapRWMutex.RUnlock()
	config := defaultLotteryConfig()
	if strings.TrimSpace(raw) == "" {
		if strings.TrimSpace(legacyRaw) != "" {
			_ = common.UnmarshalJsonStr(legacyRaw, &config.Prizes)
		}
		return config
	}
	if err := common.UnmarshalJsonStr(raw, &config); err != nil || validateLotteryConfig(config) != nil {
		common.SysError("invalid lottery config option; using defaults")
		return defaultLotteryConfig()
	}
	return config
}

func GetLotteryConfig() LotteryConfig {
	config := getLotteryConfigRaw()
	for index := range config.Prizes {
		config.Prizes[index].Name = normalizeLotteryPrizeName(config.Prizes[index])
	}
	if err := validateLotteryConfig(config); err != nil {
		return defaultLotteryConfig()
	}
	return config
}

func UpdateLotteryConfig(config LotteryConfig) error {
	if err := validateLotteryConfig(config); err != nil {
		return err
	}
	data, err := common.Marshal(config)
	if err != nil {
		return err
	}
	return UpdateOptionsBulk(map[string]string{LotteryConfigOptionKey: string(data)})
}

func GetLotteryPrizePool() []LotteryPrize {
	return GetLotteryConfig().Prizes
}

func UpdateLotteryPrizePool(prizes []LotteryPrize) error {
	config := GetLotteryConfig()
	config.Prizes = prizes
	return UpdateLotteryConfig(config)
}

func validateLotteryPrizePoolJSON(raw string) error {
	var prizes []LotteryPrize
	if err := common.UnmarshalJsonStr(raw, &prizes); err != nil {
		return err
	}
	return validateLotteryPrizePool(prizes)
}

func lotteryPrizeForRoll(roll int, prizes []LotteryPrize) LotteryPrize {
	if roll < 0 || roll >= 100 || validateLotteryPrizePool(prizes) != nil {
		return LotteryPrize{Type: LotteryPrizeNone, Probability: 100}
	}
	cumulative := 0
	for _, prize := range prizes {
		cumulative += prize.Probability
		if roll < cumulative {
			return prize
		}
	}
	return prizes[len(prizes)-1]
}

func lotteryDayStart(now time.Time) time.Time {
	local := now.In(time.Local)
	return time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, time.Local)
}

func lotteryWeekStart(now time.Time) time.Time {
	day := lotteryDayStart(now)
	daysSinceMonday := (int(day.Weekday()) + 6) % 7
	return day.AddDate(0, 0, -daysSinceMonday)
}

func ensureLotteryCampaign(now time.Time) (LotteryCampaign, error) {
	campaign := LotteryCampaign{Id: 1, StartedAt: lotteryDayStart(now).Unix()}
	if err := DB.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "id"}}, DoNothing: true,
	}).Create(&campaign).Error; err != nil {
		return LotteryCampaign{}, err
	}
	if err := DB.First(&campaign, 1).Error; err != nil {
		return LotteryCampaign{}, err
	}
	return campaign, nil
}

func initializeLotteryCampaign() error {
	_, err := ensureLotteryCampaign(time.Now())
	return err
}

func sumLotteryQuotaByDay(userId int, days []time.Time) ([]int, error) {
	if len(days) == 0 {
		return []int{}, nil
	}
	if LOG_DB == nil {
		return nil, errors.New("log database is unavailable")
	}
	results := make([]int, len(days))
	for batchStart := 0; batchStart < len(days); batchStart += 31 {
		batchEnd := batchStart + 31
		if batchEnd > len(days) {
			batchEnd = len(days)
		}
		selects := make([]string, 0, batchEnd-batchStart)
		args := make([]any, 0, (batchEnd-batchStart)*2)
		for i := batchStart; i < batchEnd; i++ {
			selects = append(selects, fmt.Sprintf(
				"COALESCE(SUM(CASE WHEN created_at >= ? AND created_at < ? THEN quota ELSE 0 END), 0) AS d%d",
				i-batchStart,
			))
			args = append(args, days[i].Unix(), days[i].AddDate(0, 0, 1).Unix())
		}
		row := LOG_DB.Table("logs").
			Select(strings.Join(selects, ", "), args...).
			Where(
				"user_id = ? AND type = ? AND created_at >= ? AND created_at < ?",
				userId, LogTypeConsume, days[batchStart].Unix(),
				days[batchEnd-1].AddDate(0, 0, 1).Unix(),
			).
			Row()
		dest := make([]any, batchEnd-batchStart)
		values := make([]int64, batchEnd-batchStart)
		for i := range values {
			dest[i] = &values[i]
		}
		if err := row.Scan(dest...); err != nil {
			return nil, err
		}
		for i, value := range values {
			results[batchStart+i] = common.QuotaFromFloat(float64(value))
		}
	}
	return results, nil
}

func syncLotteryActivity(userId int, now time.Time) error {
	config := GetLotteryConfig()
	campaign, err := ensureLotteryCampaign(now)
	if err != nil {
		return err
	}
	today := lotteryDayStart(now)
	campaignStart := lotteryDayStart(time.Unix(campaign.StartedAt, 0))
	start := campaignStart

	var profile LotteryProfile
	err = DB.First(&profile, "user_id = ?", userId).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		profile = LotteryProfile{UserId: userId}
	} else if err != nil {
		return err
	}
	if profile.LastFinalizedDate != "" {
		lastFinalized, parseErr := time.ParseInLocation(
			"2006-01-02", profile.LastFinalizedDate, time.Local,
		)
		if parseErr == nil && !lastFinalized.Before(start) {
			start = lastFinalized.AddDate(0, 0, 1)
		}
	}
	if start.After(today) {
		start = today
	}

	days := make([]time.Time, 0, 32)
	for day := start; !day.After(today); day = day.AddDate(0, 0, 1) {
		days = append(days, day)
	}
	quotas, err := sumLotteryQuotaByDay(userId, days)
	if err != nil {
		return err
	}
	activeQuota := common.QuotaRound(
		float64(config.Rules.DailyActiveAmount) * common.QuotaPerUnit,
	)
	nowUnix := now.Unix()
	return DB.Transaction(func(tx *gorm.DB) error {
		for i, day := range days {
			activity := LotteryDailyActivity{
				UserId:       userId,
				ActivityDate: day.Format("2006-01-02"),
				Quota:        quotas[i],
				Active:       quotas[i] >= activeQuota,
				UpdatedAt:    nowUnix,
			}
			if err := tx.Clauses(clause.OnConflict{
				Columns: []clause.Column{
					{Name: "user_id"},
					{Name: "activity_date"},
				},
				DoUpdates: clause.AssignmentColumns(
					[]string{"quota", "active", "updated_at"},
				),
			}).Create(&activity).Error; err != nil {
				return err
			}
		}
		yesterday := today.AddDate(0, 0, -1)
		if !yesterday.Before(campaignStart) {
			profile.LastFinalizedDate = yesterday.Format("2006-01-02")
		}
		profile.UpdatedAt = nowUnix
		return tx.Clauses(clause.OnConflict{
			Columns: []clause.Column{{Name: "user_id"}},
			DoUpdates: clause.AssignmentColumns(
				[]string{"last_finalized_date", "updated_at"},
			),
		}).Create(&profile).Error
	})
}

func createLotteryGrantIfAbsent(
	tx *gorm.DB,
	grant LotteryChanceGrant,
) error {
	if grant.EventKey == "" || grant.UserId <= 0 || grant.Chances <= 0 {
		return errors.New("invalid lottery chance grant")
	}
	if grant.CreatedAt == 0 {
		grant.CreatedAt = common.GetTimestamp()
	}
	return tx.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "event_key"}},
		DoUpdates: clause.AssignmentColumns([]string{
			"expires_at",
		}),
	}).Create(&grant).Error
}

// expireLotteryGrants invalidates any remaining chances whose campaign has
// ended. Keeping the grant row preserves the audit trail while making the
// expired chances unavailable to both the status and draw paths.
func expireLotteryGrants(tx *gorm.DB, userId int, nowUnix int64) error {
	return tx.Model(&LotteryChanceGrant{}).
		Where("user_id = ? AND expires_at > 0 AND expires_at <= ? AND consumed < chances", userId, nowUnix).
		UpdateColumn("consumed", gorm.Expr("chances")).Error
}

func syncLotteryGrants(userId int, now time.Time) error {
	config := GetLotteryConfig()
	if err := syncLotteryActivity(userId, now); err != nil {
		return err
	}
	campaign, err := ensureLotteryCampaign(now)
	if err != nil {
		return err
	}
	campaignDate := lotteryDayStart(
		time.Unix(campaign.StartedAt, 0),
	).Format("2006-01-02")
	var activities []LotteryDailyActivity
	if err := DB.Where(
		"user_id = ? AND activity_date >= ?", userId, campaignDate,
	).Order("activity_date ASC").Find(&activities).Error; err != nil {
		return err
	}

	weeklyStart := lotteryWeekStart(now).Format("2006-01-02")
	today := lotteryDayStart(now).Format("2006-01-02")
	weeklyQuota := 0
	for _, activity := range activities {
		if activity.ActivityDate >= weeklyStart &&
			activity.ActivityDate <= today {
			weeklyQuota += activity.Quota
		}
	}
	weeklyTarget := common.QuotaRound(float64(config.Rules.WeeklySpendAmount) * common.QuotaPerUnit)
	weeklyEarned := 0
	if weeklyTarget > 0 && config.Rules.WeeklyChanceLimit > 0 {
		weeklyEarned = weeklyQuota / weeklyTarget
	}
	if weeklyEarned > config.Rules.WeeklyChanceLimit {
		weeklyEarned = config.Rules.WeeklyChanceLimit
	}
	year, week := lotteryWeekStart(now).ISOWeek()
	nowUnix := now.Unix()

	return DB.Transaction(func(tx *gorm.DB) error {
		if err := expireLotteryGrants(tx, userId, nowUnix); err != nil {
			return err
		}
		if err := syncLotteryRechargeGrants(tx, userId, config.GrantRules, nowUnix); err != nil {
			return err
		}
		for index := 1; index <= weeklyEarned; index++ {
			if err := createLotteryGrantIfAbsent(tx, LotteryChanceGrant{
				EventKey: fmt.Sprintf(
					"weekly:%04d-W%02d:%d:%d",
					year, week, userId, index,
				),
				UserId: userId, Type: LotteryGrantTypeWeeklySpend,
				Chances: 1, CreatedAt: nowUnix,
			}); err != nil {
				return err
			}
		}

		streak := 0
		var previous time.Time
		for _, activity := range activities {
			day, parseErr := time.ParseInLocation(
				"2006-01-02", activity.ActivityDate, time.Local,
			)
			if parseErr != nil {
				continue
			}
			if !activity.Active {
				streak = 0
				previous = time.Time{}
				continue
			}
			if previous.IsZero() ||
				!previous.AddDate(0, 0, 1).Equal(day) {
				streak = 1
			} else {
				streak++
			}
			previous = day
			for _, reward := range config.Rules.StreakRewards {
				if streak != reward.Days {
					continue
				}
				if err := createLotteryGrantIfAbsent(tx, LotteryChanceGrant{
					EventKey: fmt.Sprintf("streak:%s:%s:%d", rewardKey(reward), activity.ActivityDate, userId),
					UserId:   userId, Type: fmt.Sprintf("streak_%d", reward.Days),
					Chances: reward.Chances, CreatedAt: nowUnix,
				}); err != nil {
					return err
				}
			}
		}
		for _, rule := range config.GrantRules {
			if !rule.Enabled || !lotteryRuleActive(rule, now) {
				continue
			}
			switch rule.Type {
			case LotteryChanceGrantRuleEvent:
				if err := createLotteryGrantIfAbsent(tx, LotteryChanceGrant{
					EventKey: fmt.Sprintf("campaign:%s:user:%d", rule.Id, userId),
					UserId:   userId, Type: "campaign_" + rule.Id,
					SourceName: rule.Name, Chances: rule.Chances,
					ExpiresAt: lotteryGrantExpiry(rule), CreatedAt: nowUnix,
				}); err != nil {
					return err
				}
			}
		}
		return nil
	})
}

func lotteryGrantExpiry(rule LotteryChanceGrantRule) int64 {
	if rule.Type == LotteryChanceGrantRuleEvent && !rule.Reclaim {
		return 0
	}
	return rule.EndAt
}

func rewardKey(reward LotteryStreakReward) string {
	return fmt.Sprintf("%d:%d", reward.Days, reward.Chances)
}

func lotteryRuleActive(rule LotteryChanceGrantRule, now time.Time) bool {
	if !rule.Enabled {
		return false
	}
	if rule.StartAt > 0 && now.Unix() < rule.StartAt {
		return false
	}
	return rule.EndAt <= 0 || now.Unix() < rule.EndAt
}

func syncLotteryRechargeGrants(tx *gorm.DB, userId int, rules []LotteryChanceGrantRule, createdAt int64) error {
	rechargeRules := make([]LotteryChanceGrantRule, 0, len(rules))
	for _, rule := range rules {
		if rule.Enabled && rule.Type == LotteryChanceGrantRuleRecharge && rule.Threshold > 0 {
			rechargeRules = append(rechargeRules, rule)
		}
	}
	if len(rechargeRules) == 0 {
		return nil
	}

	var topUps []TopUp
	query := tx.Select("id", "amount", "money", "payment_provider", "create_time", "complete_time").
		Where("user_id = ? AND status = ? AND amount > 0", userId, common.TopUpStatusSuccess)
	var earliestStart int64
	var latestEnd int64
	openStart := false
	openEnd := false
	for _, rule := range rechargeRules {
		if rule.StartAt <= 0 {
			openStart = true
		} else if earliestStart == 0 || rule.StartAt < earliestStart {
			earliestStart = rule.StartAt
		}
		if rule.EndAt <= 0 {
			openEnd = true
		} else if rule.EndAt > latestEnd {
			latestEnd = rule.EndAt
		}
	}
	if !openStart && earliestStart > 0 {
		query = query.Where(
			"((complete_time > 0 AND complete_time >= ?) OR (COALESCE(complete_time, 0) <= 0 AND create_time >= ?))",
			earliestStart, earliestStart,
		)
	}
	if !openEnd && latestEnd > 0 {
		query = query.Where(
			"((complete_time > 0 AND complete_time < ?) OR (COALESCE(complete_time, 0) <= 0 AND create_time < ?))",
			latestEnd, latestEnd,
		)
	}
	if err := query.Order("id ASC").Find(&topUps).Error; err != nil {
		return err
	}
	for _, rule := range rechargeRules {
		limit := rule.Limit
		if limit == "" {
			limit = LotteryRechargeGrantCumulative
		}
		if limit == LotteryRechargeGrantCumulative {
			if err := syncCumulativeRechargeGrant(tx, userId, rule, topUps, createdAt); err != nil {
				return err
			}
			continue
		}
		if limit == LotteryRechargeGrantDaily {
			if err := syncDailyRechargeGrants(tx, userId, rule, topUps, createdAt); err != nil {
				return err
			}
			continue
		}
		for _, topUp := range topUps {
			when := topUp.CompleteTime
			if when <= 0 {
				when = topUp.CreateTime
			}
			if lotteryTopUpRechargeAmount(topUp).LessThan(decimal.NewFromFloat(rule.Threshold)) ||
				!lotteryRuleActive(rule, time.Unix(when, 0)) {
				continue
			}
			if err := createLotteryRechargeGrant(tx, userId, rule, fmt.Sprintf("recharge:%s:topup:%d", rule.Id, topUp.Id), createdAt); err != nil {
				return err
			}
		}
	}
	return nil
}

func lotteryTopUpRechargeAmount(topUp TopUp) decimal.Decimal {
	switch topUp.PaymentProvider {
	case PaymentProviderCreem:
		return decimal.NewFromInt(topUp.Amount).
			Div(decimal.NewFromFloat(common.QuotaPerUnit))
	case PaymentProviderStripe:
		return decimal.NewFromFloat(topUp.Money)
	default:
		return decimal.NewFromInt(topUp.Amount)
	}
}

func createLotteryRechargeGrant(tx *gorm.DB, userId int, rule LotteryChanceGrantRule, eventKey string, createdAt int64) error {
	return createLotteryGrantIfAbsent(tx, LotteryChanceGrant{
		EventKey: eventKey, UserId: userId, Type: "recharge_" + rule.Id,
		SourceName: rule.Name, Chances: rule.Chances,
		ExpiresAt: rule.EndAt, CreatedAt: createdAt,
	})
}

func syncCumulativeRechargeGrant(tx *gorm.DB, userId int, rule LotteryChanceGrantRule, topUps []TopUp, createdAt int64) error {
	var existing int64
	if err := tx.Model(&LotteryChanceGrant{}).
		Where("user_id = ? AND type = ?", userId, "recharge_"+rule.Id).
		Count(&existing).Error; err != nil {
		return err
	}
	if existing > 0 {
		return nil
	}
	accumulated := decimal.Zero
	threshold := decimal.NewFromFloat(rule.Threshold)
	for _, topUp := range topUps {
		when := topUp.CompleteTime
		if when <= 0 {
			when = topUp.CreateTime
		}
		if !lotteryRuleActive(rule, time.Unix(when, 0)) {
			continue
		}
		accumulated = accumulated.Add(lotteryTopUpRechargeAmount(topUp))
		if accumulated.GreaterThanOrEqual(threshold) {
			return createLotteryRechargeGrant(tx, userId, rule,
				fmt.Sprintf("recharge:%s:topup:%d", rule.Id, topUp.Id), createdAt)
		}
	}
	return nil
}

func syncDailyRechargeGrants(tx *gorm.DB, userId int, rule LotteryChanceGrantRule, topUps []TopUp, createdAt int64) error {
	totals := make(map[string]decimal.Decimal)
	topUpEventKeysByDay := make(map[string][]string)
	for _, topUp := range topUps {
		when := topUp.CompleteTime
		if when <= 0 {
			when = topUp.CreateTime
		}
		moment := time.Unix(when, 0)
		if !lotteryRuleActive(rule, moment) {
			continue
		}
		day := moment.In(time.Local).Format("2006-01-02")
		totals[day] = totals[day].Add(lotteryTopUpRechargeAmount(topUp))
		topUpEventKeysByDay[day] = append(topUpEventKeysByDay[day],
			fmt.Sprintf("recharge:%s:topup:%d", rule.Id, topUp.Id))
	}
	threshold := decimal.NewFromFloat(rule.Threshold)
	eligibleDays := make([]string, 0, len(totals))
	for day, total := range totals {
		if total.GreaterThanOrEqual(threshold) {
			eligibleDays = append(eligibleDays, day)
		}
	}
	if len(eligibleDays) == 0 {
		return nil
	}
	existingEventKeySet := make(map[string]struct{})
	var existingEventKeys []string
	if err := tx.Model(&LotteryChanceGrant{}).
		Where("user_id = ? AND type = ?", userId, "recharge_"+rule.Id).
		Pluck("event_key", &existingEventKeys).Error; err != nil {
		return err
	}
	for _, eventKey := range existingEventKeys {
		existingEventKeySet[eventKey] = struct{}{}
	}
	for _, day := range eligibleDays {
		legacyEventKey := fmt.Sprintf("recharge:%s:day:%s", rule.Id, day)
		currentEventKey := fmt.Sprintf("%s:user:%d", legacyEventKey, userId)
		existingDayEventKey := ""
		for _, eventKey := range []string{legacyEventKey, currentEventKey} {
			if _, exists := existingEventKeySet[eventKey]; exists {
				existingDayEventKey = eventKey
				break
			}
		}
		if existingDayEventKey != "" {
			// Reusing the existing day key keeps legacy rows intact while
			// refreshing their expiry when the rule configuration changes.
			if err := createLotteryRechargeGrant(tx, userId, rule,
				existingDayEventKey, createdAt); err != nil {
				return err
			}
			continue
		}
		alreadyGrantedByTopUp := false
		for _, eventKey := range topUpEventKeysByDay[day] {
			if _, exists := existingEventKeySet[eventKey]; exists {
				alreadyGrantedByTopUp = true
				break
			}
		}
		if alreadyGrantedByTopUp {
			continue
		}
		if err := createLotteryRechargeGrant(tx, userId, rule,
			currentEventKey, createdAt); err != nil {
			return err
		}
	}
	return nil
}

func lotteryCurrentStreak(
	activities []LotteryDailyActivity,
	now time.Time,
) int {
	if len(activities) == 0 {
		return 0
	}
	today := lotteryDayStart(now)
	expected := today
	startIndex := 0
	lastDate, err := time.ParseInLocation(
		"2006-01-02", activities[0].ActivityDate, time.Local,
	)
	if err != nil {
		return 0
	}
	if lastDate.Equal(today) && !activities[0].Active {
		startIndex = 1
		expected = today.AddDate(0, 0, -1)
	} else if lastDate.Before(today) {
		expected = today.AddDate(0, 0, -1)
	}
	streak := 0
	for _, activity := range activities[startIndex:] {
		day, parseErr := time.ParseInLocation(
			"2006-01-02", activity.ActivityDate, time.Local,
		)
		if parseErr != nil || !day.Equal(expected) || !activity.Active {
			break
		}
		streak++
		expected = expected.AddDate(0, 0, -1)
	}
	return streak
}

func getLotteryStatusAt(
	userId int,
	now time.Time,
) (LotteryStatus, error) {
	if userId <= 0 {
		return LotteryStatus{}, errors.New("invalid user")
	}
	config := GetLotteryConfig()
	if err := syncLotteryGrants(userId, now); err != nil {
		return LotteryStatus{}, err
	}
	var available int64
	if err := DB.Model(&LotteryChanceGrant{}).
		Where("user_id = ? AND (expires_at = 0 OR expires_at > ?)", userId, now.Unix()).
		Select("COALESCE(SUM(chances - consumed), 0)").
		Scan(&available).Error; err != nil {
		return LotteryStatus{}, err
	}
	var recentActivity []LotteryDailyActivity
	if err := DB.Where("user_id = ?", userId).
		Order("activity_date DESC").
		Limit(14).
		Find(&recentActivity).Error; err != nil {
		return LotteryStatus{}, err
	}
	var recentDraws []LotteryDraw
	if err := DB.Where("user_id = ?", userId).
		Order("created_at DESC, id DESC").
		Limit(10).
		Find(&recentDraws).Error; err != nil {
		return LotteryStatus{}, err
	}

	weeklyStart := lotteryWeekStart(now).Format("2006-01-02")
	today := lotteryDayStart(now).Format("2006-01-02")
	weeklyQuota := 0
	todayQuota := 0
	for _, activity := range recentActivity {
		if activity.ActivityDate >= weeklyStart &&
			activity.ActivityDate <= today {
			weeklyQuota += activity.Quota
		}
		if activity.ActivityDate == today {
			todayQuota = activity.Quota
		}
	}
	weeklyTarget := common.QuotaRound(float64(config.Rules.WeeklySpendAmount) * common.QuotaPerUnit)
	dailyTarget := common.QuotaRound(float64(config.Rules.DailyActiveAmount) * common.QuotaPerUnit)
	weeklyEarned := 0
	if weeklyTarget > 0 && config.Rules.WeeklyChanceLimit > 0 {
		weeklyEarned = weeklyQuota / weeklyTarget
	}
	if weeklyEarned > config.Rules.WeeklyChanceLimit {
		weeklyEarned = config.Rules.WeeklyChanceLimit
	}
	activeRules := make([]LotteryChanceGrantRule, 0)
	grantRules := make([]LotteryChanceGrantRule, 0)
	for _, rule := range config.GrantRules {
		if rule.Enabled {
			grantRules = append(grantRules, rule)
		}
		if rule.Enabled && lotteryRuleActive(rule, now) {
			activeRules = append(activeRules, rule)
		}
	}
	return LotteryStatus{
		AvailableChances:    int(available),
		WeeklySpendQuota:    weeklyQuota,
		WeeklyTargetQuota:   weeklyTarget,
		WeeklyEarnedChances: weeklyEarned,
		WeeklyChanceLimit:   config.Rules.WeeklyChanceLimit,
		TodaySpendQuota:     todayQuota,
		DailyActiveQuota:    dailyTarget,
		TodayActive:         todayQuota >= dailyTarget,
		CurrentStreak:       lotteryCurrentStreak(recentActivity, now),
		Prizes:              config.Prizes,
		RecentDraws:         recentDraws,
		RecentActivity:      recentActivity,
		Rules:               config.Rules,
		GrantRules:          grantRules,
		ActiveGrantRules:    activeRules,
	}, nil
}

func GetLotteryStatus(userId int) (LotteryStatus, error) {
	return getLotteryStatusAt(userId, time.Now())
}

func drawLotteryAt(
	userId int,
	now time.Time,
	roll int,
) (LotteryDrawResult, error) {
	if userId <= 0 || roll < 0 || roll >= 100 {
		return LotteryDrawResult{}, errors.New("invalid lottery draw")
	}
	statusBefore, err := getLotteryStatusAt(userId, now)
	if err != nil {
		return LotteryDrawResult{}, err
	}
	prize := lotteryPrizeForRoll(roll, statusBefore.Prizes)
	prizeQuota := common.QuotaRound(
		float64(prize.Amount) * common.QuotaPerUnit,
	)
	eventKey := "lottery-draw:" + common.GetUUID()
	draw := LotteryDraw{
		EventKey: eventKey, UserId: userId, Prize: prize.Type,
		Quota: prizeQuota, Status: LotteryDrawStatusAwarded,
		CreatedAt: now.Unix(),
	}
	if prizeQuota <= 0 {
		draw.Status = LotteryDrawStatusNoPrize
	}
	credited := false
	err = DB.Transaction(func(tx *gorm.DB) error {
		var grant LotteryChanceGrant
		if err := lockForUpdate(tx).
			Where("user_id = ? AND consumed < chances AND (expires_at = 0 OR expires_at > ?)", userId, now.Unix()).
			Order("created_at ASC, id ASC").
			First(&grant).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrNoLotteryChances
			}
			return err
		}
		result := tx.Model(&LotteryChanceGrant{}).
			Where(
				"id = ? AND consumed = ? AND consumed < chances AND (expires_at = 0 OR expires_at > ?)",
				grant.Id, grant.Consumed, now.Unix(),
			).
			Update("consumed", gorm.Expr("consumed + 1"))
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return errors.New("lottery chance was already consumed")
		}
		if err := tx.Create(&draw).Error; err != nil {
			return err
		}
		if prizeQuota <= 0 {
			return nil
		}
		if err := creditTopUpQuota(tx, userId, prizeQuota, nil); err != nil {
			return err
		}
		if err := CreateBillingTransaction(tx, &BillingTransaction{
			EventKey: eventKey, UserId: userId, Type: BillingTypeLottery,
			Quota: prizeQuota, Reference: eventKey,
			PaymentMethod: "lottery", Status: "success",
			CreatedAt: now.Unix(), Detail: prize.Type,
		}); err != nil {
			return err
		}
		credited = true
		return nil
	})
	if err != nil {
		return LotteryDrawResult{}, err
	}
	if credited {
		if err := invalidateUserCache(userId); err != nil {
			common.SysLog(
				"failed to invalidate user cache after lottery reward: " +
					err.Error(),
			)
		}
		RecordLog(
			userId,
			LogTypeSystem,
			fmt.Sprintf("抽奖获得额度 %s", logger.LogQuota(prizeQuota)),
		)
	} else {
		RecordLog(userId, LogTypeSystem, "参与抽奖，本次未中奖")
	}
	status, err := getLotteryStatusAt(userId, now)
	if err != nil {
		common.SysLog(
			"failed to refresh lottery status after committed draw: " +
				err.Error(),
		)
		if statusBefore.AvailableChances > 0 {
			statusBefore.AvailableChances--
		}
		statusBefore.RecentDraws = append(
			[]LotteryDraw{draw},
			statusBefore.RecentDraws...,
		)
		if len(statusBefore.RecentDraws) > 10 {
			statusBefore.RecentDraws = statusBefore.RecentDraws[:10]
		}
		return LotteryDrawResult{
			Draw: draw, Status: statusBefore,
		}, nil
	}
	return LotteryDrawResult{Draw: draw, Status: status}, nil
}

func DrawLottery(userId int) (LotteryDrawResult, error) {
	roll, err := rand.Int(rand.Reader, big.NewInt(100))
	if err != nil {
		return LotteryDrawResult{}, err
	}
	return drawLotteryAt(userId, time.Now(), int(roll.Int64()))
}

func GetUserLotteryDraws(userId int, page int, pageSize int) (LotteryUserDrawPage, error) {
	if userId <= 0 {
		return LotteryUserDrawPage{}, errors.New("invalid user")
	}
	page, pageSize = normalizeLotteryDrawPage(page, pageSize)
	query := DB.Model(&LotteryDraw{}).Where("user_id = ?", userId)
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return LotteryUserDrawPage{}, err
	}
	items := make([]LotteryDraw, 0, pageSize)
	if err := query.Order("created_at DESC, id DESC").
		Offset((page - 1) * pageSize).
		Limit(pageSize).
		Find(&items).Error; err != nil {
		return LotteryUserDrawPage{}, err
	}
	return LotteryUserDrawPage{
		Items: items, Total: total, Page: page, PageSize: pageSize,
	}, nil
}

func RevokeLotteryReward(drawId int64, operatorUserId int, reason string) error {
	reason = strings.TrimSpace(reason)
	if drawId <= 0 || operatorUserId <= 0 || len(reason) < 2 || len(reason) > 200 {
		return ErrLotteryDrawNotReversible
	}
	var draw LotteryDraw
	err := DB.Transaction(func(tx *gorm.DB) error {
		if err := lockForUpdate(tx).First(&draw, drawId).Error; err != nil {
			return err
		}
		if draw.Status == LotteryDrawStatusRevoked {
			return ErrLotteryDrawAlreadyRevoked
		}
		if draw.Quota <= 0 || draw.EventKey == "" {
			return ErrLotteryDrawNotReversible
		}
		reversalKey := fmt.Sprintf("lottery-reversal:%d", draw.Id)
		created, err := createBillingTransactionIfAbsent(tx, &BillingTransaction{
			EventKey: reversalKey, UserId: draw.UserId,
			Type: BillingTypeLotteryReversal, Quota: -draw.Quota,
			Reference: draw.EventKey, PaymentMethod: "lottery",
			Status: "success", OperatorUserId: operatorUserId,
			CreatedAt: common.GetTimestamp(), Detail: reason,
		})
		if err != nil {
			return err
		}
		if !created {
			return ErrLotteryDrawAlreadyRevoked
		}
		if err := tx.Model(&User{}).Where("id = ?", draw.UserId).
			Update("quota", gorm.Expr("quota - ?", draw.Quota)).Error; err != nil {
			return err
		}
		now := common.GetTimestamp()
		return tx.Model(&LotteryDraw{}).Where("id = ?", draw.Id).Updates(map[string]any{
			"status": LotteryDrawStatusRevoked, "revoked_at": now,
			"revoked_by": operatorUserId, "revoke_reason": reason,
		}).Error
	})
	if err != nil {
		return err
	}
	if err := invalidateUserCache(draw.UserId); err != nil {
		common.SysLog("failed to invalidate user cache after lottery reversal: " + err.Error())
	}
	RecordLog(
		draw.UserId,
		LogTypeSystem,
		fmt.Sprintf("抽奖奖励撤回 %s", logger.LogQuota(draw.Quota)),
	)
	return nil
}

func normalizeLotteryDrawPage(page int, pageSize int) (int, int) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 20
	}
	if pageSize > 100 {
		pageSize = 100
	}
	return page, pageSize
}

func GetAllLotteryDraws(page int, pageSize int, filter LotteryDrawFilter) (LotteryDrawPage, error) {
	page, pageSize = normalizeLotteryDrawPage(page, pageSize)
	if filter.Result != "" && filter.Result != "won" && filter.Result != "none" {
		return LotteryDrawPage{}, errors.New("invalid lottery result filter")
	}
	query := DB.Table("lottery_draws AS draws").
		Joins("LEFT JOIN users ON users.id = draws.user_id")
	keyword := strings.TrimSpace(filter.UserKeyword)
	if keyword != "" {
		if userId, err := strconv.Atoi(keyword); err == nil && userId > 0 {
			query = query.Where("draws.user_id = ?", userId)
		} else {
			pattern, err := sanitizeLikePattern("%" + strings.ToLower(keyword) + "%")
			if err != nil {
				return LotteryDrawPage{}, err
			}
			query = query.Where(
				"(LOWER(COALESCE(users.username, '')) LIKE ? ESCAPE '!' OR LOWER(COALESCE(users.display_name, '')) LIKE ? ESCAPE '!')",
				pattern,
				pattern,
			)
		}
	}
	if filter.Result == "won" {
		query = query.Where("draws.quota > 0")
	} else if filter.Result == "none" {
		query = query.Where("draws.quota <= 0")
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return LotteryDrawPage{}, err
	}
	items := make([]LotteryDrawAdminItem, 0)
	err := query.
		Select("draws.id, draws.user_id, COALESCE(users.username, '') AS username, draws.prize, draws.quota, draws.status, draws.event_key AS event_reference, draws.revoked_at, draws.revoked_by, draws.revoke_reason, draws.created_at").
		Order("draws.created_at DESC, draws.id DESC").
		Offset((page - 1) * pageSize).
		Limit(pageSize).
		Scan(&items).Error
	if err != nil {
		return LotteryDrawPage{}, err
	}
	return LotteryDrawPage{
		Items: items, Total: total, Page: page, PageSize: pageSize,
	}, nil
}

func CreateManualLotteryGrant(input LotteryManualGrantInput) (LotteryGrantAdminItem, error) {
	userKeyword := strings.TrimSpace(input.UserKeyword)
	reason := strings.TrimSpace(input.Reason)
	requestId := strings.TrimSpace(input.RequestId)
	rechargeRuleId := strings.TrimSpace(input.RechargeRuleId)
	rechargeDate := strings.TrimSpace(input.RechargeDate)
	chances := input.Chances
	expiresAt := input.ExpiresAt
	operatorUserId := input.OperatorUserId
	reasonLength := utf8.RuneCountInString(reason)
	if userKeyword == "" || chances < 1 || chances > 1000 || reasonLength < 2 || reasonLength > 200 || operatorUserId <= 0 || len(requestId) < 8 || len(requestId) > 64 {
		return LotteryGrantAdminItem{}, ErrInvalidLotteryManualGrant
	}
	for _, character := range requestId {
		if (character < 'a' || character > 'z') && (character < 'A' || character > 'Z') && (character < '0' || character > '9') && character != '-' && character != '_' {
			return LotteryGrantAdminItem{}, ErrInvalidLotteryManualGrant
		}
	}
	now := time.Now()
	nowUnix := now.Unix()
	linkedRecharge := rechargeRuleId != "" || rechargeDate != ""
	if (rechargeRuleId == "") != (rechargeDate == "") {
		return LotteryGrantAdminItem{}, ErrInvalidLotteryManualGrant
	}
	var rechargeRule LotteryChanceGrantRule
	if linkedRecharge {
		rechargeDay, err := time.ParseInLocation("2006-01-02", rechargeDate, time.Local)
		if err != nil || rechargeDay.Format("2006-01-02") != rechargeDate || rechargeDay.After(lotteryDayStart(now)) {
			return LotteryGrantAdminItem{}, ErrInvalidLotteryManualGrant
		}
		found := false
		for _, rule := range GetLotteryConfig().GrantRules {
			if rule.Id == rechargeRuleId {
				rechargeRule = rule
				found = true
				break
			}
		}
		if !found || !rechargeRule.Enabled || rechargeRule.Type != LotteryChanceGrantRuleRecharge ||
			rechargeRule.Limit != LotteryRechargeGrantDaily || !lotteryRuleActive(rechargeRule, now) ||
			chances != rechargeRule.Chances {
			return LotteryGrantAdminItem{}, ErrInvalidLotteryManualGrant
		}
		dayEnd := rechargeDay.AddDate(0, 0, 1)
		if (rechargeRule.StartAt > 0 && dayEnd.Unix() <= rechargeRule.StartAt) ||
			(rechargeRule.EndAt > 0 && rechargeDay.Unix() >= rechargeRule.EndAt) {
			return LotteryGrantAdminItem{}, ErrInvalidLotteryManualGrant
		}
		expiresAt = rechargeRule.EndAt
	}
	if expiresAt > 0 && expiresAt <= nowUnix {
		return LotteryGrantAdminItem{}, ErrInvalidLotteryManualGrant
	}

	var target User
	if userId, err := strconv.Atoi(userKeyword); err == nil && userId > 0 {
		if err := DB.Select("id", "username").First(&target, "id = ?", userId).Error; err != nil {
			if !errors.Is(err, gorm.ErrRecordNotFound) {
				return LotteryGrantAdminItem{}, err
			}
			if err := DB.Select("id", "username").Where("LOWER(username) = ?", strings.ToLower(userKeyword)).First(&target).Error; err != nil {
				if errors.Is(err, gorm.ErrRecordNotFound) {
					return LotteryGrantAdminItem{}, ErrLotteryGrantTargetNotFound
				}
				return LotteryGrantAdminItem{}, err
			}
		}
	} else {
		if err := DB.Select("id", "username").Where("LOWER(username) = ?", strings.ToLower(userKeyword)).First(&target).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return LotteryGrantAdminItem{}, ErrLotteryGrantTargetNotFound
			}
			return LotteryGrantAdminItem{}, err
		}
	}

	eventKey := fmt.Sprintf("manual:%d:%s", operatorUserId, requestId)
	if linkedRecharge {
		eventKey = fmt.Sprintf("recharge:%s:day:%s:user:%d", rechargeRule.Id, rechargeDate, target.Id)
	}
	created := false
	var grant LotteryChanceGrant
	err := DB.Transaction(func(tx *gorm.DB) error {
		candidate := LotteryChanceGrant{
			EventKey: eventKey, UserId: target.Id, Type: LotteryGrantTypeManual,
			SourceName: LotteryGrantSourceManual, Chances: chances, ExpiresAt: expiresAt,
			CreatedAt: nowUnix, OperatorUserId: operatorUserId, Detail: reason,
		}
		result := tx.Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "event_key"}},
			DoNothing: true,
		}).Create(&candidate)
		if result.Error != nil {
			return result.Error
		}
		created = result.RowsAffected == 1
		if err := tx.Where("event_key = ?", eventKey).First(&grant).Error; err != nil {
			return err
		}
		if grant.UserId != target.Id || grant.Type != LotteryGrantTypeManual || grant.Chances != chances || grant.ExpiresAt != expiresAt || grant.Detail != reason || grant.OperatorUserId != operatorUserId {
			return ErrLotteryManualGrantConflict
		}
		return nil
	})
	if err != nil {
		return LotteryGrantAdminItem{}, err
	}
	if created {
		adminInfo := &AuditAdminInfo{
			AdminID:        operatorUserId,
			OperatorUserID: operatorUserId,
			LotteryGrantID: grant.Id,
		}
		if linkedRecharge {
			adminInfo.RechargeRuleID = rechargeRule.Id
			adminInfo.RechargeDate = rechargeDate
		}
		RecordLogWithAdminInfo(target.Id, LogTypeSystem, fmt.Sprintf("管理员手动赠送 %d 次抽奖机会，原因：%s", chances, reason), adminInfo, nil)
	}
	return LotteryGrantAdminItem{
		Id: grant.Id, UserId: target.Id, Username: target.Username,
		Type: grant.Type, SourceName: grant.SourceName, EventReference: grant.EventKey,
		Chances: grant.Chances, Consumed: grant.Consumed, ExpiresAt: grant.ExpiresAt,
		CreatedAt: grant.CreatedAt, OperatorUserId: grant.OperatorUserId, Detail: grant.Detail,
	}, nil
}

func GetAllLotteryGrants(page int, pageSize int, filter LotteryGrantFilter) (LotteryGrantPage, error) {
	page, pageSize = normalizeLotteryDrawPage(page, pageSize)
	validSource := map[string]bool{"": true, "recharge": true, "event": true, "weekly": true, "streak": true, "manual": true}
	validStatus := map[string]bool{"": true, "available": true, "used": true, "expired": true}
	if !validSource[filter.Source] || !validStatus[filter.Status] {
		return LotteryGrantPage{}, errors.New("invalid lottery grant filter")
	}

	query := DB.Table("lottery_chance_grants AS grants").
		Joins("LEFT JOIN users ON users.id = grants.user_id")
	keyword := strings.TrimSpace(filter.UserKeyword)
	if keyword != "" {
		if userId, err := strconv.Atoi(keyword); err == nil && userId > 0 {
			query = query.Where("grants.user_id = ?", userId)
		} else {
			pattern, err := sanitizeLikePattern("%" + strings.ToLower(keyword) + "%")
			if err != nil {
				return LotteryGrantPage{}, err
			}
			query = query.Where(
				"(LOWER(COALESCE(users.username, '')) LIKE ? ESCAPE '!' OR LOWER(COALESCE(users.display_name, '')) LIKE ? ESCAPE '!')",
				pattern,
				pattern,
			)
		}
	}
	switch filter.Source {
	case "recharge":
		query = query.Where("grants.type LIKE ?", "recharge_%")
	case "event":
		query = query.Where("grants.type LIKE ?", "campaign_%")
	case "weekly":
		query = query.Where("grants.type = ?", LotteryGrantTypeWeeklySpend)
	case "streak":
		query = query.Where("grants.type LIKE ?", "streak_%")
	case "manual":
		query = query.Where("grants.type = ?", LotteryGrantTypeManual)
	}
	now := common.GetTimestamp()
	switch filter.Status {
	case "available":
		query = query.Where("grants.consumed < grants.chances AND (grants.expires_at = 0 OR grants.expires_at > ?)", now)
	case "used":
		query = query.Where("grants.consumed >= grants.chances AND (grants.expires_at = 0 OR grants.expires_at > ?)", now)
	case "expired":
		query = query.Where("grants.expires_at > 0 AND grants.expires_at <= ?", now)
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		return LotteryGrantPage{}, err
	}
	items := make([]LotteryGrantAdminItem, 0, pageSize)
	if err := query.
		Select("grants.id, grants.user_id, COALESCE(users.username, '') AS username, grants.type, grants.source_name, grants.event_key AS event_reference, grants.chances, grants.consumed, grants.expires_at, grants.created_at, grants.operator_user_id, grants.detail").
		Order("grants.created_at DESC, grants.id DESC").
		Offset((page - 1) * pageSize).
		Limit(pageSize).
		Scan(&items).Error; err != nil {
		return LotteryGrantPage{}, err
	}

	ruleNames := make(map[string]string)
	for _, rule := range GetLotteryConfig().GrantRules {
		ruleNames[rule.Id] = rule.Name
	}
	for index := range items {
		grantType := items[index].Type
		switch {
		case strings.HasPrefix(grantType, "recharge_"):
			if items[index].SourceName == "" {
				items[index].SourceName = ruleNames[strings.TrimPrefix(grantType, "recharge_")]
			}
		case strings.HasPrefix(grantType, "campaign_"):
			if items[index].SourceName == "" {
				items[index].SourceName = ruleNames[strings.TrimPrefix(grantType, "campaign_")]
			}
		}
	}
	return LotteryGrantPage{
		Items: items, Total: total, Page: page, PageSize: pageSize,
	}, nil
}
