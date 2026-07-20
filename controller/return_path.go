package controller

import (
	"net/url"
	"strings"

	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

func paymentReturnPath(c *gin.Context, suffix string) string {
	parsed, err := url.Parse(suffix)
	if err == nil {
		switch parsed.Path {
		case "/console/topup":
			parsed.Path = "/wallet"
		case "/console/log":
			parsed.Path = "/usage-logs"
		}
		suffix = parsed.String()
	}
	return strings.TrimRight(service.ResolveRequestSiteOrigin(c), "/") + suffix
}
