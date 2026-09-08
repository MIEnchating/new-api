package model

import (
	"context"
	"encoding/base64"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

type MigrationIdentityFields struct {
	ID        int    `gorm:"primaryKey"`
	Name      string `gorm:"size:64;unique"`
	Reference string `gorm:"size:64;uniqueIndex"`
	Provider  string `gorm:"size:32;uniqueIndex:,composite:provider_subject"`
	Subject   string `gorm:"size:64;uniqueIndex:,composite:provider_subject"`
}

type migrationIdentityV1 struct {
	MigrationIdentityFields
	Digest string `gorm:"type:char(32)"`
}

type migrationIdentityV2 struct {
	MigrationIdentityFields
	Digest string `gorm:"type:char(64)"`
	Note   string `gorm:"size:128"`
}

type migrationConstraintV1 struct {
	ID   int    `gorm:"primaryKey"`
	Name string `gorm:"size:64"`
}

type migrationConstraintV2 struct {
	ID   int    `gorm:"primaryKey"`
	Name string `gorm:"size:64;unique"`
}

type migrationDecimalV1 struct {
	ID    int     `gorm:"primaryKey"`
	Price float64 `gorm:"type:decimal(10,6);default:0"`
}

type migrationDecimalV2 struct {
	ID    int     `gorm:"primaryKey"`
	Price float64 `gorm:"type:decimal(12,6);not null;default:0"`
}

type migrationDecimalV3 struct {
	ID    int     `gorm:"primaryKey"`
	Price float64 `gorm:"type:decimal(12,6);not null;default:1.25"`
}

// Schema before sidecar icons were introduced; keep the released column and
// index definitions so upgrading tests preservation of existing plugin rows.
type taskPluginBeforeIcon struct {
	Id         int64
	Key        string `gorm:"size:128;not null;uniqueIndex:uk_task_plugin_key_version,priority:1"`
	APIVersion int    `gorm:"not null"`
	Version    string `gorm:"size:64;not null;uniqueIndex:uk_task_plugin_key_version,priority:2"`
	Source     string `gorm:"type:text;not null"`
	SourceHash string `gorm:"size:64;not null"`
	Enabled    bool   `gorm:"not null"`
	Active     bool   `gorm:"not null;index"`
	CreatedAt  int64  `gorm:"not null"`
	Remark     string `gorm:"type:text"`
}

type optionBeforePrimaryKey struct {
	Key   string `gorm:"size:255"`
	Value string
}

func TestMigrationSchemaStability(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			var dsn string
			switch dialect {
			case "sqlite":
				dsn = "local"
				previousPath := common.SQLitePath
				common.SQLitePath = filepath.Join(t.TempDir(), "migration.db")
				t.Cleanup(func() { common.SQLitePath = previousPath })
			case "mysql":
				dsn = os.Getenv("TEST_MYSQL_DSN")
			case "postgres":
				dsn = os.Getenv("TEST_POSTGRES_DSN")
			}
			if dsn == "" {
				t.Skip("test database DSN is not configured")
			}
			t.Setenv("MIGRATION_TEST_DSN", dsn)
			db, _, err := chooseDB("MIGRATION_TEST_DSN", false)
			require.NoError(t, err)
			sqlDB, err := db.DB()
			require.NoError(t, err)
			t.Cleanup(func() { _ = sqlDB.Close() })
			recorder := &migrationSQLRecorder{}
			db = db.Session(&gorm.Session{Logger: recorder})

			for _, scenario := range []string{"fresh", "released", "legacy_duplicates", "conflicting_values"} {
				t.Run("options_primary_key_"+scenario, func(t *testing.T) {
					// Exercise the migration with a single connection, including
					// MySQL's connection-scoped advisory lock.
					sqlDB.SetMaxOpenConns(1)
					t.Cleanup(func() { sqlDB.SetMaxOpenConns(0) })
					ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
					defer cancel()
					db := db.WithContext(ctx)
					t.Cleanup(func() {
						tables, err := db.WithContext(context.Background()).Migrator().GetTables()
						require.NoError(t, err)
						for _, table := range tables {
							if table == "options" || table == optionPrimaryKeyTmpTable || strings.HasPrefix(table, optionLegacyTablePrefix) {
								require.NoError(t, db.WithContext(context.Background()).Migrator().DropTable(table))
							}
						}
					})
					rows := []Option{{Key: "ModelPrice", Value: `{"custom-model":0.125}`}, {Key: "GroupRatio", Value: `{"custom-group":0.75}`}}
					switch scenario {
					case "released":
						require.NoError(t, db.AutoMigrate(&Option{}))
						require.NoError(t, db.Create(&rows).Error)
					case "legacy_duplicates", "conflicting_values":
						require.NoError(t, db.Table("options").AutoMigrate(&optionBeforePrimaryKey{}))
						legacy := []optionBeforePrimaryKey{{Key: rows[0].Key, Value: rows[0].Value}, {Key: rows[1].Key, Value: rows[1].Value}, {Key: rows[0].Key, Value: rows[0].Value}}
						if scenario == "conflicting_values" {
							legacy[2].Value = `{"custom-model":9}`
						}
						require.NoError(t, db.Table("options").Create(&legacy).Error)
						if scenario == "conflicting_values" {
							require.ErrorContains(t, migrateOptionPrimaryKey(db), "conflicting values")
							var untouched []optionBeforePrimaryKey
							require.NoError(t, db.Table("options").Find(&untouched).Error)
							assert.ElementsMatch(t, legacy, untouched)
							assert.False(t, db.Migrator().HasTable(optionPrimaryKeyTmpTable))
							return
						}
					}
					require.NoError(t, migrateOptionPrimaryKey(db))
					require.NoError(t, db.AutoMigrate(&Option{}))
					if scenario == "fresh" {
						require.NoError(t, db.Create(&rows).Error)
					}
					recorder.reset()
					require.NoError(t, migrateOptionPrimaryKey(db))
					require.NoError(t, db.AutoMigrate(&Option{}))
					assert.Empty(t, recorder.schemaMutations())
					var stored []Option
					require.NoError(t, db.Find(&stored).Error)
					assert.ElementsMatch(t, rows, stored)
					assert.Error(t, db.Create(&Option{Key: rows[0].Key, Value: "replacement"}).Error)
					if scenario == "legacy_duplicates" {
						tables, err := db.Migrator().GetTables()
						require.NoError(t, err)
						backups := 0
						for _, table := range tables {
							if strings.HasPrefix(table, optionLegacyTablePrefix) {
								backups++
								var count int64
								require.NoError(t, db.Table(table).Count(&count).Error)
								assert.EqualValues(t, 3, count)
							}
						}
						assert.Equal(t, 1, backups)
					}
				})
			}

			for _, upgrade := range []bool{false, true} {
				name := "task_plugin_icon_fresh"
				if upgrade {
					name = "task_plugin_icon_upgrade"
				}
				t.Run(name, func(t *testing.T) {
					versionQuery := "SELECT version()"
					if dialect == "sqlite" {
						versionQuery = "SELECT sqlite_version()"
					}
					var version string
					require.NoError(t, db.Raw(versionQuery).Scan(&version).Error)
					t.Logf("%s version: %s", dialect, version)
					const table = "migration_task_plugin_test"
					t.Cleanup(func() { _ = db.Migrator().DropTable(table) })
					row := TaskPlugin{Key: "icon-migration", APIVersion: 1, Version: "1.0.0", Source: "plugin source", SourceHash: "source hash", Enabled: true, Active: true, CreatedAt: 1700000000, Remark: "operator note"}
					if upgrade {
						require.NoError(t, db.Table(table).AutoMigrate(&taskPluginBeforeIcon{}))
						legacy := taskPluginBeforeIcon{Key: row.Key, APIVersion: row.APIVersion, Version: row.Version, Source: row.Source, SourceHash: row.SourceHash, Enabled: row.Enabled, Active: row.Active, CreatedAt: row.CreatedAt, Remark: row.Remark}
						require.NoError(t, db.Table(table).Create(&legacy).Error)
						row.Id = legacy.Id
					}
					require.NoError(t, db.Table(table).AutoMigrate(&TaskPlugin{}))
					if !upgrade {
						require.NoError(t, db.Table(table).Create(&row).Error)
					}
					var stored TaskPlugin
					require.NoError(t, db.Table(table).First(&stored, row.Id).Error)
					assert.Equal(t, row, stored, "adding icons must preserve existing plugin data and activation")

					const prefix = "data:image/svg+xml;base64,"
					const svgStart, svgEnd = `<svg xmlns="http://www.w3.org/2000/svg"><!--`, `--></svg>`
					rawSize := ((524288 - len(prefix)) / 4) * 3
					row.Icon = prefix + base64.StdEncoding.EncodeToString([]byte(svgStart+strings.Repeat("x", rawSize-len(svgStart)-len(svgEnd))+svgEnd))
					require.NoError(t, db.Table(table).Where("id = ?", row.Id).Update("icon", row.Icon).Error)
					recorder.reset()
					require.NoError(t, db.Table(table).AutoMigrate(&TaskPlugin{}))
					assert.Empty(t, recorder.schemaMutations(), "repeated startup must not alter the plugin schema")
					require.NoError(t, db.Table(table).First(&stored, row.Id).Error)
					assert.Equal(t, row, stored, "a near-limit icon must survive storage and repeated migration without truncation")
					duplicate := row
					duplicate.Id = 0
					assert.Error(t, db.Table(table).Create(&duplicate).Error, "key/version uniqueness must survive migration")
				})
			}

			t.Run("identity_and_indexes", func(t *testing.T) {
				const table = "migration_identity_test"
				t.Cleanup(func() { _ = db.Migrator().DropTable(table) })
				require.NoError(t, db.Table(table).AutoMigrate(&migrationIdentityV1{}))
				row := migrationIdentityV1{
					MigrationIdentityFields: MigrationIdentityFields{ID: 1, Name: "root", Reference: "token-reference", Provider: "oidc", Subject: "subject"},
					Digest:                  "old-digest",
				}
				require.NoError(t, db.Table(table).Create(&row).Error)
				recorder.reset()
				require.NoError(t, db.Table(table).AutoMigrate(&migrationIdentityV1{}))
				assert.Empty(t, recorder.schemaMutations())

				require.NoError(t, db.Table(table).AutoMigrate(&migrationIdentityV2{}))
				columns, err := db.Table(table).Migrator().ColumnTypes(&migrationIdentityV2{})
				require.NoError(t, err)
				for _, column := range columns {
					if column.Name() == "digest" {
						length, ok := column.Length()
						require.True(t, ok)
						assert.EqualValues(t, 64, length)
					}
				}
				assert.True(t, db.Table(table).Migrator().HasColumn(&migrationIdentityV2{}, "note"))
				recorder.reset()
				require.NoError(t, db.Table(table).AutoMigrate(&migrationIdentityV2{}))
				assert.Empty(t, recorder.schemaMutations())
				var saved migrationIdentityV2
				require.NoError(t, db.Table(table).First(&saved, 1).Error)
				assert.Equal(t, row.MigrationIdentityFields, saved.MigrationIdentityFields)
				expectedDigest := row.Digest
				if dialect == "postgres" {
					expectedDigest += strings.Repeat(" ", 64-len(row.Digest))
				}
				assert.Equal(t, expectedDigest, saved.Digest)
				for _, duplicate := range []migrationIdentityV2{
					{MigrationIdentityFields: MigrationIdentityFields{Name: "root", Reference: "other-1", Provider: "other", Subject: "1"}},
					{MigrationIdentityFields: MigrationIdentityFields{Name: "other-2", Reference: "token-reference", Provider: "other", Subject: "2"}},
					{MigrationIdentityFields: MigrationIdentityFields{Name: "other-3", Reference: "other-3", Provider: "oidc", Subject: "subject"}},
				} {
					assert.Error(t, db.Table(table).Create(&duplicate).Error)
				}
			})

			t.Run("unique_constraint_changes", func(t *testing.T) {
				const table = "migration_constraint_test"
				t.Cleanup(func() { _ = db.Migrator().DropTable(table) })
				require.NoError(t, db.Table(table).AutoMigrate(&migrationConstraintV1{}))
				require.NoError(t, db.Table(table).Create(&migrationConstraintV1{Name: "existing"}).Error)
				require.NoError(t, db.Table(table).AutoMigrate(&migrationConstraintV2{}))
				assert.Error(t, db.Table(table).Create(&migrationConstraintV2{Name: "existing"}).Error)
				recorder.reset()
				require.NoError(t, db.Table(table).AutoMigrate(&migrationConstraintV2{}))
				assert.Empty(t, recorder.schemaMutations())
				require.NoError(t, db.Table(table).AutoMigrate(&migrationConstraintV1{}))
				require.NoError(t, db.Table(table).Create(&migrationConstraintV1{Name: "existing"}).Error)
			})

			if dialect == "mysql" {
				t.Run("decimal_default_and_real_changes", func(t *testing.T) {
					const table = "migration_decimal_test"
					t.Cleanup(func() { _ = db.Migrator().DropTable(table) })
					require.NoError(t, db.Table(table).AutoMigrate(&migrationDecimalV1{}))
					require.NoError(t, db.Table(table).Create(&migrationDecimalV1{ID: 1, Price: 12.345678}).Error)
					for _, target := range []any{&migrationDecimalV1{}, &migrationDecimalV2{}, &migrationDecimalV3{}} {
						require.NoError(t, db.Table(table).AutoMigrate(target))
						recorder.reset()
						require.NoError(t, db.Table(table).AutoMigrate(target))
						assert.Empty(t, recorder.schemaMutations())
					}
					columns, err := db.Table(table).Migrator().ColumnTypes(&migrationDecimalV3{})
					require.NoError(t, err)
					for _, column := range columns {
						if column.Name() == "price" {
							precision, scale, ok := column.DecimalSize()
							require.True(t, ok)
							assert.EqualValues(t, 12, precision)
							assert.EqualValues(t, 6, scale)
							nullable, ok := column.Nullable()
							require.True(t, ok)
							assert.False(t, nullable)
						}
					}
					require.NoError(t, db.Table(table).Create(&map[string]any{"id": 2}).Error)
					var prices []float64
					require.NoError(t, db.Table(table).Order("id").Pluck("price", &prices).Error)
					assert.Equal(t, []float64{12.345678, 1.25}, prices)
				})
			}
		})
	}
}
