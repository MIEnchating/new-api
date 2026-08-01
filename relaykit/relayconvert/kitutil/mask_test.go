package kitutil

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestMaskSensitiveInfoMasksAuthorizationCredentials(t *testing.T) {
	tests := []struct {
		name  string
		input string
	}{
		{name: "bearer header", input: "Authorization: Bearer sk-secret-token"},
		{name: "lowercase header", input: "authorization: bearer sk-secret-token"},
		{name: "json-like header", input: `"Authorization": "Bearer sk-secret-token"`},
		{name: "basic header", input: "Authorization=Basic dXNlcjpwYXNzd29yZA=="},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			masked := MaskSensitiveInfo(tt.input)
			require.NotContains(t, masked, "secret")
			require.NotContains(t, masked, "dXNlcjpwYXNzd29yZA")
			require.Contains(t, masked, "***")
		})
	}
}
