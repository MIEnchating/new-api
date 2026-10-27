package controller

import (
	"net/http"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
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
	common.ApiSuccess(c, request)
}

func GetInvoiceEligibleOrders(c *gin.Context) {
	page := common.GetPageQuery(c)
	if err := model.GetInvoiceEligibleOrders(c.GetInt("id"), page); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, page)
}

func GetSelfInvoiceRequests(c *gin.Context) {
	page := common.GetPageQuery(c)
	if err := model.ListInvoiceRequests(c.GetInt("id"), c.Query("status"), page); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, page)
}

func GetAllInvoiceRequests(c *gin.Context) {
	page := common.GetPageQuery(c)
	if err := model.ListInvoiceRequests(0, c.Query("status"), page); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, page)
}

func ProcessInvoiceRequest(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	var input model.InvoiceProcessInput
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16*1024)
	if err != nil || id <= 0 || c.ShouldBindJSON(&input) != nil {
		common.ApiError(c, model.ErrInvoiceRequestInput)
		return
	}
	request, err := model.ProcessInvoiceRequest(id, c.GetInt("id"), input)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	recordManageAuditFor(c, request.UserId, "invoice."+request.Status, map[string]any{"request_id": request.Id, "order_count": len(request.Orders)})
	common.ApiSuccess(c, request)
}
