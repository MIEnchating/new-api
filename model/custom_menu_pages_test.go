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
