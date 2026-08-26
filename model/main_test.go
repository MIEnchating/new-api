package model

import (
	"fmt"
	"strings"
	"testing"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestFreshUserSchemaUses64BitQuotaColumns(t *testing.T) {
	dsn := fmt.Sprintf("file:%s?mode=memory&cache=shared", strings.ReplaceAll(t.Name(), "/", "_"))
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&User{}))

	columnTypes, err := db.Migrator().ColumnTypes(&User{})
	require.NoError(t, err)
	typesByName := make(map[string]string, len(columnTypes))
	for _, columnType := range columnTypes {
		typesByName[columnType.Name()] = strings.ToUpper(columnType.DatabaseTypeName())
	}
	for _, column := range userQuotaColumns {
		assert.Contains(t, typesByName[column], "BIGINT", column)
	}
}
