package model

import "testing"

func TestParseCustomMenuPages(t *testing.T) {
	raw := `[{"id":"page_12345678","name":"帮助中心","url":"https://example.com/help","visibility":"public","icon":"data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHBhdGggZD0iTTEgMWgyMnYyMkgxeiIvPjwvc3ZnPg=="}]`
	pages, err := ParseCustomMenuPages(raw)
	if err != nil {
		t.Fatalf("ParseCustomMenuPages() error = %v", err)
	}
	if len(pages) != 1 || pages[0].Name != "帮助中心" {
		t.Fatalf("unexpected pages: %#v", pages)
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
