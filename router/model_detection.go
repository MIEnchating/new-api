package router

import (
	"net/http"

	"github.com/QuantumNous/new-api/controller"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/service"

	"github.com/gin-gonic/gin"
)

func newModelDetectionRelay() http.Handler {
	engine := gin.New()
	engine.Use(
		gin.CustomRecovery(func(c *gin.Context, _ any) { c.AbortWithStatus(http.StatusInternalServerError) }),
		middleware.RequestId(),
		middleware.BodyStorageCleanup(),
		middleware.StatsMiddleware(),
		middleware.RouteTag("relay"),
		middleware.SystemPerformanceCheck(),
		controller.ModelDetectionRelayContext,
		middleware.ModelRequestRateLimit(),
	)
	engine.POST(service.ModelDetectionChatEndpoint, middleware.Distribute(), func(c *gin.Context) {
		controller.Relay(c, types.RelayFormatOpenAI)
	})
	engine.POST(service.ModelDetectionMessagesEndpoint, middleware.Distribute(), func(c *gin.Context) {
		controller.Relay(c, types.RelayFormatClaude)
	})
	engine.POST(
		service.ModelDetectionResponsesEndpoint,
		middleware.RouteTaskPluginEndpoint(),
		middleware.PrepareTaskPluginEndpoint(),
		middleware.Distribute(),
		func(c *gin.Context) {
			controller.RelayTaskPluginEndpoint(c, func(c *gin.Context) { controller.Relay(c, types.RelayFormatOpenAIResponses) })
		},
	)
	return engine
}
