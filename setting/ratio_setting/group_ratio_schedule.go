package ratio_setting

import (
	"errors"
	"fmt"
	"math"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
)

const (
	GroupRatioScheduleOptionKey  = "GroupRatioSchedule"
	groupRatioScheduleMaxGroups  = 512
	groupRatioScheduleMaxPeriods = 64
)

// GroupRatioSchedulePeriod describes one absolute group-ratio override.
// An empty Days and Date means that the period applies every day.
type GroupRatioSchedulePeriod struct {
	Date    string  `json:"date,omitempty"`
	Days    []int   `json:"days,omitempty"`
	Start   string  `json:"start"`
	End     string  `json:"end"`
	Ratio   float64 `json:"ratio"`
	Enabled *bool   `json:"enabled,omitempty"`
}

func (period GroupRatioSchedulePeriod) IsEnabled() bool {
	return period.Enabled == nil || *period.Enabled
}

type GroupRatioSchedule struct {
	Enabled bool                       `json:"enabled"`
	Periods []GroupRatioSchedulePeriod `json:"periods"`
}

var (
	groupRatioScheduleMu sync.RWMutex
	groupRatioSchedules  = map[string]GroupRatioSchedule{}
)

func GroupRatioSchedule2JSONString() string {
	groupRatioScheduleMu.RLock()
	copy := cloneGroupRatioSchedules(groupRatioSchedules)
	groupRatioScheduleMu.RUnlock()
	data, err := common.Marshal(copy)
	if err != nil {
		common.SysError("failed to marshal group ratio schedules: " + err.Error())
		return "{}"
	}
	return string(data)
}

func UpdateGroupRatioScheduleByJSONString(jsonString string) error {
	parsed, err := parseGroupRatioSchedules(jsonString)
	if err != nil {
		return err
	}
	groupRatioScheduleMu.Lock()
	groupRatioSchedules = parsed
	groupRatioScheduleMu.Unlock()
	return nil
}

func CheckGroupRatioSchedule(jsonString string) error {
	_, err := parseGroupRatioSchedules(jsonString)
	return err
}

func GetGroupRatioSchedule(group string) (GroupRatioSchedule, bool) {
	groupRatioScheduleMu.RLock()
	schedule, ok := groupRatioSchedules[group]
	groupRatioScheduleMu.RUnlock()
	if !ok {
		return GroupRatioSchedule{}, false
	}
	return cloneGroupRatioSchedule(schedule), true
}

// GetEffectiveGroupRatio returns the base group ratio, optionally overridden by
// the first enabled period matching now. The selected ratio is absolute, not an
// additional multiplier.
func GetEffectiveGroupRatio(group string, now time.Time) (ratio float64, enabled bool, active bool) {
	ratio = GetGroupRatio(group)
	schedule, configured := GetGroupRatioSchedule(group)
	if !configured || !schedule.Enabled {
		return ratio, false, false
	}
	for _, period := range schedule.Periods {
		if period.IsEnabled() && periodMatches(period, now) {
			return period.Ratio, true, true
		}
	}
	return ratio, true, false
}

func parseGroupRatioSchedules(jsonString string) (map[string]GroupRatioSchedule, error) {
	jsonString = strings.TrimSpace(jsonString)
	if jsonString == "" {
		return map[string]GroupRatioSchedule{}, nil
	}
	parsed := map[string]GroupRatioSchedule{}
	if err := common.Unmarshal([]byte(jsonString), &parsed); err != nil {
		return nil, fmt.Errorf("group ratio schedule JSON is invalid: %w", err)
	}
	if len(parsed) > groupRatioScheduleMaxGroups {
		return nil, fmt.Errorf("group ratio schedules cannot contain more than %d groups", groupRatioScheduleMaxGroups)
	}
	for rawGroup, schedule := range parsed {
		group := strings.TrimSpace(rawGroup)
		if group == "" {
			return nil, errors.New("group ratio schedule group cannot be empty")
		}
		if len(schedule.Periods) > groupRatioScheduleMaxPeriods {
			return nil, fmt.Errorf("group %s cannot contain more than %d periods", group, groupRatioScheduleMaxPeriods)
		}
		for index, period := range schedule.Periods {
			if err := validateGroupRatioSchedulePeriod(period); err != nil {
				return nil, fmt.Errorf("group %s period %d: %w", group, index+1, err)
			}
		}
		if rawGroup != group {
			delete(parsed, rawGroup)
			parsed[group] = schedule
		}
	}
	return parsed, nil
}

func validateGroupRatioSchedulePeriod(period GroupRatioSchedulePeriod) error {
	if _, err := parseScheduleMinute(period.Start); err != nil {
		return fmt.Errorf("invalid start time: %w", err)
	}
	if _, err := parseScheduleMinute(period.End); err != nil {
		return fmt.Errorf("invalid end time: %w", err)
	}
	if period.Date != "" {
		if _, err := time.Parse("2006-01-02", period.Date); err != nil {
			return fmt.Errorf("invalid date %q", period.Date)
		}
		if len(period.Days) > 0 {
			return errors.New("date and weekdays cannot be configured together")
		}
	}
	seenDays := make(map[int]struct{}, len(period.Days))
	for _, day := range period.Days {
		if day < 0 || day > 6 {
			return errors.New("weekday must be between 0 (Sunday) and 6 (Saturday)")
		}
		if _, exists := seenDays[day]; exists {
			return fmt.Errorf("weekday %d is duplicated", day)
		}
		seenDays[day] = struct{}{}
	}
	if math.IsNaN(period.Ratio) || math.IsInf(period.Ratio, 0) || period.Ratio < 0 {
		return errors.New("ratio must be a finite number greater than or equal to 0")
	}
	return nil
}

func parseScheduleMinute(value string) (int, error) {
	parsed, err := time.Parse("15:04", value)
	if err != nil {
		return 0, errors.New("time must use HH:MM format")
	}
	return parsed.Hour()*60 + parsed.Minute(), nil
}

func periodMatches(period GroupRatioSchedulePeriod, now time.Time) bool {
	start, _ := parseScheduleMinute(period.Start)
	end, _ := parseScheduleMinute(period.End)
	minute := now.Hour()*60 + now.Minute()
	if period.Date != "" {
		date := now.Format("2006-01-02")
		if start > end && minute <= end {
			date = now.AddDate(0, 0, -1).Format("2006-01-02")
		}
		if period.Date != date {
			return false
		}
	}
	if start <= end {
		return minute >= start && minute <= end && weekdayMatches(period.Days, now.Weekday())
	}
	if minute >= start {
		return weekdayMatches(period.Days, now.Weekday())
	}
	previousDay := (int(now.Weekday()) + 6) % 7
	return minute <= end && weekdayMatches(period.Days, time.Weekday(previousDay))
}

func weekdayMatches(days []int, weekday time.Weekday) bool {
	if len(days) == 0 {
		return true
	}
	for _, day := range days {
		if day == int(weekday) {
			return true
		}
	}
	return false
}

func cloneGroupRatioSchedules(source map[string]GroupRatioSchedule) map[string]GroupRatioSchedule {
	result := make(map[string]GroupRatioSchedule, len(source))
	for group, schedule := range source {
		result[group] = cloneGroupRatioSchedule(schedule)
	}
	return result
}

func cloneGroupRatioSchedule(schedule GroupRatioSchedule) GroupRatioSchedule {
	schedule.Periods = append([]GroupRatioSchedulePeriod(nil), schedule.Periods...)
	for index := range schedule.Periods {
		schedule.Periods[index].Days = append([]int(nil), schedule.Periods[index].Days...)
		if schedule.Periods[index].Enabled != nil {
			enabled := *schedule.Periods[index].Enabled
			schedule.Periods[index].Enabled = &enabled
		}
	}
	return schedule
}
