package setting

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestUpdateAutoGroupsByJsonStringTreatsEmptyValueAsEmptyList(t *testing.T) {
	original := append([]string(nil), autoGroups...)
	t.Cleanup(func() { autoGroups = original })

	require.NoError(t, UpdateAutoGroupsByJsonString("  "))
	require.Empty(t, GetAutoGroups())
}
