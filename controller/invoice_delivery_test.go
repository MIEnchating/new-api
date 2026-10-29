package controller

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestInvoiceFileDelivery(t *testing.T) {
	originalRedis := common.RedisEnabled
	common.RedisEnabled = false
	t.Cleanup(func() { common.RedisEnabled = originalRedis })
	originalLimit, originalDuration := constant.NotifyLimitCount, constant.NotificationLimitDurationMinute
	constant.NotifyLimitCount, constant.NotificationLimitDurationMinute = 100, 1
	t.Cleanup(func() {
		constant.NotifyLimitCount, constant.NotificationLimitDurationMinute = originalLimit, originalDuration
	})
	storage := t.TempDir()
	t.Setenv("INVOICE_STORAGE_DIR", storage)
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "delivery.db")), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	originalDB, originalLogDB := model.DB, model.LOG_DB
	model.DB, model.LOG_DB = db, db
	t.Cleanup(func() { model.DB, model.LOG_DB = originalDB, originalLogDB; assert.NoError(t, sqlDB.Close()) })
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.InvoiceRequest{}, &model.InvoiceRequestOrder{}, &model.Option{}, &model.AuditLog{}, &model.TopUp{}))
	users := []model.User{
		{Id: 1, Username: "applicant", AffCode: "owner", Email: "account@example.com", Status: common.UserStatusEnabled, Role: common.RoleCommonUser, Setting: `{"language":"en"}`},
		{Id: 7, Username: "processor", AffCode: "admin", Email: "admin@example.com", Status: common.UserStatusEnabled, Role: common.RoleAdminUser, Setting: `{"language":"en"}`},
		{Id: 8, Username: "disabled", AffCode: "disabled", Email: "disabled@example.com", Status: common.UserStatusDisabled, Role: common.RoleAdminUser},
	}
	require.NoError(t, db.Create(&users).Error)
	require.NoError(t, db.Create(&model.Option{Key: model.InvoiceMinimumAmountOption, Value: "0"}).Error)
	application := model.InvoiceRequest{UserId: 1, Title: "<script>company</script>", Email: "invoice@example.com", Status: model.InvoiceRequestPending, InvoiceNumber: "INV-1"}
	require.NoError(t, db.Create(&application).Error)
	require.NoError(t, db.Create(&model.InvoiceRequestOrder{RequestId: application.Id, TopUpId: 99, TradeNo: "email-total", Money: 125.50}).Error)
	configureEmailDelivery(t, map[string]string{"EmailProvider": "resend", "ResendApiKey": "test-key", "ResendFrom": "sender@example.com"})
	require.NoError(t, i18n.Init())
	pdf := []byte("%PDF-1.7\nInvoice test\n%%EOF")

	t.Run("upload validates actual file contents and atomically replaces files", func(t *testing.T) {
		for _, content := range [][]byte{nil, []byte("<html>not a PDF</html>"), bytes.Repeat([]byte("x"), service.MaxInvoiceFileSize+1), pdf} {
			var body bytes.Buffer
			writer := multipart.NewWriter(&body)
			part, err := writer.CreateFormFile("file", "../../invoice.pdf")
			require.NoError(t, err)
			_, err = part.Write(content)
			require.NoError(t, err)
			require.NoError(t, writer.Close())
			response := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(response)
			c.Set("id", 7)
			c.Set("role", common.RoleAdminUser)
			c.Params = gin.Params{{Key: "id", Value: strconv.Itoa(application.Id)}}
			c.Request = httptest.NewRequest(http.MethodPost, "/api/user/invoices/1/file", &body)
			c.Request.Header.Set("Content-Type", writer.FormDataContentType())
			UploadInvoiceFile(c)
			var result struct {
				Success bool `json:"success"`
			}
			require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
			assert.Equal(t, bytes.Equal(content, pdf), result.Success)
		}
		require.NoError(t, db.First(&application, application.Id).Error)
		assert.Equal(t, model.InvoiceRequestPending, application.Status, "upload must not issue the invoice")
		assert.True(t, strings.HasPrefix(application.InvoiceURL, "invoice-file:"))
		file, err := service.ReadInvoiceFile(application.InvoiceURL, application.Id)
		require.NoError(t, err)
		assert.Equal(t, pdf, file.Content)
		_, err = service.ReadInvoiceFile("invoice-file:../../private.pdf", application.Id)
		require.Error(t, err)
		previous := application.InvoiceURL
		replacement, err := service.StoreInvoiceFile(bytes.NewReader(pdf))
		require.NoError(t, err)
		_, old, err := model.AttachInvoiceFile(application.Id, replacement)
		require.NoError(t, err)
		assert.Equal(t, previous, old)
		service.RemoveInvoiceFile(old)
		_, err = service.ReadInvoiceFile(old, application.Id)
		require.Error(t, err)
		application.InvoiceURL = replacement
		files, err := os.ReadDir(storage)
		require.NoError(t, err)
		assert.Len(t, files, 1)
	})

	t.Run("download requires ownership and issued status or administrator access", func(t *testing.T) {
		for _, tc := range []struct {
			user, role int
			status     string
			code       int
		}{
			{1, common.RoleCommonUser, model.InvoiceRequestPending, 404},
			{7, common.RoleAdminUser, model.InvoiceRequestPending, 200},
			{2, common.RoleCommonUser, model.InvoiceRequestIssued, 404},
			{1, common.RoleCommonUser, model.InvoiceRequestRejected, 404},
			{1, common.RoleCommonUser, model.InvoiceRequestIssued, 200},
		} {
			require.NoError(t, db.Model(&application).Update("status", tc.status).Error)
			response := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(response)
			c.Set("id", tc.user)
			c.Set("role", tc.role)
			c.Params = gin.Params{{Key: "id", Value: strconv.Itoa(application.Id)}}
			c.Request = httptest.NewRequest(http.MethodGet, "/api/user/invoices/1/file", nil)
			DownloadInvoiceFile(c)
			c.Writer.WriteHeaderNow()
			assert.Equal(t, tc.code, response.Code)
			assert.Equal(t, "no-store", response.Header().Get("Cache-Control"))
			if tc.code == 200 {
				assert.Equal(t, pdf, response.Body.Bytes())
				assert.Contains(t, response.Header().Get("Content-Disposition"), "attachment;")
				assert.Equal(t, "nosniff", response.Header().Get("X-Content-Type-Options"))
			}
		}
	})

	t.Run("email delivers the attachment only to the application email", func(t *testing.T) {
		calls := 0
		http.DefaultTransport = emailHTTPTransport(func(request *http.Request) (*http.Response, error) {
			calls++
			var payload struct {
				To          []string                 `json:"to"`
				HTML        string                   `json:"html"`
				Attachments []common.EmailAttachment `json:"attachments"`
			}
			require.NoError(t, common.DecodeJson(request.Body, &payload))
			assert.Equal(t, []string{application.Email}, payload.To)
			assert.Contains(t, payload.HTML, "&lt;script&gt;")
			assert.Contains(t, payload.HTML, "发票")
			assert.Contains(t, payload.HTML, "<table")
			assert.Contains(t, payload.HTML, "125.50")
			assert.NotContains(t, payload.HTML, "<script>")
			require.Len(t, payload.Attachments, 1)
			assert.Equal(t, pdf, payload.Attachments[0].Content)
			assert.Equal(t, "application/pdf", payload.Attachments[0].ContentType)
			return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"id":"invoice-delivered"}`)), Header: make(http.Header)}, nil
		})
		application.Status = model.InvoiceRequestPending
		require.Error(t, service.SendInvoiceEmail(&application))
		assert.Zero(t, calls)
		application.Status = model.InvoiceRequestIssued
		require.NoError(t, service.SendInvoiceEmail(&application))
		assert.Equal(t, 1, calls)
		http.DefaultTransport = emailHTTPTransport(func(_ *http.Request) (*http.Response, error) {
			return &http.Response{StatusCode: 500, Body: io.NopCloser(strings.NewReader(`secret diagnostic`)), Header: make(http.Header)}, nil
		})
		require.EqualError(t, service.SendInvoiceEmail(&application), "Invoice email could not be sent. Please try again later")
	})

	t.Run("email endpoint rejects other owners and limits repeated sends", func(t *testing.T) {
		limit := constant.NotifyLimitCount
		constant.NotifyLimitCount = 1
		defer func() { constant.NotifyLimitCount = limit }()
		calls := 0
		http.DefaultTransport = emailHTTPTransport(func(request *http.Request) (*http.Response, error) {
			calls++
			var payload struct {
				To []string `json:"to"`
			}
			require.NoError(t, common.DecodeJson(request.Body, &payload))
			assert.Equal(t, []string{"invoice@example.com"}, payload.To)
			return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"id":"invoice-delivered"}`)), Header: make(http.Header)}, nil
		})
		for _, tc := range []struct {
			user    int
			success bool
		}{{2, false}, {1, true}, {1, false}} {
			response := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(response)
			c.Set("id", tc.user)
			c.Set("role", common.RoleCommonUser)
			c.Params = gin.Params{{Key: "id", Value: strconv.Itoa(application.Id)}}
			c.Request = httptest.NewRequest(http.MethodPost, "/api/user/invoices/1/email", strings.NewReader(`{"email":"override@example.com"}`))
			SendInvoiceEmail(c)
			var result struct {
				Success bool `json:"success"`
			}
			require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
			assert.Equal(t, tc.success, result.Success)
		}
		assert.Equal(t, 1, calls)
	})

	t.Run("completion respects the mail switch and preserves issuance on delivery failure", func(t *testing.T) {
		for _, tc := range []struct {
			name, extra          string
			missing, mailFailure bool
			sent                 int
			success              bool
		}{
			{name: "default on", sent: 1, success: true},
			{name: "explicit on", extra: `,"send_email":true`, sent: 1, success: true},
			{name: "off", extra: `,"send_email":false`, sent: 0, success: true},
			{name: "off without file", extra: `,"send_email":false`, missing: true, success: true},
			{name: "on without file", missing: true, success: false},
			{name: "failed mail", mailFailure: true, sent: 1, success: true},
		} {
			t.Run(tc.name, func(t *testing.T) {
				order := model.TopUp{UserId: 1, TradeNo: "invoice-switch-" + tc.name, CompleteTime: common.GetTimestamp(), Money: 12.5, Status: common.TopUpStatusSuccess}
				require.NoError(t, db.Create(&order).Error)
				request, err := model.CreateInvoiceRequest(1, model.InvoiceApplicationInput{OrderIds: []int{order.Id}, TitleType: "company", Title: "Invoice switch", TaxId: "TAX123", Email: "invoice@example.com"})
				require.NoError(t, err)
				if !tc.missing {
					_, _, err = model.AttachInvoiceFile(request.Id, application.InvoiceURL)
					require.NoError(t, err)
				}
				calls := 0
				http.DefaultTransport = emailHTTPTransport(func(_ *http.Request) (*http.Response, error) {
					calls++
					code := 200
					if tc.mailFailure {
						code = 500
					}
					return &http.Response{StatusCode: code, Body: io.NopCloser(strings.NewReader(`{"id":"sent"}`)), Header: make(http.Header)}, nil
				})
				response := httptest.NewRecorder()
				c, _ := gin.CreateTestContext(response)
				c.Set("id", 7)
				c.Set("role", common.RoleAdminUser)
				c.Params = gin.Params{{Key: "id", Value: strconv.Itoa(request.Id)}}
				c.Request = httptest.NewRequest(http.MethodPut, "/api/user/invoices/1", strings.NewReader(`{"status":"issued","invoice_number":"12345678"`+tc.extra+`}`))
				c.Request.Header.Set("Content-Type", "application/json")
				ProcessInvoiceRequest(c)
				var result struct {
					Success bool `json:"success"`
					Data    struct {
						Status      string `json:"status"`
						EmailSent   bool   `json:"email_sent"`
						EmailFailed bool   `json:"email_failed"`
					} `json:"data"`
				}
				require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
				assert.Equal(t, tc.success, result.Success, response.Body.String())
				assert.Equal(t, tc.sent, calls)
				assert.Equal(t, tc.sent > 0 && !tc.mailFailure, result.Data.EmailSent)
				assert.Equal(t, tc.mailFailure, result.Data.EmailFailed)
				require.NoError(t, db.First(request, request.Id).Error)
				if tc.success {
					assert.Equal(t, model.InvoiceRequestIssued, request.Status)
				} else {
					assert.Equal(t, model.InvoiceRequestPending, request.Status)
				}
			})
		}
	})

	t.Run("recognizes labelled PDF and image numbers with safe manual fallback", func(t *testing.T) {
		for _, name := range []string{"pdftotext", "pdftoppm", "tesseract"} {
			if _, err := exec.LookPath(name); err != nil {
				t.Skip("local recognition tools are unavailable")
			}
		}
		content := invoiceRecognitionPDF("Invoice number: 12345678901234567890")
		reference, err := service.StoreInvoiceFile(bytes.NewReader(content))
		require.NoError(t, err)
		defer service.RemoveInvoiceFile(reference)
		assert.Equal(t, "12345678901234567890", service.RecognizeInvoiceNumber(context.Background(), reference))
		directory := t.TempDir()
		source := filepath.Join(directory, "invoice.pdf")
		require.NoError(t, os.WriteFile(source, content, 0600))
		command := exec.Command("pdftoppm", "-singlefile", "-scale-to", "2000", "-png", source, filepath.Join(directory, "page"))
		require.NoError(t, command.Run())
		image, err := os.ReadFile(filepath.Join(directory, "page.png"))
		require.NoError(t, err)
		imageReference, err := service.StoreInvoiceFile(bytes.NewReader(image))
		require.NoError(t, err)
		defer service.RemoveInvoiceFile(imageReference)
		assert.Equal(t, "12345678901234567890", service.RecognizeInvoiceNumber(context.Background(), imageReference))
		ambiguous, err := service.StoreInvoiceFile(bytes.NewReader(invoiceRecognitionPDF("Invoice number: 12345678", "Invoice number: 87654321")))
		require.NoError(t, err)
		defer service.RemoveInvoiceFile(ambiguous)
		assert.Empty(t, service.RecognizeInvoiceNumber(context.Background(), ambiguous))
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		assert.Empty(t, service.RecognizeInvoiceNumber(ctx, reference))
		t.Setenv("PATH", t.TempDir())
		assert.Empty(t, service.RecognizeInvoiceNumber(context.Background(), reference))
		_, err = service.ReadInvoiceFile(reference, 1)
		require.NoError(t, err, "recognition failure must retain the uploaded file")
	})

	t.Run("new application notices reach only configured active administrators", func(t *testing.T) {
		require.NoError(t, model.SetInvoiceNotificationUsers([]int{7}))
		var recipients []string
		http.DefaultTransport = emailHTTPTransport(func(request *http.Request) (*http.Response, error) {
			var payload struct {
				To   []string `json:"to"`
				HTML string   `json:"html"`
			}
			require.NoError(t, common.DecodeJson(request.Body, &payload))
			recipients = append(recipients, payload.To...)
			assert.Contains(t, payload.HTML, "&lt;script&gt;")
			assert.Contains(t, payload.HTML, "发票")
			assert.Contains(t, payload.HTML, "<table")
			return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"id":"notice-delivered"}`)), Header: make(http.Header)}, nil
		})
		service.NotifyInvoiceAdministrators(&application)
		assert.Equal(t, []string{"admin@example.com"}, recipients)
		require.NoError(t, db.Model(&model.User{}).Where("id = ?", 7).Update("status", common.UserStatusDisabled).Error)
		service.NotifyInvoiceAdministrators(&application)
		assert.Len(t, recipients, 1)
		require.Error(t, model.SetInvoiceNotificationUsers([]int{1}))
		require.Error(t, model.SetInvoiceNotificationUsers([]int{8}))
	})
	t.Run("email templates preview without sending and saved templates drive delivery", func(t *testing.T) {
		defaults := service.DefaultInvoiceEmailTemplates()
		preview, err := service.PreviewInvoiceEmail(defaults.Admin, "admin")
		require.NoError(t, err)
		assert.Contains(t, preview.HTML, "125.50")
		assert.Contains(t, preview.HTML, "示例科技有限公司")
		for _, kind := range []string{"admin", "customer"} {
			source := defaults.Admin
			source.Subject = "开票申请 {{.Title}} <测试>"
			preview, err := service.PreviewInvoiceEmail(source, kind)
			require.NoError(t, err)
			assert.Equal(t, "开票申请 示例科技有限公司 <测试>", preview.Subject)
			assert.Contains(t, preview.HTML, ">开票申请 示例科技有限公司 &lt;测试&gt;</h1>")
		}
		calls := 0
		http.DefaultTransport = emailHTTPTransport(func(request *http.Request) (*http.Response, error) {
			calls++
			var payload struct {
				Subject string `json:"subject"`
				HTML    string `json:"html"`
			}
			require.NoError(t, common.DecodeJson(request.Body, &payload))
			assert.Equal(t, "自定义发票 INV-1", payload.Subject)
			assert.Contains(t, payload.HTML, "<h1>自定义发票 INV-1</h1>")
			assert.Contains(t, payload.HTML, "&lt;script&gt;company&lt;/script&gt;")
			assert.Contains(t, payload.HTML, "125.50")
			return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"id":"template-test"}`)), Header: make(http.Header)}, nil
		})
		custom := defaults
		custom.Customer = model.InvoiceEmailTemplate{Subject: "自定义发票 {{.InvoiceNumber}}", HTML: "<h1>{{.Heading}}</h1><p>{{.Title}}</p><p>{{.Amount}}</p>"}
		body, err := common.Marshal(custom)
		require.NoError(t, err)
		response := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(response)
		c.Set("id", 7)
		c.Request = httptest.NewRequest(http.MethodPut, "/api/user/invoices/email-templates", bytes.NewReader(body))
		c.Request.Header.Set("Content-Type", "application/json")
		SaveInvoiceEmailTemplates(c)
		var result struct {
			Success bool `json:"success"`
		}
		require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
		require.True(t, result.Success, response.Body.String())
		stored, err := service.GetInvoiceEmailTemplates()
		require.NoError(t, err)
		assert.Equal(t, custom, stored)
		_, err = service.PreviewInvoiceEmail(custom.Customer, "customer")
		require.NoError(t, err)
		assert.Zero(t, calls)
		for _, invalid := range []model.InvoiceEmailTemplate{
			{Subject: "", HTML: "<p>body</p>"},
			{Subject: "bad\r\nsubject", HTML: "<p>body</p>"},
			{Subject: "ok", HTML: "{{.UnknownField}}"},
			{Subject: "ok", HTML: "{{template \"body\" .}}"},
			{Subject: "ok", HTML: "{{printf \"%s\" .Title}}"},
			{Subject: "ok", HTML: strings.Repeat("a", 32769)},
			{Subject: "ok", HTML: "{{if .URL}}"},
		} {
			broken := custom
			broken.Customer = invalid
			require.Error(t, service.SaveInvoiceEmailTemplates(broken))
			current, err := service.GetInvoiceEmailTemplates()
			require.NoError(t, err)
			assert.Equal(t, custom, current)
		}
		_, err = service.PreviewInvoiceEmail(custom.Admin, "unknown")
		require.Error(t, err)
		delivery := application
		delivery.Status = model.InvoiceRequestIssued
		delivery.InvoiceURL = "https://example.com/invoice.pdf"
		require.NoError(t, service.SendInvoiceEmail(&delivery))
		assert.Equal(t, 1, calls)
		require.NoError(t, service.SaveInvoiceEmailTemplates(defaults))
		restored, err := service.GetInvoiceEmailTemplates()
		require.NoError(t, err)
		assert.Equal(t, defaults, restored)
	})

}

// A real text PDF can also be rendered for the image OCR regression.
func invoiceRecognitionPDF(lines ...string) []byte {
	var stream strings.Builder
	stream.WriteString("BT /F1 24 Tf 40 700 Td ")
	for _, line := range lines {
		fmt.Fprintf(&stream, "(%s) Tj 0 -60 Td ", line)
	}
	stream.WriteString("ET")
	objects := []string{
		"<< /Type /Catalog /Pages 2 0 R >>",
		"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 900 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
		fmt.Sprintf("<< /Length %d >>\nstream\n%s\nendstream", stream.Len(), stream.String()),
	}
	var output bytes.Buffer
	output.WriteString("%PDF-1.4\n")
	offsets := []int{0}
	for i, object := range objects {
		offsets = append(offsets, output.Len())
		fmt.Fprintf(&output, "%d 0 obj\n%s\nendobj\n", i+1, object)
	}
	xref := output.Len()
	fmt.Fprintf(&output, "xref\n0 %d\n0000000000 65535 f \n", len(offsets))
	for _, offset := range offsets[1:] {
		fmt.Fprintf(&output, "%010d 00000 n \n", offset)
	}
	fmt.Fprintf(&output, "trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF", len(offsets), xref)
	return output.Bytes()
}

func TestInvoiceSettingsAPI(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "invoice-settings.db")), &gorm.Config{})
	require.NoError(t, err)
	originalDB := model.DB
	model.DB = db
	sqlDB, err := db.DB()
	require.NoError(t, err)
	t.Cleanup(func() { model.DB = originalDB; assert.NoError(t, sqlDB.Close()) })
	require.NoError(t, db.AutoMigrate(&model.Option{}))
	common.OptionMapRWMutex.Lock()
	previous := common.OptionMap
	common.OptionMap = map[string]string{}
	common.OptionMapRWMutex.Unlock()
	t.Cleanup(func() {
		common.OptionMapRWMutex.Lock()
		common.OptionMap = previous
		common.OptionMapRWMutex.Unlock()
	})
	for _, tc := range []struct {
		body    string
		success bool
	}{
		{`{}`, false}, {`{"minimum_amount":null}`, false},
		{`{"minimum_amount":-1}`, false}, {`{"minimum_amount":1.001}`, false},
		{`{"minimum_amount":1500.50}`, false},
		{`{"minimum_amount":1500.50,"application_days":null}`, false},
		{`{"minimum_amount":1500.50,"application_days":1.5}`, false},
		{`{"minimum_amount":1500.50,"application_days":-1}`, false},
		{`{"minimum_amount":1500.50,"application_days":180}`, true},
	} {
		response := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(response)
		c.Request = httptest.NewRequest(http.MethodPut, "/api/user/invoices/settings", strings.NewReader(tc.body))
		c.Request.Header.Set("Content-Type", "application/json")
		SaveInvoiceSettings(c)
		var result struct {
			Success bool `json:"success"`
		}
		require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
		assert.Equal(t, tc.success, result.Success)
	}
	response := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(response)
	GetInvoiceSettings(c)
	var result struct {
		Success bool                  `json:"success"`
		Data    model.InvoiceSettings `json:"data"`
	}
	require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
	assert.True(t, result.Success)
	assert.Equal(t, 1500.50, result.Data.MinimumAmount)
	assert.Equal(t, 180, result.Data.ApplicationDays)
}
