package controller

import (
	"mime"
	"net/http"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

func UploadInvoiceFile(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiError(c, model.ErrInvoiceRequestInput)
		return
	}
	request, err := model.GetInvoiceForDelivery(id, c.GetInt("id"), true)
	if err != nil || request.Status == model.InvoiceRequestRejected {
		common.ApiError(c, model.ErrInvoiceRequestProcessed)
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, service.MaxInvoiceFileSize+(64<<10))
	defer func() {
		if c.Request.MultipartForm != nil {
			_ = c.Request.MultipartForm.RemoveAll()
		}
	}()
	header, err := c.FormFile("file")
	if err != nil || header.Size <= 0 || header.Size > service.MaxInvoiceFileSize {
		common.ApiError(c, common.NewMessage("Invoice file must be a PDF, PNG or JPEG up to 10 MB"))
		return
	}
	file, err := header.Open()
	if err != nil {
		common.ApiError(c, common.NewMessage("Failed to read invoice file"))
		return
	}
	defer file.Close()
	reference, err := service.StoreInvoiceFile(file)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	request, previous, err := model.AttachInvoiceFile(id, reference)
	if err != nil {
		service.RemoveInvoiceFile(reference)
		common.ApiError(c, model.ErrInvoiceRequestProcessed)
		return
	}
	service.RemoveInvoiceFile(previous)
	recordManageAuditFor(c, request.UserId, "invoice.upload", map[string]any{"request_id": id})
	common.ApiSuccess(c, gin.H{"invoice_url": request.InvoiceURL, "invoice_number": service.RecognizeInvoiceNumber(c.Request.Context(), request.InvoiceURL)})
}

func DownloadInvoiceFile(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	request, err := model.GetInvoiceForDelivery(id, c.GetInt("id"), c.GetInt("role") >= common.RoleAdminUser)
	c.Header("Cache-Control", "no-store")
	if err != nil {
		c.Status(http.StatusNotFound)
		return
	}
	file, err := service.ReadInvoiceFile(request.InvoiceURL, id)
	if err != nil {
		c.Status(http.StatusNotFound)
		return
	}
	c.Header("X-Content-Type-Options", "nosniff")
	c.Header("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": file.Filename}))
	c.Data(http.StatusOK, file.ContentType, file.Content)
}

func SendInvoiceEmail(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	request, err := model.GetInvoiceForDelivery(id, c.GetInt("id"), c.GetInt("role") >= common.RoleAdminUser)
	if err != nil {
		common.ApiError(c, common.NewMessage("Invoice file is not available"))
		return
	}
	allowed, err := service.CheckNotificationLimit(request.UserId, "invoice_email")
	if err != nil || !allowed {
		common.ApiError(c, common.NewMessage("Too many invoice email requests. Please try again later"))
		return
	}
	if err := service.SendInvoiceEmail(request); err != nil {
		common.ApiError(c, err)
		return
	}
	recordManageAuditFor(c, request.UserId, "invoice.email", map[string]any{"request_id": id})
	common.ApiSuccess(c, nil)
}

func GetInvoiceNotificationSettings(c *gin.Context) {
	settings, err := model.GetInvoiceNotificationSettings()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, settings)
}

func SetInvoiceNotificationSettings(c *gin.Context) {
	var input struct {
		UserIDs []int `json:"user_ids"`
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4096)
	if c.ShouldBindJSON(&input) != nil {
		common.ApiError(c, model.ErrInvoiceRequestInput)
		return
	}
	if err := model.SetInvoiceNotificationUsers(input.UserIDs); err != nil {
		common.ApiError(c, err)
		return
	}
	recordManageAuditFor(c, c.GetInt("id"), "invoice.notifications", map[string]any{"recipient_count": len(input.UserIDs)})
	common.ApiSuccess(c, nil)
}
