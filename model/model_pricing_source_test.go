package model

import (
	"github.com/QuantumNous/new-api/pkg/billingexpr"
	"github.com/QuantumNous/new-api/setting/billing_setting"
	"gorm.io/gorm/clause"
	"os"
	"path/filepath"
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

// The options schema is unchanged from v2026.11.07. Exercise both an empty
// database and representative released option rows on every supported engine.
func TestPerSecondPricingMigration(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			var dsn string
			switch dialect {
			case "sqlite":
				old := common.SQLitePath
				common.SQLitePath = filepath.Join(t.TempDir(), "pricing.db")
				t.Cleanup(func() { common.SQLitePath = old })
				dsn = "local"
			case "mysql":
				dsn = os.Getenv("TEST_MYSQL_DSN")
			case "postgres":
				dsn = os.Getenv("TEST_POSTGRES_DSN")
			}
			if dsn == "" {
				t.Skip("test database DSN is not configured")
			}
			t.Setenv("PRICING_MIGRATION_TEST_DSN", dsn)
			db, dbType, err := chooseDB("PRICING_MIGRATION_TEST_DSN", false)
			require.NoError(t, err)
			oldType := common.MainDatabaseType()
			common.SetMainDatabaseType(dbType)
			initCol()
			t.Cleanup(func() { common.SetMainDatabaseType(oldType); initCol() })
			sqlDB, err := db.DB()
			require.NoError(t, err)
			t.Cleanup(func() { require.NoError(t, sqlDB.Close()) })
			var version string
			query := "SELECT version()"
			if dialect == "sqlite" {
				query = "SELECT sqlite_version()"
			}
			require.NoError(t, db.Raw(query).Scan(&version).Error)
			t.Logf("database: %s", version)
			require.NoError(t, db.Migrator().DropTable(&Option{}))
			require.NoError(t, db.AutoMigrate(&Option{}))
			t.Cleanup(func() { require.NoError(t, db.Migrator().DropTable(&Option{})) })
			for range 2 {
				require.NoError(t, migratePerSecondPricing(db))
			}
			var count int64
			require.NoError(t, db.Model(&Option{}).Count(&count).Error)
			assert.Zero(t, count, "fresh installation must not gain pricing overrides")
			rows := []Option{
				{Key: "billing_setting.billing_mode", Value: `{"video":"per_second","free":"per_second","text":"tiered_expr","call":"ratio","gpt-4-gizmo-*":"per_second","gpt-4-gizmo-video":"per_second"}`},
				{Key: "billing_setting.billing_expr", Value: `{"video":"inactive","text":"p * 2"}`},
				{Key: "ModelPrice", Value: `{"video":0.1,"free":0,"call":0.8,"gpt-4-gizmo-*":0.1,"gpt-4-gizmo-video":9}`},
				{Key: "ModelSecondPrice", Value: `{"video":{"prices":{" 1080P ":0.5,"720p":0}},"gpt-4-gizmo-*":{"prices":{"1080p":0.7}}}`},
				{Key: "billing_setting.plugin_billing_expr", Value: `{"custom::video":"u(\"seconds\") * 2"}`},
				{Key: "unrelated", Value: "keep"},
			}
			require.NoError(t, db.Create(&rows).Error)
			require.NoError(t, migratePerSecondPricing(db))
			var first []Option
			require.NoError(t, db.Order(clause.OrderByColumn{Column: clause.Column{Name: "key"}}).Find(&first).Error)
			require.NoError(t, migratePerSecondPricing(db))
			var second []Option
			require.NoError(t, db.Order(clause.OrderByColumn{Column: clause.Column{Name: "key"}}).Find(&second).Error)
			assert.Equal(t, first, second, "migration must be idempotent")
			values, _, duplicated, err := readModelPricingMaps(db)
			require.NoError(t, err)
			assert.Empty(t, duplicated)
			assert.Equal(t, "tiered_expr", values["billing_setting.billing_mode"]["video"])
			assert.Equal(t, "tiered_expr", values["billing_setting.billing_mode"]["free"])
			assert.Equal(t, "p * 2", values["billing_setting.billing_expr"]["text"])
			assert.Equal(t, `u("seconds") * 2`, values[billing_setting.PluginBillingExprOption]["custom::video"])
			assert.NotContains(t, values["ModelSecondPrice"], "video")
			assert.Equal(t, 0.8, values["ModelPrice"]["call"])
			for _, tc := range []struct {
				name  string
				facts map[string]any
				want  float64
			}{
				{"video", map[string]any{"seconds": 5.0, "resolution": "1080p"}, 2.5},
				{"video", map[string]any{"seconds": 2.5, "resolution": " 1080P "}, 1.25},
				{"video", map[string]any{"seconds": 5.0, "resolution": "720p"}, 0},
				{"video", map[string]any{"seconds": 5.0, "resolution": "4k"}, .5},
				{"video", map[string]any{"seconds": 5.0}, .5},
				{"video", map[string]any{"seconds": 0.0}, 0},
				{"free", map[string]any{"seconds": 8.0}, 0},
				{"gpt-4-gizmo-video", map[string]any{"seconds": 5.0, "resolution": "1080p"}, 3.5},
				{"gpt-4-gizmo-video", map[string]any{"seconds": 5.0}, .5},
			} {
				expression := values["billing_setting.billing_expr"][tc.name].(string)
				cost, _, err := billingexpr.RunExprWithRequest(expression, billingexpr.TokenParams{}, billingexpr.RequestInput{Usage: tc.facts})
				require.NoError(t, err)
				assert.InDelta(t, tc.want, cost, 1e-12)
			}
			// The primary-key constraint and unrelated data survive repeated migration.
			assert.Error(t, db.Create(&Option{Key: "unrelated", Value: "duplicate"}).Error)
			var unrelated Option
			require.NoError(t, db.Where(clause.Eq{Column: "key", Value: "unrelated"}).First(&unrelated).Error)
			assert.Equal(t, "keep", unrelated.Value)
			// An invalid price rolls back the complete batch, including earlier models.
			require.NoError(t, db.Model(&Option{}).Where(clause.Eq{Column: "key", Value: "billing_setting.billing_mode"}).Update("value", `{"a":"per_second","z":"per_second"}`).Error)
			require.NoError(t, db.Model(&Option{}).Where(clause.Eq{Column: "key", Value: "ModelPrice"}).Update("value", `{"a":0.1,"z":-1}`).Error)
			require.NoError(t, db.Order(clause.OrderByColumn{Column: clause.Column{Name: "key"}}).Find(&first).Error)
			require.ErrorContains(t, migratePerSecondPricing(db), "Enter a finite, non-negative price")
			require.NoError(t, db.Order(clause.OrderByColumn{Column: clause.Column{Name: "key"}}).Find(&second).Error)
			assert.Equal(t, first, second)
		})
	}
}
