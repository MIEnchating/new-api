package service

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestDecodeBoundedCodexJSONRejectsOversizedBody(t *testing.T) {
	body := strings.NewReader(
		`{"models":[{"slug":"` + strings.Repeat("x", codexJSONResponseMaxBytes+1),
	)
	var response struct {
		Models []struct {
			Slug string `json:"slug"`
		} `json:"models"`
	}

	err := decodeBoundedCodexJSON(body, &response)

	require.ErrorContains(t, err, "Codex response exceeds")
}

func TestDecodeBoundedCodexJSONRejectsTrailingJSON(t *testing.T) {
	var response map[string]string
	err := decodeBoundedCodexJSON(strings.NewReader(`{"status":"ok"}{"extra":"payload"}`), &response)

	require.ErrorContains(t, err, "trailing JSON")
}

func TestDecodeBoundedCodexJSONAcceptsTrailingWhitespace(t *testing.T) {
	var response map[string]string
	require.NoError(t, decodeBoundedCodexJSON(strings.NewReader("{\"status\":\"ok\"} \n\t"), &response))
	require.Equal(t, "ok", response["status"])
}
