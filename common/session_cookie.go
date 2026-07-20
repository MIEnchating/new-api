package common

import (
	"fmt"
	"net"
	"net/url"
	"os"
	"strings"
)

// NormalizeOrigin validates and canonicalizes a browser origin. Only an exact
// scheme/host/effective-port match is meaningful; paths and wildcards are not
// accepted for authentication cookie endpoints.
func NormalizeOrigin(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" || raw == "null" || strings.ContainsAny(raw, "\r\n") {
		return "", fmt.Errorf("origin is empty or invalid")
	}
	parsedURL, err := url.Parse(raw)
	if err != nil {
		return "", fmt.Errorf("invalid origin: %w", err)
	}
	if parsedURL.Scheme != "http" && parsedURL.Scheme != "https" {
		return "", fmt.Errorf("origin scheme must be http or https")
	}
	if parsedURL.Host == "" || parsedURL.User != nil || parsedURL.RawQuery != "" || parsedURL.Fragment != "" || (parsedURL.Path != "" && parsedURL.Path != "/") {
		return "", fmt.Errorf("origin must contain only scheme and host")
	}
	hostname := strings.ToLower(parsedURL.Hostname())
	if hostname == "" || strings.Contains(hostname, "*") {
		return "", fmt.Errorf("origin host is empty")
	}
	port := parsedURL.Port()
	normalizedHost := hostname
	if strings.Contains(hostname, ":") {
		normalizedHost = "[" + hostname + "]"
	}
	if port == "" || (parsedURL.Scheme == "http" && port == "80") || (parsedURL.Scheme == "https" && port == "443") {
		return parsedURL.Scheme + "://" + normalizedHost, nil
	}
	return parsedURL.Scheme + "://" + net.JoinHostPort(hostname, port), nil
}

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
		normalizedOrigin, err := NormalizeOrigin(trustedURL)
		if err != nil {
			return fmt.Errorf("invalid SESSION_COOKIE_TRUSTED_URL: %w", err)
		}
		if !strings.HasPrefix(normalizedOrigin, "https://") {
			return fmt.Errorf("SESSION_COOKIE_TRUSTED_URL must contain only https URLs with hosts")
		}
		parsedOrigin, err := url.Parse(normalizedOrigin)
		if err != nil {
			return fmt.Errorf("invalid SESSION_COOKIE_TRUSTED_URL: %w", err)
		}
		hostname := strings.ToLower(parsedOrigin.Hostname())
		if domain != "" && hostname != domain && !strings.HasSuffix(hostname, "."+domain) {
			return fmt.Errorf("SESSION_COOKIE_TRUSTED_URL host %s is outside SESSION_COOKIE_DOMAIN", hostname)
		}
		if _, exists := seenTrustedURLs[normalizedOrigin]; exists {
			continue
		}
		seenTrustedURLs[normalizedOrigin] = struct{}{}
		SessionCookieTrustedURLs = append(SessionCookieTrustedURLs, normalizedOrigin)
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
	host := strings.ToLower(strings.TrimSuffix(hostPort, "."))
	if parsedHost, _, err := net.SplitHostPort(hostPort); err == nil {
		host = strings.ToLower(strings.TrimSuffix(parsedHost, "."))
	}
	if host == SessionCookieDomain || strings.HasSuffix(host, "."+SessionCookieDomain) {
		return SessionCookieDomain
	}
	return ""
}
