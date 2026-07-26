package setting

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestUpdateGroupDescriptionsPreservesHiddenGroupDescriptions(t *testing.T) {
	original := GroupDescriptions2JSONString()
	t.Cleanup(func() {
		require.NoError(t, UpdateGroupDescriptionsByJSONString(original))
	})

	require.NoError(t, UpdateGroupDescriptionsByJSONString(`{"hidden":"Kept while hidden"}`))
	assert.JSONEq(t, `{"hidden":"Kept while hidden"}`, GroupDescriptions2JSONString())
}

func TestUpdateGroupDescriptionsKeepsPreviousValueOnInvalidInput(t *testing.T) {
	original := GroupDescriptions2JSONString()
	t.Cleanup(func() {
		require.NoError(t, UpdateGroupDescriptionsByJSONString(original))
	})

	require.NoError(t, UpdateGroupDescriptionsByJSONString(`{"default":"Default group"}`))
	require.Error(t, UpdateGroupDescriptionsByJSONString(`{" ":"Invalid"}`))
	assert.JSONEq(t, `{"default":"Default group"}`, GroupDescriptions2JSONString())
}
