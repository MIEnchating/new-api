package common

import (
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// SessionCookieSameSite allows top-level OAuth callbacks to carry the login
// session while still excluding cookies from cross-site subrequests and POSTs.
const SessionCookieSameSite http.SameSite = http.SameSiteLaxMode

func InitSessionCookieSettings() error {
	secureRaw := strings.TrimSpace(os.Getenv("SESSION_COOKIE_SECURE"))
	trustedURLsRaw := strings.TrimSpace(os.Getenv("SESSION_COOKIE_TRUSTED_URL"))
	domainRaw := strings.TrimSpace(os.Getenv("SESSION_COOKIE_DOMAIN"))

	SessionCookieSecure = false
	SessionCookieTrustedURLs = nil
	SessionCookieDomain = ""

	if secureRaw == "" || strings.EqualFold(secureRaw, "false") {
		if trustedURLsRaw != "" {
			return fmt.Errorf("SESSION_COOKIE_TRUSTED_URL requires SESSION_COOKIE_SECURE=true")
		}
		if domainRaw != "" {
			return fmt.Errorf("SESSION_COOKIE_DOMAIN requires SESSION_COOKIE_SECURE=true")
		}
		return nil
	}

	if !strings.EqualFold(secureRaw, "true") {
		return fmt.Errorf("SESSION_COOKIE_SECURE must be true or false")
	}

	if trustedURLsRaw == "" {
		return fmt.Errorf("SESSION_COOKIE_SECURE=true requires SESSION_COOKIE_TRUSTED_URL")
	}

	domain := strings.ToLower(strings.TrimPrefix(domainRaw, "."))
	if domainRaw != "" && !isValidCookieDomain(domain) {
		return fmt.Errorf("SESSION_COOKIE_DOMAIN must be a valid parent domain without scheme or port")
	}

	trustedURLs := strings.Split(trustedURLsRaw, ",")
	seenTrustedURLs := make(map[string]struct{}, len(trustedURLs))
	for _, trustedURL := range trustedURLs {
		trustedURL = strings.TrimSpace(trustedURL)
		if trustedURL == "" {
			return fmt.Errorf("SESSION_COOKIE_TRUSTED_URL contains an empty URL")
		}
		parsedURL, err := url.Parse(trustedURL)
		if err != nil {
			return fmt.Errorf("invalid SESSION_COOKIE_TRUSTED_URL: %w", err)
		}
		if parsedURL.Scheme != "https" || parsedURL.Host == "" || parsedURL.User != nil || (parsedURL.Path != "" && parsedURL.Path != "/") || parsedURL.RawQuery != "" || parsedURL.Fragment != "" {
			return fmt.Errorf("SESSION_COOKIE_TRUSTED_URL must contain only HTTPS origins without paths, queries, or fragments")
		}
		hostname := strings.ToLower(parsedURL.Hostname())
		if domain != "" && hostname != domain && !strings.HasSuffix(hostname, "."+domain) {
			return fmt.Errorf("SESSION_COOKIE_TRUSTED_URL host %s is outside SESSION_COOKIE_DOMAIN", hostname)
		}
		normalizedURL := "https://" + strings.ToLower(parsedURL.Host)
		if _, exists := seenTrustedURLs[normalizedURL]; exists {
			continue
		}
		seenTrustedURLs[normalizedURL] = struct{}{}
		SessionCookieTrustedURLs = append(SessionCookieTrustedURLs, normalizedURL)
	}

	SessionCookieSecure = true
	SessionCookieDomain = domain
	return nil
}

func isValidCookieDomain(domain string) bool {
	if domain == "" || len(domain) > 253 || net.ParseIP(domain) != nil || !strings.Contains(domain, ".") {
		return false
	}
	for _, label := range strings.Split(domain, ".") {
		if label == "" || len(label) > 63 || label[0] == '-' || label[len(label)-1] == '-' {
			return false
		}
		for _, char := range label {
			if (char < 'a' || char > 'z') && (char < '0' || char > '9') && char != '-' {
				return false
			}
		}
	}
	return true
}

func SessionDomainForHost(hostPort string) string {
	if SessionCookieDomain == "" {
		return ""
	}
	host := normalizeSessionCookieHost(hostPort)
	if host == SessionCookieDomain || strings.HasSuffix(host, "."+SessionCookieDomain) {
		return SessionCookieDomain
	}
	return ""
}

func normalizeSessionCookieHost(hostPort string) string {
	host := strings.ToLower(strings.TrimSuffix(hostPort, "."))
	if parsedHost, _, err := net.SplitHostPort(hostPort); err == nil {
		host = strings.ToLower(strings.TrimSuffix(parsedHost, "."))
	}
	return host
}

// ClearLegacyHostOnlySessionCookie removes the host-only cookie used before
// shared-domain sessions were enabled. Browsers may otherwise send both
// cookies with the same name, causing the server to read stale session data.
func ClearLegacyHostOnlySessionCookie(c *gin.Context) {
	domain := SessionDomainForHost(c.Request.Host)
	if domain == "" || normalizeSessionCookieHost(c.Request.Host) == domain {
		return
	}

	http.SetCookie(c.Writer, &http.Cookie{
		Name:     "session",
		Value:    "",
		Path:     "/",
		Expires:  time.Unix(1, 0).UTC(),
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   SessionCookieSecure,
		SameSite: SessionCookieSameSite,
	})
}

// ClearDuplicateLegacySessionCookie removes a stale host-only session cookie
// when the browser sends it together with the shared-domain session cookie.
// The deletion cookie has no Domain attribute, so the shared cookie remains.
func ClearDuplicateLegacySessionCookie(c *gin.Context) {
	sessionCookieCount := 0
	for _, cookie := range c.Request.Cookies() {
		if cookie.Name == "session" {
			sessionCookieCount++
		}
	}
	if sessionCookieCount < 2 {
		return
	}

	ClearLegacyHostOnlySessionCookie(c)
}
