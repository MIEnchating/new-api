package service

import (
	"fmt"
	"net/url"
	"strings"

	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/gin-gonic/gin"
)

func normalizeSiteOrigin(raw string) (string, bool) {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		return "", false
	}
	if parsed.User != nil || parsed.Path != "" && parsed.Path != "/" || parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", false
	}
	parsed.Scheme = strings.ToLower(parsed.Scheme)
	parsed.Host = strings.ToLower(parsed.Host)
	parsed.Path = ""
	return parsed.String(), true
}

func NormalizeTrustedSiteOrigins(raw string) (string, error) {
	canonical, _ := normalizeSiteOrigin(system_setting.ServerAddress)
	seen := make(map[string]struct{})
	origins := make([]string, 0)
	for _, item := range strings.FieldsFunc(raw, func(r rune) bool {
		return r == ',' || r == '\n' || r == '\r'
	}) {
		origin, ok := normalizeSiteOrigin(item)
		if !ok {
			return "", fmt.Errorf("invalid trusted site origin: %s", strings.TrimSpace(item))
		}
		parsed, _ := url.Parse(origin)
		if parsed.Scheme != "https" {
			return "", fmt.Errorf("trusted site origin must use HTTPS: %s", origin)
		}
		if origin == canonical {
			continue
		}
		if _, exists := seen[origin]; exists {
			continue
		}
		seen[origin] = struct{}{}
		origins = append(origins, origin)
	}
	return strings.Join(origins, "\n"), nil
}

func trustedSiteOriginSet() map[string]struct{} {
	origins := make(map[string]struct{})
	if canonical, ok := normalizeSiteOrigin(system_setting.ServerAddress); ok {
		origins[canonical] = struct{}{}
	}
	normalized, err := NormalizeTrustedSiteOrigins(system_setting.TrustedSiteOrigins)
	if err != nil {
		return origins
	}
	for _, raw := range strings.Split(normalized, "\n") {
		if origin, ok := normalizeSiteOrigin(raw); ok {
			origins[origin] = struct{}{}
		}
	}
	return origins
}

func IsTrustedSiteOrigin(raw string) bool {
	origin, ok := normalizeSiteOrigin(raw)
	if !ok {
		return false
	}
	_, ok = trustedSiteOriginSet()[origin]
	return ok
}

func ResolveRequestSiteOrigin(c *gin.Context) string {
	scheme := "http"
	if c.Request.TLS != nil {
		scheme = "https"
	}
	if forwardedProto := strings.TrimSpace(strings.Split(c.GetHeader("X-Forwarded-Proto"), ",")[0]); forwardedProto != "" {
		scheme = strings.ToLower(forwardedProto)
	}
	candidate := scheme + "://" + c.Request.Host
	if IsTrustedSiteOrigin(candidate) {
		origin, _ := normalizeSiteOrigin(candidate)
		return origin
	}
	canonical, _ := normalizeSiteOrigin(system_setting.ServerAddress)
	return canonical
}
