package ratio_setting

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func setupGroupRatioScheduleTest(t *testing.T) {
	t.Helper()
	original := GroupRatioSchedule2JSONString()
	t.Cleanup(func() {
		require.NoError(t, UpdateGroupRatioScheduleByJSONString(original))
	})
}

func scheduleTestTime(t *testing.T, value string) time.Time {
	t.Helper()
	parsed, err := time.ParseInLocation("2006-01-02 15:04", value, time.UTC)
	require.NoError(t, err)
	return parsed
}

func TestGroupRatioScheduleMatchesDailyAndWeekdayPeriods(t *testing.T) {
	setupGroupRatioScheduleTest(t)
	require.NoError(t, UpdateGroupRatioScheduleByJSONString(`{
		"daily": {"enabled": true, "periods": [
			{"start":"23:00","end":"23:59","ratio":0.25,"enabled":true}
		]},
		"weekday": {"enabled": true, "periods": [
			{"days":[1,3,5],"start":"08:00","end":"10:00","ratio":0.5,"enabled":true}
		]}
	}`))

	ratio, enabled, active := GetEffectiveGroupRatio("daily", scheduleTestTime(t, "2026-08-05 23:30"))
	assert.Equal(t, 0.25, ratio)
	assert.True(t, enabled)
	assert.True(t, active)

	ratio, enabled, active = GetEffectiveGroupRatio("weekday", scheduleTestTime(t, "2026-08-05 09:00"))
	assert.Equal(t, 0.5, ratio)
	assert.True(t, enabled)
	assert.True(t, active)

	_, _, active = GetEffectiveGroupRatio("weekday", scheduleTestTime(t, "2026-08-06 09:00"))
	assert.False(t, active)
}

func TestGroupRatioScheduleMatchesOvernightStartDay(t *testing.T) {
	setupGroupRatioScheduleTest(t)
	require.NoError(t, UpdateGroupRatioScheduleByJSONString(`{
		"weekday": {"enabled": true, "periods": [
			{"days":[3],"start":"23:00","end":"02:00","ratio":0.2}
		]},
		"date": {"enabled": true, "periods": [
			{"date":"2026-08-05","start":"23:00","end":"02:00","ratio":0.3}
		]}
	}`))

	ratio, _, active := GetEffectiveGroupRatio("weekday", scheduleTestTime(t, "2026-08-06 01:30"))
	assert.Equal(t, 0.2, ratio)
	assert.True(t, active)

	ratio, _, active = GetEffectiveGroupRatio("date", scheduleTestTime(t, "2026-08-06 01:30"))
	assert.Equal(t, 0.3, ratio)
	assert.True(t, active)

	_, _, active = GetEffectiveGroupRatio("date", scheduleTestTime(t, "2026-08-07 01:30"))
	assert.False(t, active)
}

func TestGroupRatioScheduleHonorsSwitchesAndFirstMatch(t *testing.T) {
	setupGroupRatioScheduleTest(t)
	require.NoError(t, UpdateGroupRatioScheduleByJSONString(`{
		"disabled": {"enabled": false, "periods": [
			{"start":"00:00","end":"23:59","ratio":0.1}
		]},
		"first": {"enabled": true, "periods": [
			{"start":"00:00","end":"23:59","ratio":0.4,"enabled":false},
			{"start":"00:00","end":"23:59","ratio":0.6,"enabled":true},
			{"start":"00:00","end":"23:59","ratio":0.8,"enabled":true}
		]}
	}`))

	_, enabled, active := GetEffectiveGroupRatio("disabled", scheduleTestTime(t, "2026-08-05 12:00"))
	assert.False(t, enabled)
	assert.False(t, active)

	ratio, enabled, active := GetEffectiveGroupRatio("first", scheduleTestTime(t, "2026-08-05 12:00"))
	assert.Equal(t, 0.6, ratio)
	assert.True(t, enabled)
	assert.True(t, active)
}

func TestGroupRatioScheduleRejectsInvalidPeriodsWithoutReplacingState(t *testing.T) {
	setupGroupRatioScheduleTest(t)
	require.NoError(t, UpdateGroupRatioScheduleByJSONString(`{
		"valid": {"enabled": true, "periods": [
			{"start":"00:00","end":"23:59","ratio":0.5}
		]}
	}`))

	tests := []string{
		`{"bad":{"enabled":true,"periods":[{"start":"24:00","end":"23:59","ratio":1}]}}`,
		`{"bad":{"enabled":true,"periods":[{"date":"2026-02-30","start":"00:00","end":"01:00","ratio":1}]}}`,
		`{"bad":{"enabled":true,"periods":[{"days":[7],"start":"00:00","end":"01:00","ratio":1}]}}`,
		`{"bad":{"enabled":true,"periods":[{"start":"00:00","end":"01:00","ratio":-1}]}}`,
	}
	for _, input := range tests {
		require.Error(t, UpdateGroupRatioScheduleByJSONString(input))
	}

	_, exists := GetGroupRatioSchedule("valid")
	assert.True(t, exists)
}
