package main

import (
	"net/http"
	"testing"
	"time"
)

func TestNewHTTPServerBoundsReadSideWithoutWriteDeadline(t *testing.T) {
	server := newHTTPServer("3000", http.NotFoundHandler())

	if server.ReadHeaderTimeout != 15*time.Second {
		t.Fatalf("ReadHeaderTimeout = %s, want 15s", server.ReadHeaderTimeout)
	}
	if server.ReadTimeout != 0 {
		t.Fatalf("ReadTimeout = %s, want 0 for slow or large request bodies", server.ReadTimeout)
	}
	if server.IdleTimeout != 2*time.Minute {
		t.Fatalf("IdleTimeout = %s, want 2m", server.IdleTimeout)
	}
	if server.MaxHeaderBytes != 256<<10 {
		t.Fatalf("MaxHeaderBytes = %d, want %d", server.MaxHeaderBytes, 256<<10)
	}
	if server.WriteTimeout != 0 {
		t.Fatalf("WriteTimeout = %s, want 0 for streaming responses", server.WriteTimeout)
	}
}
