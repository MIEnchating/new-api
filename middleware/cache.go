package middleware

import (
	"path"
	"regexp"
	"strings"

	"github.com/gin-gonic/gin"
)

const (
	noStoreCacheControl   = "no-store, no-cache, must-revalidate, max-age=0"
	immutableCacheControl = "public, max-age=31536000, immutable"
	shortCacheControl     = "public, max-age=3600, must-revalidate"
	cacheVersion          = "b688f2fb5be447c25e5aa3bd063087a83db32a288bf6a4f35f2d8db310e40b14"
	contentHashPattern    = `\.[0-9a-fA-F]{8,64}(?:\.|$)`
)

var hashedAssetPattern = regexp.MustCompile(contentHashPattern)

// cacheControlForWebPath keeps mutable HTML and unhashed assets revalidating
// while allowing content-addressed build artifacts to be cached for a year.
// The URL path is used instead of RequestURI so query strings do not affect the
// classification.
func cacheControlForWebPath(requestPath string) string {
	base := path.Base(requestPath)
	if requestPath == "/" || strings.EqualFold(path.Ext(base), ".html") {
		return noStoreCacheControl
	}
	if strings.HasPrefix(requestPath, "/static/") && hashedAssetPattern.MatchString(base) {
		return immutableCacheControl
	}
	if strings.HasPrefix(requestPath, "/static/") || path.Ext(base) != "" {
		return shortCacheControl
	}
	return noStoreCacheControl
}

func Cache() func(c *gin.Context) {
	return func(c *gin.Context) {
		cacheControl := cacheControlForWebPath(c.Request.URL.Path)
		c.Header("Cache-Control", cacheControl)
		if cacheControl == noStoreCacheControl {
			c.Header("Pragma", "no-cache")
			c.Header("Expires", "0")
		}
		c.Header("Cache-Version", cacheVersion)
		c.Next()
	}
}
