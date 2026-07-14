package controller

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestFetchOfficialProviderStatus(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"status":{"indicator":"minor","description":"Partial outage"},
			"incidents":[{
				"name":"Elevated errors",
				"status":"monitoring",
				"impact":"minor",
				"shortlink":"https://status.example/incidents/1",
				"updated_at":"2026-07-14T10:00:00Z",
				"incident_updates":[{"body":"Recovery is in progress","updated_at":"2026-07-14T10:05:00Z"}]
			}]
		}`))
	}))
	defer server.Close()

	result, err := fetchOfficialProviderStatus(context.Background(), server.Client(), officialStatusSource{
		Provider:     "Test Provider",
		SummaryURL:   server.URL,
		StatusURL:    "https://status.example",
		SubscribeURL: "https://status.example",
	})

	require.NoError(t, err)
	require.True(t, result.Available)
	require.Equal(t, "minor", result.Indicator)
	require.Equal(t, "Partial outage", result.Description)
	require.Len(t, result.Incidents, 1)
	require.Equal(t, "Recovery is in progress", result.Incidents[0].Message)
	require.Equal(t, "2026-07-14T10:05:00Z", result.Incidents[0].UpdatedAt)
}

func TestFetchOfficialProviderStatusRejectsNonSuccessResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
	}))
	defer server.Close()

	_, err := fetchOfficialProviderStatus(context.Background(), server.Client(), officialStatusSource{SummaryURL: server.URL})
	require.Error(t, err)
}

func TestCloneOfficialProviderStatusesPreservesEmptyIncidentArray(t *testing.T) {
	cloned := cloneOfficialProviderStatuses([]officialProviderStatus{{
		Provider:  "OpenAI",
		Incidents: []officialProviderIncident{},
	}})

	require.NotNil(t, cloned[0].Incidents)
	require.Empty(t, cloned[0].Incidents)
}
