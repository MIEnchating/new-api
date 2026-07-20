package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestCacheControlForWebPath(t *testing.T) {
	tests := []struct {
		name string
		path string
		want string
	}{
		{name: "root html", path: "/", want: noStoreCacheControl},
		{name: "spa route", path: "/dashboard", want: noStoreCacheControl},
		{name: "explicit html", path: "/index.html", want: noStoreCacheControl},
		{name: "hashed javascript", path: "/static/js/index.2352d2b0b6.js", want: immutableCacheControl},
		{name: "hashed stylesheet", path: "/static/css/index.f512ec63ec.css", want: immutableCacheControl},
		{name: "unhashed static asset", path: "/static/css/index.css", want: shortCacheControl},
		{name: "root logo", path: "/logo.png", want: shortCacheControl},
		{name: "root favicon", path: "/favicon.ico", want: shortCacheControl},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := cacheControlForWebPath(tt.path); got != tt.want {
				t.Fatalf("cacheControlForWebPath(%q) = %q, want %q", tt.path, got, tt.want)
			}
		})
	}
}

func TestCacheMiddlewareUsesURLPathForAssetClassification(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(Cache())
	router.GET("/static/js/index.2352d2b0b6.js", func(c *gin.Context) {
		c.Status(http.StatusNoContent)
	})

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/static/js/index.2352d2b0b6.js?v=1", nil)
	router.ServeHTTP(recorder, request)

	if got := recorder.Header().Get("Cache-Control"); got != immutableCacheControl {
		t.Fatalf("Cache-Control = %q, want %q", got, immutableCacheControl)
	}
}
