package router

import (
	"fmt"
	"net/http"
	"os"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/controller"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/pkg/qqbot"

	"github.com/gin-gonic/gin"
)

func SetRouter(router *gin.Engine, assets WebAssets, bot *qqbot.Runtime) {
	SetApiRouter(router)
	if bot != nil {
		bot.AttachGateway(router)
		setQQBotRoutes(router, bot)
	}
	SetDashboardRouter(router)
	SetRelayRouter(router)
	SetTaskPluginProtocolRouter(router)
	SetVideoRouter(router)
	SetTaskRouter(router)
	pluginDispatcher := SetPluginRouter(router)
	frontendBaseUrl := os.Getenv("FRONTEND_BASE_URL")
	if common.IsMasterNode && frontendBaseUrl != "" {
		frontendBaseUrl = ""
		common.SysLog(common.LogText("FRONTEND_BASE_URL is ignored on master node"))
	}
	if frontendBaseUrl == "" {
		SetWebRouter(router, assets, pluginDispatcher)
	} else {
		frontendBaseUrl = strings.TrimSuffix(frontendBaseUrl, "/")
		router.NoRoute(
			pluginDispatcher,
			middleware.RouteTag("web"),
			middleware.AccessTokenAudit(),
			func(c *gin.Context) {
				c.Redirect(http.StatusMovedPermanently, fmt.Sprintf("%s%s", frontendBaseUrl, c.Request.RequestURI))
			},
		)
	}
}

func setQQBotRoutes(router *gin.Engine, bot *qqbot.Runtime) {
	router.POST(qqbot.WebhookPath, middleware.RouteTag("api"), middleware.GlobalAPIRateLimit(), gin.WrapH(bot))
	settings := controller.QQBotSettings{Runtime: bot}
	group := router.Group("/api/option/qqbot", middleware.RouteTag("api"), middleware.GlobalAPIRateLimit(), middleware.AccessTokenAudit(), middleware.RootAuth(), middleware.DisableCache())
	group.GET("", settings.Get)
	group.GET("/chat-options", settings.ChatOptions)
	group.GET("/discovered-groups", settings.DiscoveredGroups)
	group.POST("/external-models", middleware.UserCriticalRateLimit("qq-bot-external-models"), settings.ExternalModels)
	group.PUT("", middleware.UserCriticalRateLimit("qq-bot-settings"), settings.Update)

	binding := controller.QQBotBinding{Runtime: bot}
	self := router.Group("/api/user/qqbot", middleware.RouteTag("api"), middleware.GlobalAPIRateLimit(), middleware.AccessTokenAudit(), middleware.UserAuth(), middleware.DisableCache())
	self.GET("", binding.Get)
	self.POST("", middleware.UserCriticalRateLimit("qq-bot-binding"), binding.Bind)
	self.DELETE("", middleware.UserCriticalRateLimit("qq-bot-binding"), binding.Unbind)
}
