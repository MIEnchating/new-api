package controller

import (
	"io"
	"net"
	"net/http"
	"net/url"
	"path"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
	"github.com/shopspring/decimal"
)

type epayRefundResponse struct {
	Code *int   `json:"code"`
	Msg  string `json:"msg"`
}

func AdminRefundTopUp(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorMsg(c, "Invalid order")
		return
	}
	topUp, err := model.StartTopUpRefund(id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if topUp.Status == model.TopUpStatusRefunded {
		common.ApiSuccess(c, gin.H{"status": topUp.Status})
		return
	}

	if topUp.Status != model.TopUpStatusRefundConfirmed {
		retryAfterFailure := false
		switch topUp.PaymentProvider {
		case model.PaymentProviderStripe:
			err = refundStripeTopUp(c, id, topUp)
		case model.PaymentProviderEpay:
			retryAfterFailure, err = refundEpayTopUp(c, topUp)
		default:
			err = model.ErrTopUpRefundUnsupported
		}
		if err != nil {
			if retryAfterFailure {
				if cancelErr := model.CancelTopUpRefund(id); cancelErr != nil {
					logger.LogError(c.Request.Context(), common.LogText("failed to release rejected Epay refund order_id=%d error=%q", id, cancelErr.Error()))
				}
			}
			common.ApiError(c, err)
			return
		}
		if err := model.ConfirmTopUpRefund(id); err != nil {
			logger.LogError(c.Request.Context(), common.LogText("payment provider refund succeeded but confirmation persistence failed order_id=%d provider=%s error=%q", id, topUp.PaymentProvider, err.Error()))
			if topUp.PaymentProvider == model.PaymentProviderEpay {
				common.ApiErrorMsg(c, "Epay refund result is unconfirmed; verify it in the payment provider dashboard")
			} else {
				common.ApiErrorMsg(c, "Refund succeeded but local quota adjustment failed; retry this action")
			}
			return
		}
	}
	if err := model.CompleteTopUpRefund(id, c.GetInt("id")); err != nil {
		logger.LogError(c.Request.Context(), common.LogText("payment provider refund succeeded but local settlement failed order_id=%d provider=%s error=%q", id, topUp.PaymentProvider, err.Error()))
		common.ApiErrorMsg(c, "Refund succeeded but local quota adjustment failed; retry this action")
		return
	}
	common.ApiSuccess(c, gin.H{"status": model.TopUpStatusRefunded})
}

func refundEpayTopUp(c *gin.Context, topUp *model.TopUp) (bool, error) {
	baseURL, err := url.Parse(strings.TrimSpace(operation_setting.PayAddress))
	if err != nil || baseURL.Host == "" || (baseURL.Scheme != "http" && baseURL.Scheme != "https") ||
		strings.TrimSpace(operation_setting.EpayId) == "" || strings.TrimSpace(operation_setting.EpayKey) == "" {
		return true, common.NewMessage("Epay is not configured")
	}
	if baseURL.Scheme != "https" && !isLoopbackEpayHost(baseURL.Hostname()) {
		return true, common.NewMessage("Epay refund endpoint must use HTTPS")
	}
	baseURL.Path = path.Join(baseURL.Path, "api.php")
	query := baseURL.Query()
	query.Set("act", "refund")
	baseURL.RawQuery = query.Encode()

	form := url.Values{
		"pid":          {operation_setting.EpayId},
		"key":          {operation_setting.EpayKey},
		"out_trade_no": {topUp.TradeNo},
		"money":        {decimal.NewFromFloat(topUp.Money).StringFixed(2)},
	}
	request, err := http.NewRequestWithContext(c.Request.Context(), http.MethodPost, baseURL.String(), strings.NewReader(form.Encode()))
	if err != nil {
		return true, common.NewMessage("Failed to submit Epay refund")
	}
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	client := &http.Client{
		Timeout: 15 * time.Second,
		CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	response, err := client.Do(request)
	if err != nil {
		logger.LogError(c.Request.Context(), common.LogText("Epay refund request failed order_id=%d error=%q", topUp.Id, err.Error()))
		return false, common.NewMessage("Epay refund result is unconfirmed; verify it in the payment provider dashboard")
	}
	defer response.Body.Close()
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		logger.LogWarn(c.Request.Context(), common.LogText("Epay refund rejected order_id=%d http_status=%d", topUp.Id, response.StatusCode))
		return false, common.NewMessage("Epay refund result is unconfirmed; verify it in the payment provider dashboard")
	}

	var result epayRefundResponse
	if err := common.DecodeJson(io.LimitReader(response.Body, 1<<20), &result); err != nil {
		logger.LogError(c.Request.Context(), common.LogText("Epay refund response invalid order_id=%d error=%q", topUp.Id, err.Error()))
		return false, common.NewMessage("Epay refund result is unconfirmed; verify it in the payment provider dashboard")
	}
	if result.Code == nil {
		return false, common.NewMessage("Epay refund result is unconfirmed; verify it in the payment provider dashboard")
	}
	if *result.Code != 0 && *result.Code != 1 {
		logger.LogWarn(c.Request.Context(), common.LogText("Epay refund rejected order_id=%d response_code=%d", topUp.Id, *result.Code))
		return true, common.NewMessage("Epay refund was rejected")
	}
	// Compatible gateways use either 0 or 1 for success. Require an explicit
	// completion message; an accepted application is not a completed refund.
	switch strings.ToLower(strings.Trim(strings.TrimSpace(result.Msg), "。.!！")) {
	case "退款成功", "success", "ok", "refund success", "refund successful", "refund succeeded":
		return false, nil
	case "退款失败", "退款不成功", "refund failed":
		return true, common.NewMessage("Epay refund was rejected")
	default:
		return false, common.NewMessage("Epay refund result is unconfirmed; verify it in the payment provider dashboard")
	}
}

func isLoopbackEpayHost(host string) bool {
	if strings.EqualFold(host, "localhost") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}
