package model

import (
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

// External DSNs must point to disposable databases; this test owns its tables.
func TestInvoiceRequestDatabase(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			var driver gorm.Dialector
			switch dialect {
			case "sqlite":
				driver = sqlite.Open(filepath.Join(t.TempDir(), "invoices.db") + "?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)")
			case "mysql":
				dsn := os.Getenv("TEST_MYSQL_DSN")
				if dsn == "" {
					t.Skip("TEST_MYSQL_DSN is not configured")
				}
				driver = mysql.Open(dsn)
			case "postgres":
				dsn := os.Getenv("TEST_POSTGRES_DSN")
				if dsn == "" {
					t.Skip("TEST_POSTGRES_DSN is not configured")
				}
				driver = postgres.Open(dsn)
			}
			db, err := gorm.Open(driver, &gorm.Config{})
			require.NoError(t, err)
			sqlDB, err := db.DB()
			require.NoError(t, err)
			t.Cleanup(func() { assert.NoError(t, sqlDB.Close()) })
			oldDB, oldMain, oldLog := DB, common.MainDatabaseType(), common.LogDatabaseType()
			DB = db
			common.SetDatabaseTypes(common.DatabaseType(dialect), oldLog)
			t.Cleanup(func() { DB = oldDB; common.SetDatabaseTypes(oldMain, oldLog) })
			var version string
			versionQuery := "SELECT version()"
			if dialect == "sqlite" {
				versionQuery = "SELECT sqlite_version()"
			}
			require.NoError(t, db.Raw(versionQuery).Scan(&version).Error)
			t.Logf("%s: %s", dialect, version)
			models := []any{&InvoiceRequestOrder{}, &InvoiceRequest{}, &TopUp{}}
			for _, upgrade := range []bool{false, true} {
				t.Run(fmt.Sprintf("upgrade=%t", upgrade), func(t *testing.T) {
					require.NoError(t, db.Migrator().DropTable(models...))
					t.Cleanup(func() { assert.NoError(t, db.Migrator().DropTable(models...)) })
					// TopUp's schema is unchanged from the latest release v2026.10.26.
					// Upgrade starts with that schema and representative historical data.
					historical := TopUp{UserId: 1, TradeNo: "historical", Money: 12.5, Amount: 20, Status: common.TopUpStatusSuccess, InvoiceStatus: TopUpInvoiceStatusIssued, InvoicedBy: 7}
					if upgrade {
						require.NoError(t, db.AutoMigrate(&TopUp{}))
						require.NoError(t, db.Create(&historical).Error)
					}
					require.NoError(t, db.AutoMigrate(&TopUp{}, &InvoiceRequest{}, &InvoiceRequestOrder{}))
					require.NoError(t, db.AutoMigrate(&TopUp{}, &InvoiceRequest{}, &InvoiceRequestOrder{}))
					if upgrade {
						var preserved TopUp
						require.NoError(t, db.First(&preserved, historical.Id).Error)
						assert.Equal(t, historical, preserved)
						duplicate := historical
						duplicate.Id = 0
						require.Error(t, db.Create(&duplicate).Error)
					}
					orders := []TopUp{
						{UserId: 1, TradeNo: "paid-1", Money: 10.25, Amount: 15, Status: common.TopUpStatusSuccess},
						{UserId: 1, TradeNo: "paid-2", Money: 20.75, Amount: 25, Status: common.TopUpStatusSuccess},
						{UserId: 2, TradeNo: "other-user", Money: 50, Status: common.TopUpStatusSuccess},
						{UserId: 1, TradeNo: "unpaid", Money: 30, Status: common.TopUpStatusPending},
						{UserId: 1, TradeNo: "invoiced", Money: 40, Status: common.TopUpStatusSuccess, InvoiceStatus: TopUpInvoiceStatusIssued},
						{UserId: 1, TradeNo: "zero", Money: 0, Status: common.TopUpStatusSuccess},
					}
					require.NoError(t, db.Create(&orders).Error)
					input := InvoiceApplicationInput{OrderIds: []int{orders[0].Id, orders[1].Id}, TitleType: "company", Title: "Example Ltd", TaxId: "TAX123", Email: "billing@example.com", Remark: "Monthly invoice"}
					for _, ids := range [][]int{nil, {orders[2].Id}, {orders[3].Id}, {orders[4].Id}, {orders[5].Id}, {orders[0].Id, orders[2].Id}, {orders[0].Id, orders[0].Id}, {999999}, make([]int, 101)} {
						invalid := input
						invalid.OrderIds = ids
						_, err := CreateInvoiceRequest(1, invalid)
						require.ErrorIs(t, err, ErrInvoiceRequestOrders)
					}
					for _, field := range []string{"tax", "email", "title", "type"} {
						invalid := input
						switch field {
						case "tax":
							invalid.TaxId = ""
						case "email":
							invalid.Email = "not-email"
						case "title":
							invalid.Title = " "
						case "type":
							invalid.TitleType = "invalid"
						}
						_, err := CreateInvoiceRequest(1, invalid)
						require.ErrorIs(t, err, ErrInvoiceRequestInput)
					}
					page := &common.PageInfo{Page: 1, PageSize: 10}
					require.NoError(t, GetInvoiceEligibleOrders(1, page))
					assert.Equal(t, 2, page.Total)
					request, err := CreateInvoiceRequest(1, input)
					require.NoError(t, err)
					assert.Equal(t, InvoiceRequestPending, request.Status)
					require.Len(t, request.Orders, 2)
					assert.Equal(t, 10.25, request.Orders[0].Money)
					assert.Equal(t, 20.75, request.Orders[1].Money)
					_, err = CreateInvoiceRequest(1, input)
					require.ErrorIs(t, err, ErrInvoiceRequestConflict)
					require.NoError(t, GetInvoiceEligibleOrders(1, page))
					assert.Zero(t, page.Total)
					require.NoError(t, ListInvoiceRequests(2, "", page))
					assert.Zero(t, page.Total)
					require.NoError(t, ListInvoiceRequests(1, InvoiceRequestPending, page))
					assert.Equal(t, 1, page.Total)
					require.NoError(t, ListInvoiceRequests(0, InvoiceRequestPending, page))
					assert.Equal(t, 1, page.Total)
					_, err = ProcessInvoiceRequest(request.Id, 7, InvoiceProcessInput{Status: InvoiceRequestRejected})
					require.ErrorIs(t, err, ErrInvoiceRequestInput)
					rejected, err := ProcessInvoiceRequest(request.Id, 7, InvoiceProcessInput{Status: InvoiceRequestRejected, Note: "Please correct the title"})
					require.NoError(t, err)
					assert.Equal(t, InvoiceRequestRejected, rejected.Status)
					require.NoError(t, GetInvoiceEligibleOrders(1, page))
					assert.Equal(t, 2, page.Total)
					request, err = CreateInvoiceRequest(1, input)
					require.NoError(t, err)
					// A conflicting manual invoice marker must not partially issue the batch.
					require.NoError(t, db.Model(&TopUp{}).Where("id = ?", orders[1].Id).Update("invoice_status", TopUpInvoiceStatusIssued).Error)
					_, err = ProcessInvoiceRequest(request.Id, 7, InvoiceProcessInput{Status: InvoiceRequestIssued, InvoiceNumber: "CONFLICT"})
					require.ErrorIs(t, err, ErrInvoiceRequestOrders)
					var unchanged TopUp
					require.NoError(t, db.First(&unchanged, orders[0].Id).Error)
					assert.Equal(t, TopUpInvoiceStatusNone, unchanged.InvoiceStatus)
					require.NoError(t, ListInvoiceRequests(1, InvoiceRequestPending, page))
					assert.Equal(t, 1, page.Total)
					require.NoError(t, db.Model(&TopUp{}).Where("id = ?", orders[1].Id).Update("invoice_status", TopUpInvoiceStatusNone).Error)
					for _, link := range []string{"javascript:alert(1)", "http://example.com/invoice", "https://user:secret@example.com/invoice"} {
						_, err = ProcessInvoiceRequest(request.Id, 7, InvoiceProcessInput{Status: InvoiceRequestIssued, InvoiceNumber: "INV-001", InvoiceURL: link})
						require.ErrorIs(t, err, ErrInvoiceRequestInput)
					}
					issued, err := ProcessInvoiceRequest(request.Id, 7, InvoiceProcessInput{Status: InvoiceRequestIssued, InvoiceNumber: "INV-001", InvoiceURL: "https://example.com/invoice", Note: "Sent by email"})
					require.NoError(t, err)
					assert.Equal(t, InvoiceRequestIssued, issued.Status)
					assert.Equal(t, 7, issued.ProcessedBy)
					for _, original := range orders[:2] {
						var actual TopUp
						require.NoError(t, db.First(&actual, original.Id).Error)
						assert.Equal(t, TopUpInvoiceStatusIssued, actual.InvoiceStatus)
						assert.Equal(t, 7, actual.InvoicedBy)
						assert.Equal(t, original.Money, actual.Money)
						assert.Equal(t, original.Amount, actual.Amount)
						assert.Equal(t, original.Status, actual.Status)
					}
					_, err = ProcessInvoiceRequest(request.Id, 8, InvoiceProcessInput{Status: InvoiceRequestRejected, Note: "replay"})
					require.ErrorIs(t, err, ErrInvoiceRequestProcessed)
					_, err = CreateInvoiceRequest(1, input)
					require.ErrorIs(t, err, ErrInvoiceRequestOrders)
					require.NoError(t, db.AutoMigrate(&TopUp{}, &InvoiceRequest{}, &InvoiceRequestOrder{}))
					require.NoError(t, ListInvoiceRequests(1, "", page))
					assert.Equal(t, 2, page.Total)
					// A return permits a new application while retaining the original history.
					_, err = UpdateTopUpInvoiceStatuses(input.OrderIds, TopUpInvoiceActionReturn, 7)
					require.NoError(t, err)
					var wg sync.WaitGroup
					var successes atomic.Int32
					start := make(chan struct{})
					for range 2 {
						wg.Go(func() {
							<-start
							if _, err := CreateInvoiceRequest(1, input); err == nil {
								successes.Add(1)
							}
						})
					}
					close(start)
					wg.Wait()
					assert.EqualValues(t, 1, successes.Load())
					require.NoError(t, ListInvoiceRequests(1, InvoiceRequestPending, page))
					assert.Equal(t, 1, page.Total)
					// Unique pending claims survive repeated migrations and cannot be bypassed.
					pending := page.Items.([]InvoiceRequest)[0]
					duplicateClaim := pending.Orders[0]
					duplicateClaim.Id = 0
					require.Error(t, db.Create(&duplicateClaim).Error)
				})
			}
		})
	}
}
