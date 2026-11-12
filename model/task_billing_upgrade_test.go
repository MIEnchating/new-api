package model

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm/clause"
)

func TestTaskBillingCutoverAcrossDatabases(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			dsn := os.Getenv("TEST_MYSQL_DSN")
			if dialect == "postgres" {
				dsn = os.Getenv("TEST_POSTGRES_DSN")
			}
			if dialect == "sqlite" {
				dsn = "local"
				previous := common.SQLitePath
				common.SQLitePath = filepath.Join(t.TempDir(), "cutover.db")
				t.Cleanup(func() { common.SQLitePath = previous })
			}
			if dsn == "" {
				t.Skip("test database DSN is not configured")
			}
			t.Setenv("CUTOVER_TEST_DSN", dsn)
			db, _, err := chooseDB("CUTOVER_TEST_DSN", false)
			require.NoError(t, err)
			sqlDB, err := db.DB()
			require.NoError(t, err)
			t.Cleanup(func() { assert.NoError(t, sqlDB.Close()) })
			require.NoError(t, db.Migrator().DropTable(&Task{}, &Option{}))
			t.Cleanup(func() { assert.NoError(t, db.Migrator().DropTable(&Task{}, &Option{})) })
			require.NoError(t, db.AutoMigrate(&Task{}, &Option{}))
			// Fresh installs and repeated startup are safe.
			require.NoError(t, ensureTaskBillingCutover(db))
			require.NoError(t, ensureTaskBillingCutover(db))
			require.NoError(t, db.Where("1 = 1").Delete(&Option{}).Error)
			// Released-version rows stay byte-for-byte intact on rejected upgrade.
			legacy := Task{TaskID: "legacy-billing", Status: TaskStatusInProgress, Quota: 12345}
			require.NoError(t, db.Create(&legacy).Error)
			raw := `{"billing_context":{"billing_mode":"per_second","second_price_snapshot":{"base_price":0.4,"seconds":5}}}`
			require.NoError(t, db.Model(&Task{}).Where("id = ?", legacy.ID).Update("private_data", raw).Error)
			require.ErrorContains(t, ensureTaskBillingCutover(db), "draining 1 unfinished tasks")
			var stored struct {
				PrivateData string
				Quota       int
			}
			require.NoError(t, db.Model(&Task{}).Select("private_data", "quota").Where("id = ?", legacy.ID).Scan(&stored).Error)
			assert.JSONEq(t, raw, stored.PrivateData)
			assert.Equal(t, legacy.Quota, stored.Quota)
			require.NoError(t, db.Model(&Task{}).Where("id = ?", legacy.ID).Update("status", TaskStatusSuccess).Error)
			mode := Option{Key: "billing_setting.billing_mode", Value: `{"video":"per_second"}`}
			require.NoError(t, db.Create(&mode).Error)
			require.ErrorContains(t, ensureTaskBillingCutover(db), "replacing retired per_second prices")
			require.NoError(t, db.Model(&Option{}).Where(clause.Eq{Column: "key", Value: mode.Key}).Update("value", `{"video":"tiered_expr"}`).Error)
			require.NoError(t, ensureTaskBillingCutover(db))
			// New-version tasks must survive ordinary restarts after cutover.
			require.NoError(t, db.Create(&Task{TaskID: "modern-task", Status: TaskStatusQueued}).Error)
			for range 2 {
				require.NoError(t, db.AutoMigrate(&Task{}, &Option{}))
				require.NoError(t, ensureTaskBillingCutover(db))
			}
			var markers int64
			require.NoError(t, db.Model(&Option{}).Where(clause.Eq{Column: "key", Value: "migration.task_usage_cutover_v1"}).Count(&markers).Error)
			assert.EqualValues(t, 1, markers)
			require.NoError(t, db.Model(&Option{}).Where(clause.Eq{Column: "key", Value: mode.Key}).Update("value", "invalid JSON").Error)
			require.ErrorContains(t, ensureTaskBillingCutover(db), "validate task pricing")
		})
	}
}
