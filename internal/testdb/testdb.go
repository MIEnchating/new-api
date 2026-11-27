package testdb

import (
	"net/url"
	"os"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	sqlmysql "github.com/go-sql-driver/mysql"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

// IsolatedDSN provisions a disposable database on a configured test instance.
// Callers must close their connections before this helper's cleanup runs.
// SQLite callers supply their own temporary file or in-memory connection.
func IsolatedDSN(t testing.TB, dialect string) string {
	t.Helper()
	if dialect == "sqlite" {
		return ""
	}
	env := "TEST_" + strings.ToUpper(dialect) + "_DSN"
	dsn := os.Getenv(env)
	if dsn == "" {
		t.Skipf("%s is not configured", env)
	}
	name := "newapi_test_" + common.GetUUID()
	createSQL := "CREATE DATABASE " + name
	var adminDriver gorm.Dialector
	var isolatedDSN string
	switch dialect {
	case "mysql":
		config, err := sqlmysql.ParseDSN(dsn)
		require.NoError(t, err)
		config.DBName = name
		config.ParseTime = true
		isolatedDSN = config.FormatDSN()
		adminDriver = mysql.Open(dsn)
		createSQL += " CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
	case "postgres":
		parsed, err := url.Parse(dsn)
		require.True(t, err == nil && (parsed.Scheme == "postgres" || parsed.Scheme == "postgresql"),
			"TEST_POSTGRES_DSN must be a PostgreSQL URL")
		parsed.Path = "/" + name
		parsed.RawPath = ""
		query := parsed.Query()
		query.Del("dbname")
		query.Del("database")
		parsed.RawQuery = query.Encode()
		isolatedDSN = parsed.String()
		adminDriver = postgres.Open(dsn)
	default:
		t.Fatalf("unsupported test database dialect %q", dialect)
	}
	admin, err := gorm.Open(adminDriver, &gorm.Config{})
	require.NoError(t, err)
	conn, err := admin.DB()
	require.NoError(t, err)
	t.Cleanup(func() { assert.NoError(t, conn.Close()) })
	require.NoError(t, admin.Exec(createSQL).Error)
	t.Cleanup(func() { assert.NoError(t, admin.Exec("DROP DATABASE "+name).Error) })
	return isolatedDSN
}
