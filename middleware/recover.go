package middleware

import (
	"fmt"
	"net/http"

	"github.com/QuantumNous/new-api/common"
	"github.com/gin-gonic/gin"
)

// PanicRecover is the server-wide panic recovery. Gin logs the panic stack
// through common.ErrorLogWriter so it reaches the current log file.
func PanicRecover() gin.HandlerFunc {
	return gin.CustomRecoveryWithWriter(common.ErrorLogWriter, func(c *gin.Context, err any) {
		common.SysLog(common.LogText("panic detected: %v", err))
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": gin.H{
				"message": fmt.Sprintf("Panic detected, error: %v. Please submit a issue here: https://github.com/Calcium-Ion/new-api", err),
				"type":    "new_api_panic",
			},
		})
	})
}
