package model

import (
	"encoding/base64"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestParseCustomMenuPages(t *testing.T) {
	raw := `[{"id":"page_12345678","name":"帮助中心","url":"https://example.com/help","visibility":"public","icon":"data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHBhdGggZD0iTTEgMWgyMnYyMkgxeiIvPjwvc3ZnPg=="}]`
	pages, err := ParseCustomMenuPages(raw)
	if err != nil {
		t.Fatalf("ParseCustomMenuPages() error = %v", err)
	}
	if len(pages) != 1 || pages[0].Name != "帮助中心" {
		t.Fatalf("unexpected pages: %#v", pages)
	}
	if pages[0].OpenMode != CustomMenuOpenModeIframe {
		t.Fatalf("legacy page should default to iframe: %#v", pages[0])
	}
}

func TestParseCustomMenuPagesPreservesExternalOpenMode(t *testing.T) {
	raw := `[{"id":"page_external","name":"外部文档","url":"https://example.com/docs","visibility":"public","openMode":"external"}]`
	pages, err := ParseCustomMenuPages(raw)
	if err != nil {
		t.Fatalf("ParseCustomMenuPages() error = %v", err)
	}
	if len(pages) != 1 || pages[0].OpenMode != CustomMenuOpenModeExternal {
		t.Fatalf("external open mode should be preserved: %#v", pages)
	}
}

func TestParseCustomMenuPagesRejectsUnknownOpenMode(t *testing.T) {
	raw := `[{"id":"page_external","name":"外部文档","url":"https://example.com/docs","visibility":"public","openMode":"popup"}]`
	if _, err := ParseCustomMenuPages(raw); err == nil {
		t.Fatal("expected unknown open mode to be rejected")
	}
}

func TestParseCustomMenuPagesTreatsMissingEnabledAsEnabled(t *testing.T) {
	raw := `[{"id":"page_12345678","name":"帮助中心","url":"https://example.com/help","visibility":"public"}]`
	pages, err := ParseCustomMenuPages(raw)
	if err != nil {
		t.Fatalf("ParseCustomMenuPages() error = %v", err)
	}
	if len(pages) != 1 || !pages[0].IsEnabled() {
		t.Fatalf("legacy page should remain enabled: %#v", pages)
	}
}

func TestParseCustomMenuPagesPreservesDisabledState(t *testing.T) {
	raw := `[{"id":"page_12345678","name":"帮助中心","url":"https://example.com/help","visibility":"public","enabled":false}]`
	pages, err := ParseCustomMenuPages(raw)
	if err != nil {
		t.Fatalf("ParseCustomMenuPages() error = %v", err)
	}
	if len(pages) != 1 || pages[0].IsEnabled() {
		t.Fatalf("disabled page should remain disabled: %#v", pages)
	}
}

func TestParseCustomMenuPagesRejectsUnsafeURL(t *testing.T) {
	raw := `[{"id":"page_12345678","name":"坏地址","url":"javascript:alert(1)","visibility":"public"}]`
	if _, err := ParseCustomMenuPages(raw); err == nil {
		t.Fatal("expected unsafe URL to be rejected")
	}
}

func TestParseCustomMenuPagesRejectsUnknownVisibility(t *testing.T) {
	raw := `[{"id":"page_12345678","name":"帮助中心","url":"https://example.com/help","visibility":"personal"}]`
	if _, err := ParseCustomMenuPages(raw); err == nil {
		t.Fatal("expected unknown visibility to be rejected")
	}
}

func TestParseCustomMenuPagesRejectsUnsafeSVG(t *testing.T) {
	raw := `[{"id":"page_12345678","name":"帮助中心","url":"https://example.com/help","visibility":"public","icon":"data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9XCJhbGVydCgxKVwiPjwvc3ZnPg=="}]`
	if _, err := ParseCustomMenuPages(raw); err == nil {
		t.Fatal("expected unsafe SVG to be rejected")
	}
}

func TestParseCustomMenuPagesIcons(t *testing.T) {
	for _, tc := range []struct {
		name  string
		icon  string
		valid bool
	}{
		{"https URL with query", "https://api.iconify.design/lucide/image-plus.svg?color=%23a1a1aa", true},
		{"http URL", "http://example.com/icon.png", true},
		{"trim URL", "  https://example.com/icon.svg  ", true},
		{"empty icon", "", true},
		{"uploaded SVG", "data:image/svg+xml;base64," + base64.StdEncoding.EncodeToString([]byte(`<svg xmlns="http://www.w3.org/2000/svg"/>`)), true},
		{"relative URL", "/icon.svg", false},
		{"protocol relative URL", "//example.com/icon.svg", false},
		{"missing host", "https:///icon.svg", false},
		{"script URL", "javascript:alert(1)", false},
		{"file URL", "file:///icon.svg", false},
		{"HTML data URL", "data:text/html;base64,PHNjcmlwdD4=", false},
		{"invalid base64", "data:image/svg+xml;base64,invalid", false},
		{"unsafe SVG", "data:image/svg+xml;base64," + base64.StdEncoding.EncodeToString([]byte(`<svg><script>alert(1)</script></svg>`)), false},
		{"oversized URL", "https://example.com/" + strings.Repeat("a", 32*1024), false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			raw, err := common.Marshal([]CustomMenuPage{{ID: "page_icons01", Name: "Help", URL: "https://example.com/help", Visibility: CustomMenuVisibilityPublic, Icon: tc.icon}})
			require.NoError(t, err)
			pages, err := ParseCustomMenuPages(string(raw))
			if !tc.valid {
				require.Error(t, err)
				return
			}
			require.NoError(t, err)
			require.Len(t, pages, 1)
			assert.Equal(t, strings.TrimSpace(tc.icon), pages[0].Icon)
		})
	}
}
