package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
)

func TestPaginationBoundsRejectsClampedPage(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(PaginationBounds())
	router.GET("/items", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})

	request := httptest.NewRequest(http.MethodGet, "/items?p=10002&page_size=100", nil)
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)

	assert.Equal(t, http.StatusBadRequest, recorder.Code)
}

func TestPaginationBoundsKeepsNormalAndLegacyPages(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(PaginationBounds())
	router.GET("/items", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})

	for _, query := range []string{"p=10000&page_size=100", "p=0&page_size=100", "p=invalid&page_size=100"} {
		request := httptest.NewRequest(http.MethodGet, "/items?"+query, nil)
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, request)
		assert.Equal(t, http.StatusOK, recorder.Code, query)
	}
}
