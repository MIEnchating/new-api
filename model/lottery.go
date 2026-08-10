package model

import (
	"crypto/rand"
	"errors"
	"fmt"
	"math/big"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
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
)

var ErrNoLotteryChances = errors.New("no lottery chances available")
var ErrLotteryDrawNotReversible = errors.New("lottery draw cannot be reversed")
var ErrLotteryDrawAlreadyRevoked = errors.New("lottery reward already revoked")

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
	Id        int64  `json:"id"`
	EventKey  string `json:"-" gorm:"type:varchar(128);uniqueIndex"`
	UserId    int    `json:"-" gorm:"index:idx_lottery_grant_user_time,priority:1"`
	Type      string `json:"type" gorm:"type:varchar(32);index"`
	Chances   int    `json:"chances"`
	Consumed  int    `json:"consumed"`
	CreatedAt int64  `json:"created_at" gorm:"bigint;index:idx_lottery_grant_user_time,priority:2"`
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
	Amount      int    `json:"amount"`
	Probability int    `json:"probability"`
}

type LotteryStatus struct {
	AvailableChances    int                    `json:"available_chances"`
	WeeklySpendQuota    int                    `json:"weekly_spend_quota"`
	WeeklyTargetQuota   int                    `json:"weekly_target_quota"`
	WeeklyEarnedChances int                    `json:"weekly_earned_chances"`
	WeeklyChanceLimit   int                    `json:"weekly_chance_limit"`
	TodaySpendQuota     int                    `json:"today_spend_quota"`
	DailyActiveQuota    int                    `json:"daily_active_quota"`
	TodayActive         bool                   `json:"today_active"`
	CurrentStreak       int                    `json:"current_streak"`
	Prizes              []LotteryPrize         `json:"prizes"`
	RecentDraws         []LotteryDraw          `json:"recent_draws"`
	RecentActivity      []LotteryDailyActivity `json:"recent_activity"`
}

type LotteryDrawResult struct {
	Draw   LotteryDraw   `json:"draw"`
	Status LotteryStatus `json:"status"`
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

func lotteryPrizePool() []LotteryPrize {
	return []LotteryPrize{
		{Type: LotteryPrizeOne, Amount: 1, Probability: 50},
		{Type: LotteryPrizeFive, Amount: 5, Probability: 20},
		{Type: LotteryPrizeEight, Amount: 8, Probability: 5},
		{Type: LotteryPrizeNone, Probability: 25},
	}
}

func validateLotteryPrizePool(prizes []LotteryPrize) error {
	if len(prizes) != 4 {
		return errors.New("lottery prize pool must contain three prizes and one no-prize entry")
	}
	allowedTypes := map[string]bool{
		LotteryPrizeOne: false, LotteryPrizeFive: false,
		LotteryPrizeEight: false, LotteryPrizeNone: false,
	}
	totalProbability := 0
	for _, prize := range prizes {
		if _, ok := allowedTypes[prize.Type]; !ok || allowedTypes[prize.Type] {
			return errors.New("lottery prize types must be unique and supported")
		}
		allowedTypes[prize.Type] = true
		if prize.Probability < 0 || prize.Probability > 100 {
			return errors.New("lottery prize probability must be between 0 and 100")
		}
		if prize.Type == LotteryPrizeNone {
			if prize.Amount != 0 {
				return errors.New("no-prize amount must be zero")
			}
		} else if prize.Amount <= 0 || prize.Amount > 10000 {
			return errors.New("lottery prize amount must be between 1 and 10000")
		}
		totalProbability += prize.Probability
	}
	if totalProbability != 100 {
		return errors.New("lottery prize probabilities must total 100")
	}
	return nil
}

func GetLotteryPrizePool() []LotteryPrize {
	common.OptionMapRWMutex.RLock()
	raw := common.OptionMap[LotteryPrizePoolOptionKey]
	common.OptionMapRWMutex.RUnlock()
	if strings.TrimSpace(raw) == "" {
		return lotteryPrizePool()
	}
	var prizes []LotteryPrize
	if err := common.UnmarshalJsonStr(raw, &prizes); err != nil || validateLotteryPrizePool(prizes) != nil {
		common.SysError("invalid lottery prize pool option; using defaults")
		return lotteryPrizePool()
	}
	return prizes
}

func UpdateLotteryPrizePool(prizes []LotteryPrize) error {
	if err := validateLotteryPrizePool(prizes); err != nil {
		return err
	}
	data, err := common.Marshal(prizes)
	if err != nil {
		return err
	}
	return UpdateOptionsBulk(map[string]string{
		LotteryPrizePoolOptionKey: string(data),
	})
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
		LotteryDailyActiveAmount * common.QuotaPerUnit,
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
		Columns:   []clause.Column{{Name: "event_key"}},
		DoNothing: true,
	}).Create(&grant).Error
}

func syncLotteryGrants(userId int, now time.Time) error {
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
	weeklyTarget := common.QuotaRound(
		LotteryWeeklySpendAmount * common.QuotaPerUnit,
	)
	weeklyEarned := 0
	if weeklyTarget > 0 {
		weeklyEarned = weeklyQuota / weeklyTarget
	}
	if weeklyEarned > LotteryWeeklyChanceLimit {
		weeklyEarned = LotteryWeeklyChanceLimit
	}
	year, week := lotteryWeekStart(now).ISOWeek()
	nowUnix := now.Unix()

	return DB.Transaction(func(tx *gorm.DB) error {
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
			switch streak {
			case 3:
				if err := createLotteryGrantIfAbsent(
					tx,
					LotteryChanceGrant{
						EventKey: fmt.Sprintf(
							"streak:3:%s:%d",
							activity.ActivityDate, userId,
						),
						UserId: userId, Type: LotteryGrantTypeStreak3,
						Chances: 1, CreatedAt: nowUnix,
					},
				); err != nil {
					return err
				}
			case 7:
				if err := createLotteryGrantIfAbsent(
					tx,
					LotteryChanceGrant{
						EventKey: fmt.Sprintf(
							"streak:7:%s:%d",
							activity.ActivityDate, userId,
						),
						UserId: userId, Type: LotteryGrantTypeStreak7,
						Chances: 3, CreatedAt: nowUnix,
					},
				); err != nil {
					return err
				}
			}
		}
		return nil
	})
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
	if err := syncLotteryGrants(userId, now); err != nil {
		return LotteryStatus{}, err
	}
	var available int64
	if err := DB.Model(&LotteryChanceGrant{}).
		Where("user_id = ?", userId).
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
	weeklyTarget := common.QuotaRound(
		LotteryWeeklySpendAmount * common.QuotaPerUnit,
	)
	dailyTarget := common.QuotaRound(
		LotteryDailyActiveAmount * common.QuotaPerUnit,
	)
	weeklyEarned := 0
	if weeklyTarget > 0 {
		weeklyEarned = weeklyQuota / weeklyTarget
	}
	if weeklyEarned > LotteryWeeklyChanceLimit {
		weeklyEarned = LotteryWeeklyChanceLimit
	}
	return LotteryStatus{
		AvailableChances:    int(available),
		WeeklySpendQuota:    weeklyQuota,
		WeeklyTargetQuota:   weeklyTarget,
		WeeklyEarnedChances: weeklyEarned,
		WeeklyChanceLimit:   LotteryWeeklyChanceLimit,
		TodaySpendQuota:     todayQuota,
		DailyActiveQuota:    dailyTarget,
		TodayActive:         todayQuota >= dailyTarget,
		CurrentStreak:       lotteryCurrentStreak(recentActivity, now),
		Prizes:              GetLotteryPrizePool(),
		RecentDraws:         recentDraws,
		RecentActivity:      recentActivity,
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
			Where("user_id = ? AND consumed < chances", userId).
			Order("created_at ASC, id ASC").
			First(&grant).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrNoLotteryChances
			}
			return err
		}
		result := tx.Model(&LotteryChanceGrant{}).
			Where(
				"id = ? AND consumed = ? AND consumed < chances",
				grant.Id, grant.Consumed,
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
		if err := tx.Model(&User{}).Where("id = ?", userId).
			Update("quota", gorm.Expr("quota + ?", prizeQuota)).Error; err != nil {
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
