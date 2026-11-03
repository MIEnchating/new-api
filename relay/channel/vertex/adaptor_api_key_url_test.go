package vertex

import (
	"testing"

	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGetRequestURLWithAPIKey(t *testing.T) {
	tests := []struct {
		name      string
		projectID string
		baseURL   string
		version   string
		region    string
		stream    bool
		want      string
	}{
		{
			name:    "beta switch replaces the saved stable version and preserves proxy prefix",
			baseURL: "https://proxy.example/vertex/v1/", version: "v1beta1", region: `{"default":"global"}`,
			want: "https://proxy.example/vertex/v1beta1/publishers/google/models/gemini-4-argon:generateContent?key=test-key",
		},
		{
			name:    "stable switch replaces a saved beta version",
			baseURL: "https://proxy.example/v1beta1", version: "v1", region: `{"default":"global"}`,
			want: "https://proxy.example/v1/publishers/google/models/gemini-4-argon:generateContent?key=test-key",
		},
		{
			name:      "beta endpoint preserves project and global region",
			projectID: "my-project", version: "v1beta1", region: `{"default":"global"}`,
			want: "https://aiplatform.googleapis.com/v1beta1/projects/my-project/locations/global/publishers/google/models/gemini-4-argon:generateContent?key=test-key",
		},
		{
			name:    "beta endpoint preserves express streaming",
			version: "v1beta1", region: `{"default":"global"}`, stream: true,
			want: "https://aiplatform.googleapis.com/v1beta1/publishers/google/models/gemini-4-argon:streamGenerateContent?alt=sse&key=test-key",
		},
		{
			name:      "project ID keeps the global region",
			projectID: "my-project",
			region:    `{"default":"global"}`,
			want:      "https://aiplatform.googleapis.com/v1/projects/my-project/locations/global/publishers/google/models/gemini-4-argon:generateContent?key=test-key",
		},
		{
			name:      "project ID keeps a regional endpoint when streaming",
			projectID: "my-project",
			region:    `{"default":"us-central1"}`,
			stream:    true,
			want:      "https://us-central1-aiplatform.googleapis.com/v1/projects/my-project/locations/us-central1/publishers/google/models/gemini-4-argon:streamGenerateContent?alt=sse&key=test-key",
		},
		{
			name:   "no project ID keeps the express-mode URL",
			region: `{"default":"global"}`,
			want:   "https://aiplatform.googleapis.com/v1/publishers/google/models/gemini-4-argon:generateContent?key=test-key",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			info := &relaycommon.RelayInfo{
				IsStream:        tt.stream,
				OriginModelName: "gemini-4-argon",
				ChannelMeta: &relaycommon.ChannelMeta{
					ApiVersion:        tt.region,
					ChannelBaseUrl:    tt.baseURL,
					ApiKey:            "test-key",
					UpstreamModelName: "gemini-4-argon",
					ChannelOtherSettings: dto.ChannelOtherSettings{
						VertexKeyType:    dto.VertexKeyTypeAPIKey,
						VertexProjectID:  tt.projectID,
						VertexAPIVersion: tt.version,
					},
				},
			}
			adaptor := &Adaptor{}
			adaptor.Init(info)

			got, err := adaptor.GetRequestURL(info)
			require.NoError(t, err)
			assert.Equal(t, tt.want, got)
		})
	}
}

func TestVertexBetaEndpointWithServiceAccount(t *testing.T) {
	for _, tc := range []struct {
		model string
		want  string
	}{
		{model: "gemini-4-argon", want: "https://aiplatform.googleapis.com/v1beta1/projects/my-project/locations/global/publishers/google/models/gemini-4-argon:generateContent"},
		{model: "imagen-4.0-generate-001", want: "https://aiplatform.googleapis.com/v1beta1/projects/my-project/locations/global/publishers/google/models/imagen-4.0-generate-001:predict"},
		{model: "claude-sonnet-4-5", want: "https://aiplatform.googleapis.com/v1/projects/my-project/locations/global/publishers/anthropic/models/claude-sonnet-4-5:rawPredict"},
	} {
		t.Run(tc.model, func(t *testing.T) {
			info := &relaycommon.RelayInfo{OriginModelName: tc.model, ChannelMeta: &relaycommon.ChannelMeta{
				ChannelBaseUrl: "https://aiplatform.googleapis.com/v1", UpstreamModelName: tc.model, ApiVersion: `{"default":"global"}`, ApiKey: `{"project_id":"my-project"}`,
				ChannelOtherSettings: dto.ChannelOtherSettings{VertexAPIVersion: "v1beta1"},
			}}
			adaptor := &Adaptor{}
			adaptor.Init(info)
			got, err := adaptor.GetRequestURL(info)
			require.NoError(t, err)
			assert.Equal(t, tc.want, got)
		})
	}
}
