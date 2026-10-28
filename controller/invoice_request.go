package controller

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/bytedance/gopkg/util/gopool"
	"github.com/gin-gonic/gin"
)

func CreateInvoiceRequest(c *gin.Context) {
	var input model.InvoiceApplicationInput
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 32*1024)
	if c.ShouldBindJSON(&input) != nil {
		common.ApiError(c, model.ErrInvoiceRequestInput)
		return
	}
	request, err := model.CreateInvoiceRequest(c.GetInt("id"), input)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	recordManageAuditFor(c, request.UserId, "invoice.apply", map[string]any{"request_id": request.Id, "order_count": len(request.Orders)})
	gopool.Go(func() { service.NotifyInvoiceAdministrators(request) })
	common.ApiSuccess(c, request)
}

func GetInvoiceEligibleOrders(c *gin.Context) {
	page := common.GetPageQuery(c)
	var filter model.InvoiceSearch
	if c.ShouldBindQuery(&filter) != nil {
		common.ApiError(c, model.ErrInvoiceRequestInput)
		return
	}
	if err := model.GetInvoiceEligibleOrders(c.GetInt("id"), page, filter); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, page)
}

func GetSelfInvoiceRequests(c *gin.Context) {
	page := common.GetPageQuery(c)
	var filter model.InvoiceSearch
	if c.ShouldBindQuery(&filter) != nil {
		common.ApiError(c, model.ErrInvoiceRequestInput)
		return
	}
	if err := model.ListInvoiceRequests(c.GetInt("id"), c.Query("status"), page, filter); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, page)
}

func WithdrawInvoiceRequest(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiError(c, model.ErrInvoiceRequestProcessed)
		return
	}
	request, err := model.WithdrawInvoiceRequest(id, c.GetInt("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	recordManageAuditFor(c, request.UserId, "invoice.withdrawn", map[string]any{"request_id": request.Id, "order_count": len(request.Orders)})
	common.ApiSuccess(c, request)
}

func GetAllInvoiceRequests(c *gin.Context) {
	page := common.GetPageQuery(c)
	var filter model.InvoiceSearch
	if c.ShouldBindQuery(&filter) != nil {
		common.ApiError(c, model.ErrInvoiceRequestInput)
		return
	}
	if err := model.ListInvoiceRequests(0, c.Query("status"), page, filter); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, page)
}

func ProcessInvoiceRequest(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	var input struct {
		model.InvoiceProcessInput
		SendEmail *bool `json:"send_email"`
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16*1024)
	if err != nil || id <= 0 || c.ShouldBindJSON(&input) != nil {
		common.ApiError(c, model.ErrInvoiceRequestInput)
		return
	}
	sendEmail := input.Status == model.InvoiceRequestIssued && (input.SendEmail == nil || *input.SendEmail)
	if sendEmail && strings.TrimSpace(input.InvoiceURL) == "" {
		existing, err := model.GetInvoiceForDelivery(id, c.GetInt("id"), true)
		if err != nil || existing.InvoiceURL == "" {
			common.ApiError(c, common.NewMessage("Upload an invoice or provide a link before sending email"))
			return
		}
	}
	request, err := model.ProcessInvoiceRequest(id, c.GetInt("id"), input.InvoiceProcessInput)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	recordManageAuditFor(c, request.UserId, "invoice."+request.Status, map[string]any{"request_id": request.Id, "order_count": len(request.Orders)})
	emailSent, emailFailed := false, false
	if sendEmail {
		if err := service.SendInvoiceEmail(request); err != nil {
			emailFailed = true
		} else {
			emailSent = true
			recordManageAuditFor(c, request.UserId, "invoice.email", map[string]any{"request_id": request.Id})
		}
	}
	common.ApiSuccess(c, struct {
		*model.InvoiceRequest
		EmailSent   bool `json:"email_sent"`
		EmailFailed bool `json:"email_failed"`
	}{request, emailSent, emailFailed})
}
