package model

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
	"gorm.io/gorm/utils/tests"
)

func buildChannelSortSQL(t *testing.T, options ChannelSortOptions) string {
	t.Helper()
	db, err := gorm.Open(tests.DummyDialector{}, &gorm.Config{DryRun: true})
	require.NoError(t, err)

	var channels []Channel
	return options.Apply(db).Find(&channels).Statement.SQL.String()
}

func TestChannelSortOptionsCombinesPriorityAndID(t *testing.T) {
	sql := buildChannelSortSQL(t, NewChannelSortOptions("priority", "desc", true))

	assert.Contains(t, sql, "ORDER BY `priority` DESC,`id` DESC")
}

func TestChannelSortOptionsUsesStableIDTieBreaker(t *testing.T) {
	sql := buildChannelSortSQL(t, NewChannelSortOptions("priority", "desc", false))

	assert.Contains(t, sql, "ORDER BY `priority` DESC,`id` DESC")
}

func TestChannelSortOptionsDoesNotDuplicateID(t *testing.T) {
	sql := buildChannelSortSQL(t, NewChannelSortOptions("id", "asc", true))

	assert.Contains(t, sql, "ORDER BY `id`")
	assert.NotContains(t, sql, "`id`,`id`")
}

func TestChannelSortOptionsAllowsAllSortingDisabled(t *testing.T) {
	sql := buildChannelSortSQL(t, NewChannelSortOptions("", "", false))

	assert.NotContains(t, sql, "ORDER BY")
}
