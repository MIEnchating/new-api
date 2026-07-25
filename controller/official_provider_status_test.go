package controller

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestFetchOfficialProviderStatus(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"status":{"indicator":"minor","description":"Partial outage"},
			"components":[
				{"id":"api","name":"API","status":"degraded_performance","updated_at":"2026-07-14T10:04:00Z","group":false,"group_id":"api-products"},
				{"id":"api-products","name":"API products","status":"degraded_performance","updated_at":"2026-07-14T10:04:00Z","group":true,"group_id":null}
			],
			"incidents":[{
				"name":"Elevated errors",
				"status":"monitoring",
				"impact":"minor",
				"shortlink":"https://status.example/incidents/1",
				"updated_at":"2026-07-14T10:00:00Z",
				"components":[{"id":"api","name":"API","status":"major_outage","group":false,"group_id":"api-products"}],
				"incident_updates":[
					{
						"body":"Investigating",
						"updated_at":"2026-07-14T10:01:00Z",
						"affected_components":[{"id":"api","name":"API","status":"major_outage","group":false,"group_id":"api-products"}]
					},
					{
						"body":"Recovery is in progress",
						"updated_at":"2026-07-14T10:05:00Z",
						"affected_components":[{"id":"api","name":"API","status":"degraded_performance","group":false,"group_id":"api-products"}]
					}
				]
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
	require.Len(t, result.Components, 2)
	require.Equal(t, "API", result.Components[0].Name)
	require.Equal(t, "degraded_performance", result.Components[0].Status)
	require.False(t, result.Components[0].Group)
	require.Equal(t, "api-products", result.Components[0].GroupID)
	require.True(t, result.Components[1].Group)
	require.Len(t, result.Incidents, 1)
	require.Equal(t, "Recovery is in progress", result.Incidents[0].Message)
	require.Equal(t, "2026-07-14T10:05:00Z", result.Incidents[0].UpdatedAt)
	require.Len(t, result.Incidents[0].Components, 1)
	require.Equal(t, "API", result.Incidents[0].Components[0].Name)
	require.Equal(t, "degraded_performance", result.Incidents[0].Components[0].Status)
	require.Equal(t, "api-products", result.Incidents[0].Components[0].GroupID)
}

func TestFetchOfficialProviderStatusClassifiesHTTPStatusWithoutLeakingBody(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
		_, _ = w.Write([]byte(`secret upstream response`))
	}))
	defer server.Close()

	_, err := fetchOfficialProviderStatus(context.Background(), server.Client(), officialStatusSource{SummaryURL: server.URL})
	errorCode, errorMessage := officialStatusErrorDetails(err)
	require.Equal(t, "http_status", errorCode)
	require.Equal(t, "Official status service returned HTTP 502", errorMessage)
	require.NotContains(t, errorMessage, "secret")
	require.NotContains(t, errorMessage, server.URL)
}

func TestFetchOfficialProviderStatusClassifiesInvalidJSON(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`not-json-with-a-secret`))
	}))
	defer server.Close()

	_, err := fetchOfficialProviderStatus(context.Background(), server.Client(), officialStatusSource{SummaryURL: server.URL})
	errorCode, errorMessage := officialStatusErrorDetails(err)
	require.Equal(t, "invalid_json", errorCode)
	require.Equal(t, "Official status service returned invalid JSON", errorMessage)
	require.NotContains(t, errorMessage, "secret")
}

type officialStatusRoundTripper func(*http.Request) (*http.Response, error)

func (fn officialStatusRoundTripper) RoundTrip(request *http.Request) (*http.Response, error) {
	return fn(request)
}

func TestFetchOfficialProviderStatusClassifiesTimeout(t *testing.T) {
	client := &http.Client{Transport: officialStatusRoundTripper(func(request *http.Request) (*http.Response, error) {
		<-request.Context().Done()
		return nil, request.Context().Err()
	})}
	ctx, cancel := context.WithTimeout(context.Background(), time.Millisecond)
	defer cancel()

	_, err := fetchOfficialProviderStatus(ctx, client, officialStatusSource{SummaryURL: "https://status.example/summary.json"})
	errorCode, errorMessage := officialStatusErrorDetails(err)
	require.Equal(t, "timeout", errorCode)
	require.Equal(t, "Official status request timed out", errorMessage)
	require.NotContains(t, errorMessage, "status.example")
}

func TestFetchOfficialProviderStatusClassifiesNetworkError(t *testing.T) {
	client := &http.Client{Transport: officialStatusRoundTripper(func(_ *http.Request) (*http.Response, error) {
		return nil, errors.New("dial failed for secret.internal.example")
	})}

	_, err := fetchOfficialProviderStatus(context.Background(), client, officialStatusSource{SummaryURL: "https://status.example/summary.json"})
	errorCode, errorMessage := officialStatusErrorDetails(err)
	require.Equal(t, "network_error", errorCode)
	require.Equal(t, "Unable to connect to official status service", errorMessage)
	require.NotContains(t, errorMessage, "secret.internal.example")
	require.NotContains(t, errorMessage, "status.example")
}

func TestUnavailableOfficialProviderStatusReturnsSanitizedStructuredError(t *testing.T) {
	provider := newUnavailableOfficialProviderStatus(
		officialStatusSource{
			Provider:     "Test Provider",
			StatusURL:    "https://status.example",
			SubscribeURL: "https://status.example/subscribe",
		},
		errors.New("request leaked-secret.example failed"),
	)

	require.False(t, provider.Available)
	require.Equal(t, "network_error", provider.ErrorCode)
	require.Equal(t, "Unable to connect to official status service", provider.ErrorMessage)
	require.NotNil(t, provider.Components)
	require.NotNil(t, provider.Incidents)

	encoded, err := json.Marshal(provider)
	require.NoError(t, err)
	require.False(t, strings.Contains(string(encoded), "leaked-secret"))
}

func TestCloneOfficialProviderStatusesPreservesEmptyIncidentArray(t *testing.T) {
	cloned := cloneOfficialProviderStatuses([]officialProviderStatus{{
		Provider:  "OpenAI",
		Incidents: []officialProviderIncident{},
	}})

	require.NotNil(t, cloned[0].Incidents)
	require.Empty(t, cloned[0].Incidents)
	require.NotNil(t, cloned[0].Components)
	require.Empty(t, cloned[0].Components)
}
