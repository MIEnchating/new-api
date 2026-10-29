package model

import (
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strings"
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

// Invoice schema before optional address and bank details were added.
type legacyInvoiceRequest struct {
	Id            int                   `json:"id"`
	UserId        int                   `json:"user_id" gorm:"index"`
	TitleType     string                `json:"title_type" gorm:"type:varchar(16)"`
	Title         string                `json:"title" gorm:"type:varchar(200)"`
	TaxId         string                `json:"tax_id" gorm:"type:varchar(32)"`
	Email         string                `json:"email" gorm:"type:varchar(254)"`
	Remark        string                `json:"remark" gorm:"type:text"`
	Status        string                `json:"status" gorm:"type:varchar(16);index"`
	CreatedAt     int64                 `json:"created_at" gorm:"autoCreateTime:false"`
	ProcessedAt   int64                 `json:"processed_at"`
	ProcessedBy   int                   `json:"processed_by"`
	InvoiceNumber string                `json:"invoice_number" gorm:"type:varchar(100)"`
	InvoiceURL    string                `json:"invoice_url" gorm:"type:text"`
	ProcessNote   string                `json:"process_note" gorm:"type:text"`
	Orders        []InvoiceRequestOrder `json:"orders" gorm:"foreignKey:RequestId"`
}

func (legacyInvoiceRequest) TableName() string { return "invoice_requests" }

// External DSNs must point to disposable databases; this test owns its tables.
func TestInvoiceRequestDatabase(t *testing.T) {
	common.OptionMapRWMutex.Lock()
	originalOptions := common.OptionMap
	common.OptionMap = map[string]string{}
	common.OptionMapRWMutex.Unlock()
	t.Cleanup(func() {
		common.OptionMapRWMutex.Lock()
		common.OptionMap = originalOptions
		common.OptionMapRWMutex.Unlock()
	})
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
			models := []any{&User{}, &Option{}, &InvoiceRequestOrder{}, &InvoiceRequest{}, &TopUp{}}
			for _, upgrade := range []bool{false, true} {
				t.Run(fmt.Sprintf("upgrade=%t", upgrade), func(t *testing.T) {
					// Each startup uses a new connection pool, as a version upgrade does.
					db, err := gorm.Open(driver, &gorm.Config{})
					require.NoError(t, err)
					DB = db
					scenarioSQL, err := db.DB()
					require.NoError(t, err)
					t.Cleanup(func() { assert.NoError(t, scenarioSQL.Close()) })
					require.NoError(t, db.Migrator().DropTable(models...))
					t.Cleanup(func() { assert.NoError(t, db.Migrator().DropTable(models...)) })
					// TopUp's schema is unchanged from the latest release v2026.10.26.
					// Upgrade starts with that schema and representative historical data.
					historical := TopUp{UserId: 1, TradeNo: "historical", Money: 12.5, Amount: 20, Status: common.TopUpStatusSuccess, InvoiceStatus: TopUpInvoiceStatusIssued, InvoicedBy: 7}
					legacyRequest := legacyInvoiceRequest{UserId: 99, TitleType: "personal", Title: "Historical Ltd", TaxId: "OLD-TAX", Email: "old@example.com", Status: InvoiceRequestIssued, CreatedAt: 100, InvoiceNumber: "OLD-INV"}
					if upgrade {
						// A separate ORM instance represents the prior version's schema cache.
						legacyDB, err := gorm.Open(driver, &gorm.Config{})
						require.NoError(t, err)
						legacySQL, err := legacyDB.DB()
						require.NoError(t, err)
						t.Cleanup(func() { assert.NoError(t, legacySQL.Close()) })
						require.NoError(t, legacyDB.AutoMigrate(&TopUp{}, &legacyInvoiceRequest{}, &InvoiceRequestOrder{}))
						require.NoError(t, legacyDB.Create(&historical).Error)
						legacyRequest.Orders = []InvoiceRequestOrder{{TopUpId: historical.Id, TradeNo: historical.TradeNo, Money: historical.Money}}
						require.NoError(t, legacyDB.Create(&legacyRequest).Error)
					}
					require.NoError(t, db.AutoMigrate(&User{}, &Option{}, &TopUp{}, &InvoiceRequest{}, &InvoiceRequestOrder{}))
					require.NoError(t, db.AutoMigrate(&User{}, &Option{}, &TopUp{}, &InvoiceRequest{}, &InvoiceRequestOrder{}))
					if upgrade {
						var preservedRequest InvoiceRequest
						require.NoError(t, db.Preload("Orders").First(&preservedRequest, legacyRequest.Id).Error)
						assert.Equal(t, legacyRequest.Title, preservedRequest.Title)
						assert.Equal(t, "personal", preservedRequest.TitleType)
						assert.Equal(t, legacyRequest.InvoiceNumber, preservedRequest.InvoiceNumber)
						assert.Equal(t, legacyRequest.Orders, preservedRequest.Orders)
						assert.Empty(t, preservedRequest.InvoiceAddress)
						assert.Empty(t, preservedRequest.BankAccount)
						var preserved TopUp
						require.NoError(t, db.First(&preserved, historical.Id).Error)
						assert.Equal(t, historical, preserved)
						duplicate := historical
						duplicate.Id = 0
						require.Error(t, db.Create(&duplicate).Error)
					}
					users := []User{
						{Id: 1, Username: "invoice-owner", DisplayName: "Invoice Applicant", Role: common.RoleCommonUser, Status: common.UserStatusEnabled},
						{Id: 2, Username: "other-owner", Role: common.RoleCommonUser, Status: common.UserStatusEnabled},
						{Id: 7, Username: "invoice-admin", Role: common.RoleAdminUser, Status: common.UserStatusEnabled},
						{Id: 8, Username: "disabled-admin", Role: common.RoleAdminUser, Status: common.UserStatusDisabled},
					}
					for i := range users {
						users[i].AffCode = fmt.Sprintf("invoice-%d", users[i].Id)
					}
					require.NoError(t, db.Create(&users).Error)
					invoiceSettings, err := GetInvoiceSettings()
					require.NoError(t, err)
					assert.Equal(t, 1000.0, invoiceSettings.MinimumAmount)
					assert.Equal(t, 90, invoiceSettings.ApplicationDays)
					// The existing lifecycle cases use a small configurable minimum.
					require.NoError(t, SaveInvoiceSettings(InvoiceSettings{MinimumAmount: 1}))

					require.NoError(t, SetInvoiceNotificationUsers([]int{7, 7}))
					settings, err := GetInvoiceNotificationSettings()
					require.NoError(t, err)
					assert.Equal(t, []int{7}, settings.UserIDs)
					require.Len(t, settings.Administrators, 1)
					assert.Equal(t, 7, settings.Administrators[0].Id)
					for _, ids := range [][]int{{1}, {8}, {999}} {
						require.Error(t, SetInvoiceNotificationUsers(ids))
					}
					require.NoError(t, SetInvoiceNotificationUsers(nil))
					// Templates survive persistence and replacement on every supported dialect.
					templates, err := GetInvoiceEmailTemplates()
					require.NoError(t, err)
					assert.Empty(t, templates.Admin.HTML)
					templates = InvoiceEmailTemplates{
						Admin:    InvoiceEmailTemplate{Subject: "新的申请 {{.Title}}", HTML: "<p>{{.Title}}</p>" + strings.Repeat("<!-- 发票 -->", 1500)},
						Customer: InvoiceEmailTemplate{Subject: "您的发票", HTML: "<p>{{.InvoiceNumber}}</p>"},
					}
					require.NoError(t, SaveInvoiceEmailTemplates(templates))
					storedTemplates, err := GetInvoiceEmailTemplates()
					require.NoError(t, err)
					assert.Equal(t, templates, storedTemplates)
					templates.Admin.Subject = "更新后的申请通知"
					require.NoError(t, SaveInvoiceEmailTemplates(templates))
					storedTemplates, err = GetInvoiceEmailTemplates()
					require.NoError(t, err)
					assert.Equal(t, templates, storedTemplates)
					orders := []TopUp{
						{UserId: 1, CreateTime: 900, CompleteTime: 1000, TradeNo: "paid-1", Money: 10.25, Amount: 15, Status: common.TopUpStatusSuccess},
						{UserId: 1, CreateTime: 1900, CompleteTime: 2000, TradeNo: "paid-2", Money: 20.75, Amount: 25, Status: common.TopUpStatusSuccess},
						{UserId: 2, TradeNo: "other-user", Money: 50, Status: common.TopUpStatusSuccess},
						{UserId: 1, TradeNo: "unpaid", Money: 30, Status: common.TopUpStatusPending},
						{UserId: 1, TradeNo: "invoiced", Money: 40, Status: common.TopUpStatusSuccess, InvoiceStatus: TopUpInvoiceStatusIssued},
						{UserId: 1, TradeNo: "zero", Money: 0, Status: common.TopUpStatusSuccess},
					}
					require.NoError(t, db.Create(&orders).Error)
					input := InvoiceApplicationInput{OrderIds: []int{orders[0].Id, orders[1].Id}, TitleType: "company", Title: "Example Ltd", TaxId: "TAX123", Email: "billing@example.com", Remark: "Monthly invoice", InvoiceAddress: "  12 Main Street  ", InvoicePhone: "  123456  ", BankName: "  Example Bank  ", BankAccount: "  0012345  "}
					for _, ids := range [][]int{nil, {orders[2].Id}, {orders[3].Id}, {orders[4].Id}, {orders[5].Id}, {orders[0].Id, orders[2].Id}, {orders[0].Id, orders[0].Id}, {999999}, make([]int, 101)} {
						invalid := input
						invalid.OrderIds = ids
						_, err := CreateInvoiceRequest(1, invalid)
						require.ErrorIs(t, err, ErrInvoiceRequestOrders)
					}
					for _, field := range []string{"personal", "tax", "email", "title", "type", "address", "phone", "bank", "account"} {
						invalid := input
						switch field {
						case "personal":
							invalid.TitleType = "personal"
						case "tax":
							invalid.TaxId = ""
						case "email":
							invalid.Email = "not-email"
						case "title":
							invalid.Title = " "
						case "address":
							invalid.InvoiceAddress = strings.Repeat("址", 301)
						case "phone":
							invalid.InvoicePhone = strings.Repeat("1", 51)
						case "bank":
							invalid.BankName = strings.Repeat("行", 101)
						case "account":
							invalid.BankAccount = strings.Repeat("1", 65)
						case "type":
							invalid.TitleType = "invalid"
						}
						_, err := CreateInvoiceRequest(1, invalid)
						require.ErrorIs(t, err, ErrInvoiceRequestInput)
					}
					page := &common.PageInfo{Page: 1, PageSize: 10}
					require.NoError(t, GetInvoiceEligibleOrders(1, page, InvoiceSearch{}))
					assert.Equal(t, 2, page.Total)
					require.NoError(t, GetInvoiceEligibleOrders(1, page, InvoiceSearch{Start: 1000, End: 1000, Keyword: "paid"}))
					assert.Equal(t, 1, page.Total)
					require.Error(t, GetInvoiceEligibleOrders(1, page, InvoiceSearch{Start: 2000, End: 1000}))
					request, err := CreateInvoiceRequest(1, input)
					require.NoError(t, err)
					assert.Equal(t, InvoiceRequestPending, request.Status)
					var storedDetails InvoiceRequest
					require.NoError(t, db.First(&storedDetails, request.Id).Error)
					assert.Equal(t, "12 Main Street", storedDetails.InvoiceAddress)
					assert.Equal(t, "123456", storedDetails.InvoicePhone)
					assert.Equal(t, "Example Bank", storedDetails.BankName)
					assert.Equal(t, "0012345", storedDetails.BankAccount)
					require.Len(t, request.Orders, 2)
					assert.Equal(t, 10.25, request.Orders[0].Money)
					assert.Equal(t, 20.75, request.Orders[1].Money)
					_, err = CreateInvoiceRequest(1, input)
					require.ErrorIs(t, err, ErrInvoiceRequestConflict)
					require.NoError(t, GetInvoiceEligibleOrders(1, page, InvoiceSearch{}))
					assert.Zero(t, page.Total)
					require.NoError(t, ListInvoiceRequests(2, "", page, InvoiceSearch{}))
					assert.Zero(t, page.Total)
					require.NoError(t, ListInvoiceRequests(1, InvoiceRequestPending, page, InvoiceSearch{}))
					assert.Equal(t, 1, page.Total)
					require.NoError(t, ListInvoiceRequests(0, InvoiceRequestPending, page, InvoiceSearch{}))
					assert.Equal(t, 1, page.Total)
					for _, filter := range []InvoiceSearch{
						{Keyword: "paid-1", User: "Applicant", Start: request.CreatedAt, End: request.CreatedAt},
						{Keyword: "billing@example.com", User: "1", TitleType: "company"},
						{Keyword: "TAX123", User: "invoice-owner"},
					} {
						require.NoError(t, ListInvoiceRequests(0, InvoiceRequestPending, page, filter))
						assert.Equal(t, 1, page.Total)
						items := page.Items.([]InvoiceRequest)
						require.Len(t, items, 1)
						assert.Equal(t, "invoice-owner", items[0].Username)
						assert.Equal(t, "Invoice Applicant", items[0].DisplayName)
					}
					for _, filter := range []InvoiceSearch{{Start: request.CreatedAt + 1}, {User: "2"}, {Keyword: "' OR 1=1 --"}} {
						require.NoError(t, ListInvoiceRequests(0, "", page, filter))
						assert.Zero(t, page.Total)
					}
					require.NoError(t, ListInvoiceRequests(2, "", page, InvoiceSearch{User: "1", Keyword: "TAX123"}))
					assert.Zero(t, page.Total)
					_, err = GetInvoiceForDelivery(request.Id, 1, false)
					require.ErrorIs(t, err, gorm.ErrRecordNotFound)
					_, _, err = AttachInvoiceFile(request.Id, "invoice-file:0123456789abcdef0123456789abcdef.pdf")
					require.NoError(t, err)
					_, err = GetInvoiceForDelivery(request.Id, 7, true)
					require.NoError(t, err)
					_, err = ProcessInvoiceRequest(request.Id, 7, InvoiceProcessInput{Status: InvoiceRequestRejected})
					require.ErrorIs(t, err, ErrInvoiceRequestInput)
					rejected, err := ProcessInvoiceRequest(request.Id, 7, InvoiceProcessInput{Status: InvoiceRequestRejected, Note: "Please correct the title"})
					require.NoError(t, err)
					assert.Equal(t, InvoiceRequestRejected, rejected.Status)
					require.NoError(t, GetInvoiceEligibleOrders(1, page, InvoiceSearch{}))
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
					require.NoError(t, ListInvoiceRequests(1, InvoiceRequestPending, page, InvoiceSearch{}))
					assert.Equal(t, 1, page.Total)
					require.NoError(t, db.Model(&TopUp{}).Where("id = ?", orders[1].Id).Update("invoice_status", TopUpInvoiceStatusNone).Error)
					for _, link := range []string{"invoice-file:0123456789abcdef0123456789abcdef.pdf", "javascript:alert(1)", "http://example.com/invoice", "https://user:secret@example.com/invoice"} {
						_, err = ProcessInvoiceRequest(request.Id, 7, InvoiceProcessInput{Status: InvoiceRequestIssued, InvoiceNumber: "INV-001", InvoiceURL: link})
						require.ErrorIs(t, err, ErrInvoiceRequestInput)
					}
					_, _, err = AttachInvoiceFile(request.Id, "invoice-file:0123456789abcdef0123456789abcdef.pdf")
					require.NoError(t, err)
					issued, err := ProcessInvoiceRequest(request.Id, 7, InvoiceProcessInput{Status: InvoiceRequestIssued, InvoiceNumber: "INV-001", InvoiceURL: "https://example.com/invoice", Note: "Sent by email"})
					require.NoError(t, err)
					assert.Equal(t, InvoiceRequestIssued, issued.Status)
					assert.Equal(t, "invoice-file:0123456789abcdef0123456789abcdef.pdf", issued.InvoiceURL)
					assert.Equal(t, 7, issued.ProcessedBy)
					_, err = GetInvoiceForDelivery(request.Id, 1, false)
					require.NoError(t, err)
					_, err = GetInvoiceForDelivery(request.Id, 2, false)
					require.ErrorIs(t, err, gorm.ErrRecordNotFound)
					attached, previous, err := AttachInvoiceFile(request.Id, "invoice-file:0123456789abcdef0123456789abcdef.pdf")
					require.NoError(t, err)
					assert.Equal(t, "invoice-file:0123456789abcdef0123456789abcdef.pdf", previous)
					assert.Equal(t, InvoiceRequestIssued, attached.Status)

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
					require.NoError(t, db.AutoMigrate(&User{}, &Option{}, &TopUp{}, &InvoiceRequest{}, &InvoiceRequestOrder{}))
					require.NoError(t, ListInvoiceRequests(1, "", page, InvoiceSearch{}))
					assert.Equal(t, 2, page.Total)
					// Returning the marker permits reapplication, retaining the original history.
					_, err = UpdateTopUpInvoiceStatuses(input.OrderIds, TopUpInvoiceActionReturn, 7)
					require.NoError(t, err)
					require.NoError(t, GetInvoiceEligibleOrders(1, page, InvoiceSearch{}))
					assert.Equal(t, 2, page.Total)
					// Clearing an issued marker also restores eligibility.
					require.NoError(t, db.Model(&TopUp{}).Where("id = ?", orders[0].Id).Update("invoice_status", TopUpInvoiceStatusNone).Error)
					orders[1].InvoiceStatus = TopUpInvoiceStatusReturned

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
					require.NoError(t, ListInvoiceRequests(1, InvoiceRequestPending, page, InvoiceSearch{}))
					assert.Equal(t, 1, page.Total)
					// Unique pending claims survive repeated migrations and cannot be bypassed.
					pending := page.Items.([]InvoiceRequest)[0]
					duplicateClaim := pending.Orders[0]
					duplicateClaim.Id = 0
					require.Error(t, db.Create(&duplicateClaim).Error)
					// Only the owner may withdraw a pending request; failures retain claims.
					for _, owner := range []int{0, 2, 7} {
						_, err := WithdrawInvoiceRequest(pending.Id, owner)
						require.ErrorIs(t, err, ErrInvoiceRequestProcessed)
					}
					_, err = WithdrawInvoiceRequest(999999, 1)
					require.ErrorIs(t, err, ErrInvoiceRequestProcessed)
					for _, processed := range []*InvoiceRequest{rejected, issued} {
						_, err = WithdrawInvoiceRequest(processed.Id, 1)
						require.ErrorIs(t, err, ErrInvoiceRequestProcessed)
					}
					require.NoError(t, GetInvoiceEligibleOrders(1, page, InvoiceSearch{}))
					assert.Zero(t, page.Total)
					withdrawn, err := WithdrawInvoiceRequest(pending.Id, 1)
					require.NoError(t, err)
					assert.Equal(t, InvoiceRequestWithdrawn, withdrawn.Status)
					assert.Positive(t, withdrawn.ProcessedAt)
					assert.Zero(t, withdrawn.ProcessedBy)
					require.Len(t, withdrawn.Orders, 2)
					require.NoError(t, ListInvoiceRequests(1, InvoiceRequestWithdrawn, page, InvoiceSearch{}))
					assert.Equal(t, 1, page.Total)
					require.NoError(t, GetInvoiceEligibleOrders(1, page, InvoiceSearch{}))
					assert.Equal(t, 2, page.Total)
					_, err = WithdrawInvoiceRequest(pending.Id, 1)
					require.ErrorIs(t, err, ErrInvoiceRequestProcessed)
					_, err = ProcessInvoiceRequest(pending.Id, 7, InvoiceProcessInput{Status: InvoiceRequestIssued, InvoiceNumber: "TOO-LATE"})
					require.ErrorIs(t, err, ErrInvoiceRequestProcessed)
					reapplied, err := CreateInvoiceRequest(1, input)
					require.NoError(t, err)
					assert.NotEqual(t, pending.Id, reapplied.Id)
					// Competing withdrawal and issue must never both succeed.
					start = make(chan struct{})
					successes.Store(0)
					wg.Go(func() {
						<-start
						if _, err := WithdrawInvoiceRequest(reapplied.Id, 1); err == nil {
							successes.Add(1)
						}
					})
					wg.Go(func() {
						<-start
						if _, err := ProcessInvoiceRequest(reapplied.Id, 7, InvoiceProcessInput{Status: InvoiceRequestIssued, InvoiceNumber: "RACE"}); err == nil {
							successes.Add(1)
						}
					})
					close(start)
					wg.Wait()
					assert.EqualValues(t, 1, successes.Load())
					require.NoError(t, db.First(reapplied, reapplied.Id).Error)
					for _, original := range orders[:2] {
						var actual TopUp
						require.NoError(t, db.First(&actual, original.Id).Error)
						assert.Equal(t, original.Money, actual.Money)
						assert.Equal(t, original.Amount, actual.Amount)
						assert.Equal(t, original.Status, actual.Status)
						if reapplied.Status == InvoiceRequestIssued {
							assert.Equal(t, TopUpInvoiceStatusIssued, actual.InvoiceStatus)
						} else {
							assert.Equal(t, InvoiceRequestWithdrawn, reapplied.Status)
							assert.Equal(t, original.InvoiceStatus, actual.InvoiceStatus)
						}
					}

					t.Run("payment window filters orders and rejects direct submissions", func(t *testing.T) {
						require.NoError(t, SaveInvoiceSettings(InvoiceSettings{MinimumAmount: 0, ApplicationDays: 90}))
						settings, err := GetInvoiceSettings()
						require.NoError(t, err)
						assert.Equal(t, 90, settings.ApplicationDays)
						now := common.GetTimestamp()
						orders := []TopUp{
							{UserId: 2, TradeNo: "window-inside", Money: 1000, Status: common.TopUpStatusSuccess, CreateTime: now - 200*86400, CompleteTime: now - 90*86400 + 60},
							{UserId: 2, TradeNo: "window-expired", Money: 1000, Status: common.TopUpStatusSuccess, CreateTime: now, CompleteTime: now - 90*86400 - 60},
							{UserId: 2, TradeNo: "window-missing", Money: 1000, Status: common.TopUpStatusSuccess},
							{UserId: 2, TradeNo: "window-future", Money: 1000, Status: common.TopUpStatusSuccess, CompleteTime: now + 86400},
							{UserId: 2, TradeNo: "window-issued", Money: 1000, Status: common.TopUpStatusSuccess, CompleteTime: now, InvoiceStatus: TopUpInvoiceStatusIssued},
						}
						require.NoError(t, db.Create(&orders).Error)
						page := &common.PageInfo{Page: 1, PageSize: 10}
						require.NoError(t, GetInvoiceEligibleOrders(2, page, InvoiceSearch{Keyword: "window-"}))
						visible := page.Items.([]TopUp)
						require.Len(t, visible, 1)
						assert.Equal(t, orders[0].Id, visible[0].Id)
						input := InvoiceApplicationInput{Title: "Window test", TaxId: "TAX123", Email: "test@example.com"}
						for _, order := range orders[1:] {
							input.OrderIds = []int{order.Id}
							_, err := CreateInvoiceRequest(2, input)
							require.Error(t, err)
						}
						input.OrderIds = []int{orders[0].Id, orders[1].Id}
						_, err = CreateInvoiceRequest(2, input)
						require.Error(t, err, "one expired order rejects the entire application")
						input.OrderIds = []int{orders[0].Id}
						pending, err := CreateInvoiceRequest(2, input)
						require.NoError(t, err)
						require.NoError(t, SaveInvoiceSettings(InvoiceSettings{MinimumAmount: 0, ApplicationDays: 1}))
						// Tightening the application window does not invalidate already submitted applications.
						_, err = ProcessInvoiceRequest(pending.Id, 7, InvoiceProcessInput{Status: InvoiceRequestIssued, InvoiceNumber: "WINDOW"})
						require.NoError(t, err)
						require.NoError(t, SaveInvoiceSettings(InvoiceSettings{MinimumAmount: 0, ApplicationDays: 180}))
						stored, err := GetInvoiceSettings()
						require.NoError(t, err)
						assert.Equal(t, 180, stored.ApplicationDays)
						input.OrderIds = []int{orders[1].Id}
						_, err = CreateInvoiceRequest(2, input)
						require.NoError(t, err)
						for _, value := range []string{"-1", "1.5", "3651", "not-days"} {
							require.Error(t, UpdateOptionsBulk(map[string]string{InvoiceApplicationDaysOption: value}))
						}
						require.Error(t, SaveInvoiceSettings(InvoiceSettings{MinimumAmount: 500, ApplicationDays: -1}))
						stored, err = GetInvoiceSettings()
						require.NoError(t, err)
						assert.Equal(t, 180, stored.ApplicationDays)
						assert.Zero(t, stored.MinimumAmount, "invalid day settings must not partially update the minimum")
						require.NoError(t, SaveInvoiceSettings(InvoiceSettings{MinimumAmount: 0, ApplicationDays: 0}))
						require.NoError(t, GetInvoiceEligibleOrders(2, page, InvoiceSearch{Keyword: "window-missing"}))
						assert.Equal(t, 1, page.Total)
					})
					t.Run("minimum amount is inclusive and uses server order totals", func(t *testing.T) {
						require.NoError(t, db.Where(&Option{Key: InvoiceMinimumAmountOption}).Delete(&Option{}).Error)
						defaults, err := GetInvoiceSettings()
						require.NoError(t, err)
						assert.Equal(t, 1000.0, defaults.MinimumAmount)
						for _, tc := range []struct {
							name    string
							amounts []float64
							minimum float64
							allowed bool
						}{
							{"below default", []float64{999.99}, 1000, false},
							{"equal default", []float64{1000}, 1000, true},
							{"above default", []float64{1000.01}, 1000, true},
							{"combined equals", []float64{600, 400}, 1000, true},
							{"decimal combined equals", []float64{0.1, 0.7}, 0.8, true},
							{"new minimum blocks", []float64{1000}, 1500, false},
							{"new minimum permits", []float64{1500}, 1500, true},
							{"zero minimum", []float64{0.01}, 0, true},
						} {
							t.Run(tc.name, func(t *testing.T) {
								require.NoError(t, SaveInvoiceSettings(InvoiceSettings{MinimumAmount: tc.minimum}))
								saved, err := GetInvoiceSettings()
								require.NoError(t, err)
								assert.Equal(t, tc.minimum, saved.MinimumAmount)
								for _, titleType := range []string{"company", ""} {
									orders := make([]TopUp, len(tc.amounts))
									for i, amount := range tc.amounts {
										orders[i] = TopUp{UserId: 2, TradeNo: fmt.Sprintf("minimum-%s-%s-%d", tc.name, titleType, i), Money: amount, Status: common.TopUpStatusSuccess}
									}
									require.NoError(t, db.Create(&orders).Error)
									input := InvoiceApplicationInput{TitleType: titleType, Title: "Minimum test", TaxId: "TAX123", Email: "test@example.com"}
									for _, order := range orders {
										input.OrderIds = append(input.OrderIds, order.Id)
									}
									var before int64
									require.NoError(t, db.Model(&InvoiceRequest{}).Count(&before).Error)
									request, err := CreateInvoiceRequest(2, input)
									if tc.allowed {
										require.NoError(t, err)
										assert.Len(t, request.Orders, len(tc.amounts))
										assert.Equal(t, "company", request.TitleType)
									} else {
										require.Error(t, err)
										var message *common.Message
										require.ErrorAs(t, err, &message)
										assert.Equal(t, "Invoice amount must be at least {{amount}}", message.Key)
										var count int64
										require.NoError(t, db.Model(&InvoiceRequestOrder{}).Where("active_top_up_id IN ?", input.OrderIds).Count(&count).Error)
										assert.Zero(t, count, "rejected application must not reserve orders")
										require.NoError(t, db.Model(&InvoiceRequest{}).Count(&count).Error)
										assert.Equal(t, before, count)
										assert.Nil(t, request)
									}
								}
							})
						}
						for _, amount := range []float64{-1, 1.001, math.NaN(), math.Inf(1), 1e13} {
							require.Error(t, SaveInvoiceSettings(InvoiceSettings{MinimumAmount: amount}))
						}
						saved, err := GetInvoiceSettings()
						require.NoError(t, err)
						assert.Zero(t, saved.MinimumAmount, "invalid settings must not replace the previous value")
						require.Error(t, UpdateOptionsBulk(map[string]string{InvoiceMinimumAmountOption: "invalid"}))
						require.NoError(t, db.Model(&Option{}).Where(&Option{Key: InvoiceMinimumAmountOption}).Update("value", "invalid").Error)
						_, err = GetInvoiceSettings()
						require.Error(t, err, "corrupt settings must fail closed")
					})

				})
			}
		})
	}
}
