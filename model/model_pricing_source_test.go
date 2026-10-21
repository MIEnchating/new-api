package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestModelPricingSnapshotIdentifiesBuiltinDefaultsDespiteOverrides(t *testing.T) {
	previousDB := DB
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	connection, err := db.DB()
	require.NoError(t, err)
	connection.SetMaxOpenConns(1)
	DB = db
	t.Cleanup(func() {
		DB = previousDB
		require.NoError(t, connection.Close())
	})
	require.NoError(t, db.AutoMigrate(&Option{}))
	// A persisted override does not remove the built-in fallback, and a custom
	// model using the same price does not acquire a built-in fallback.
	require.NoError(t, db.Create(&Option{Key: "ModelPrice", Value: `{"deepseek-v4-flash-vision-exp":0.5,"custom-pricing-source-test":0.5}`}).Error)
	names := []string{"deepseek-v4-flash-vision-exp", "gpt-4.1-mini", "dall-e-3", "gpt-4-gizmo-example", "custom-pricing-source-test", "unpriced-source-test"}
	snapshot, err := GetModelPricingSnapshot(names)
	require.NoError(t, err)
	require.Len(t, snapshot.Entries, len(names))
	entries := make(map[string]ModelPricingEntry)
	for _, entry := range snapshot.Entries {
		entries[entry.ModelName] = entry
	}
	for _, tc := range []struct {
		name    string
		builtin bool
	}{
		{"deepseek-v4-flash-vision-exp", true},
		{"gpt-4.1-mini", true},
		{"dall-e-3", true},
		{"gpt-4-gizmo-example", true},
		{"custom-pricing-source-test", false},
		{"unpriced-source-test", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			entry := entries[tc.name]
			assert.Equal(t, tc.builtin, entry.HasBuiltinPricing)
			encoded, err := common.Marshal(entry)
			require.NoError(t, err)
			var response map[string]any
			require.NoError(t, common.Unmarshal(encoded, &response))
			assert.Equal(t, tc.builtin, response["has_builtin_pricing"], "false must also be present in the API response")
		})
	}
	assert.Equal(t, 0.5, entries["deepseek-v4-flash-vision-exp"].Configured["ModelPrice"])
	assert.Equal(t, 0.5, entries["deepseek-v4-flash-vision-exp"].Effective["ModelPrice"])
	assert.Equal(t, 0.5, entries["custom-pricing-source-test"].Effective["ModelPrice"])
}
