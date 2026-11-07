package setting

import (
	"fmt"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestUpdateAutoGroupsByJsonStringTreatsEmptyValueAsEmptyList(t *testing.T) {
	original := AutoGroups2JsonString()
	t.Cleanup(func() { require.NoError(t, UpdateAutoGroupsByJsonString(original)) })

	require.NoError(t, UpdateAutoGroupsByJsonString("  "))
	require.Empty(t, GetAutoGroups())
}

func TestAutoGroupSnapshotsSurviveUpdatesAndInvalidInput(t *testing.T) {
	original := AutoGroups2JsonString()
	t.Cleanup(func() { require.NoError(t, UpdateAutoGroupsByJsonString(original)) })
	require.NoError(t, UpdateAutoGroupsByJsonString(`["vip","default"]`))
	inFlight := GetAutoGroups()
	require.NoError(t, UpdateAutoGroupsByJsonString(`["pro","default"]`))
	assert.Equal(t, []string{"vip", "default"}, inFlight)
	assert.Error(t, UpdateAutoGroupsByJsonString(`["broken",`))
	assert.Equal(t, []string{"pro", "default"}, GetAutoGroups())
	callerCopy := GetAutoGroups()
	callerCopy[0] = "changed"
	assert.Equal(t, []string{"pro", "default"}, GetAutoGroups())
}

func TestUpdateMaxTokenAutoGroupsAcceptsAnyPositiveInteger(t *testing.T) {
	original := GetMaxTokenAutoGroups()
	t.Cleanup(func() {
		require.NoError(t, UpdateMaxTokenAutoGroups(fmt.Sprintf("%d", original)))
	})

	require.NoError(t, UpdateMaxTokenAutoGroups("123456"))
	assert.Equal(t, 123456, GetMaxTokenAutoGroups())
}

func TestUpdateMaxTokenAutoGroupsRejectsInvalidValuesWithoutChangingState(t *testing.T) {
	original := GetMaxTokenAutoGroups()
	for _, value := range []string{"", "0", "-1", "1.5", "not-a-number"} {
		t.Run(value, func(t *testing.T) {
			assert.Error(t, UpdateMaxTokenAutoGroups(value))
			assert.Equal(t, original, GetMaxTokenAutoGroups())
		})
	}
}
