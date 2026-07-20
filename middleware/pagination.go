package middleware

import (
	"net/http"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/gin-gonic/gin"
)

// PaginationBounds rejects a numerically valid page that the common paginator
// would have to clamp. Returning 400 is preferable to silently serving the
// last page repeatedly when a client requests an out-of-range page.
//
// Non-numeric and non-positive p values retain the paginator's legacy default
// behavior. The middleware only handles the overflow/large-offset case.
func PaginationBounds() gin.HandlerFunc {
	return func(c *gin.Context) {
		rawPage := c.Query("p")
		if rawPage != "" {
			if page, err := strconv.Atoi(rawPage); err == nil && page > 0 {
				normalized := common.GetPageQuery(c)
				if page != normalized.GetPage() {
					c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{
						"success": false,
						"message": "page exceeds the maximum supported offset",
					})
					return
				}
			}
		}
		c.Next()
	}
}
