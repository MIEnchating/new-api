package service

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"html"
	"io"
	"net/http"
	"net/mail"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/setting/system_setting"
)

const MaxInvoiceFileSize = 10 << 20

var invoiceFilePattern = regexp.MustCompile(`^invoice-file:([a-f0-9]{32}\.(pdf|png|jpg))$`)

func invoiceStorageDirectory() string {
	if directory := os.Getenv("INVOICE_STORAGE_DIR"); directory != "" {
		return directory
	}
	return filepath.Join("data", "invoices")
}

// Files stay outside static assets. Client filenames and MIME headers are not trusted.
func StoreInvoiceFile(reader io.Reader) (string, error) {
	content, err := io.ReadAll(io.LimitReader(reader, MaxInvoiceFileSize+1))
	if err != nil {
		return "", common.NewMessage("Failed to read invoice file")
	}
	if len(content) == 0 || len(content) > MaxInvoiceFileSize {
		return "", common.NewMessage("Invoice file must be a PDF, PNG or JPEG up to 10 MB")
	}
	var extension string
	switch http.DetectContentType(content) {
	case "application/pdf":
		extension = ".pdf"
	case "image/png":
		extension = ".png"
	case "image/jpeg":
		extension = ".jpg"
	default:
		return "", common.NewMessage("Invoice file must be a PDF, PNG or JPEG up to 10 MB")
	}
	directory := invoiceStorageDirectory()
	if err := os.MkdirAll(directory, 0700); err != nil {
		return "", common.NewMessage("Invoice file storage is unavailable")
	}
	var token [16]byte
	if _, err := rand.Read(token[:]); err != nil {
		return "", err
	}
	name := hex.EncodeToString(token[:]) + extension
	file, err := os.OpenFile(filepath.Join(directory, name), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return "", common.NewMessage("Invoice file storage is unavailable")
	}
	_, writeErr := file.Write(content)
	closeErr := file.Close()
	if writeErr != nil || closeErr != nil {
		_ = os.Remove(filepath.Join(directory, name))
		return "", common.NewMessage("Invoice file storage is unavailable")
	}
	return "invoice-file:" + name, nil
}

func ReadInvoiceFile(reference string, requestID int) (*common.EmailAttachment, error) {
	match := invoiceFilePattern.FindStringSubmatch(reference)
	if match == nil {
		return nil, common.NewMessage("Invoice file is not available")
	}
	root, err := os.OpenRoot(invoiceStorageDirectory())
	if err != nil {
		return nil, common.NewMessage("Invoice file is not available")
	}
	defer root.Close()
	file, err := root.Open(match[1])
	if err != nil {
		return nil, common.NewMessage("Invoice file is not available")
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() > MaxInvoiceFileSize {
		return nil, common.NewMessage("Invoice file is not available")
	}
	content, err := io.ReadAll(io.LimitReader(file, MaxInvoiceFileSize+1))
	if err != nil || len(content) > MaxInvoiceFileSize {
		return nil, common.NewMessage("Failed to read invoice file")
	}
	return &common.EmailAttachment{Filename: fmt.Sprintf("invoice-%d.%s", requestID, match[2]), Content: content, ContentType: http.DetectContentType(content)}, nil
}

func RemoveInvoiceFile(reference string) {
	match := invoiceFilePattern.FindStringSubmatch(reference)
	if match == nil {
		return
	}
	if err := os.Remove(filepath.Join(invoiceStorageDirectory(), match[1])); err != nil && !os.IsNotExist(err) {
		common.SysError(common.LogText("Failed to remove an unused invoice file"))
	}
}

func SendInvoiceEmail(request *model.InvoiceRequest) error {
	if request.Status != model.InvoiceRequestIssued || request.InvoiceURL == "" {
		return common.NewMessage("Only issued invoices with a file or link can be emailed")
	}
	address, err := mail.ParseAddress(request.Email)
	if err != nil || address.Address != request.Email || len(request.Email) > 254 {
		return common.NewMessage("Invoice email address is invalid")
	}
	content, err := renderInvoiceEmail(request, false)
	if err != nil {
		return err
	}
	var attachments []common.EmailAttachment
	if strings.HasPrefix(request.InvoiceURL, "invoice-file:") {
		file, err := ReadInvoiceFile(request.InvoiceURL, request.Id)
		if err != nil {
			return err
		}
		attachments = append(attachments, *file)
	} else if strings.HasPrefix(request.InvoiceURL, "https://") {
		// The template includes the validated HTTPS link.
	} else {
		return common.NewMessage("Invoice file is not available")
	}
	// The destination is the validated email on the committed application, never a request override.
	if err := common.SendEmail(content.Subject, request.Email, content.HTML, attachments...); err != nil {
		return common.NewMessage("Invoice email could not be sent. Please try again later")
	}
	return nil
}

func NotifyInvoiceAdministrators(request *model.InvoiceRequest) {
	settings, err := model.GetInvoiceNotificationSettings()
	if err != nil {
		common.SysError(common.LogText("Failed to load invoice notification settings"))
		return
	}
	if len(settings.UserIDs) == 0 {
		return
	}
	var users []model.User
	if err := model.DB.Select("id", "email", "setting").Where("id IN ? AND role >= ? AND status = ?", settings.UserIDs, common.RoleAdminUser, common.UserStatusEnabled).Find(&users).Error; err != nil {
		common.SysError(common.LogText("Failed to query invoice notification recipients"))
		return
	}
	for _, user := range users {
		setting := user.GetSetting()
		values := map[string]any{"ID": request.Id, "UserID": request.UserId, "Title": html.EscapeString(request.Title), "URL": html.EscapeString(strings.TrimRight(system_setting.ServerAddress, "/") + "/invoice-requests")}
		content := i18n.Translate("zh-CN", "invoice.notify_body", values)
		subject := i18n.Translate("zh-CN", "invoice.notify_subject", nil)
		if setting.NotifyType == "" || setting.NotifyType == dto.NotifyTypeEmail {
			rendered, err := renderInvoiceEmail(request, true)
			if err != nil {
				common.SysError(common.LogText("Failed to render invoice application %d notification", request.Id))
				continue
			}
			content, subject = rendered.HTML, rendered.Subject
		}
		data := dto.NewNotify("invoice_application", subject, content, nil)
		if err := NotifyUser(user.Id, user.Email, setting, data); err != nil {
			common.SysError(common.LogText("Failed to deliver invoice application %d notification to administrator %d", request.Id, user.Id))
		}
	}
}
