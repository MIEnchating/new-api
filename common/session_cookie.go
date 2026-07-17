package common

import (
	"fmt"
	"net"
	"net/url"
	"os"
	"strings"
)

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
	host := strings.ToLower(hostPort)
	if parsedHost, _, err := net.SplitHostPort(hostPort); err == nil {
		host = strings.ToLower(parsedHost)
	}
	if host == SessionCookieDomain || strings.HasSuffix(host, "."+SessionCookieDomain) {
		for _, trustedURL := range SessionCookieTrustedURLs {
			parsedURL, err := url.Parse(trustedURL)
			if err == nil && strings.EqualFold(parsedURL.Hostname(), host) {
				return SessionCookieDomain
			}
		}
	}
	return ""
}
