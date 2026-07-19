package controller

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type uptimeRoundTripFunc func(*http.Request) (*http.Response, error)

func (f uptimeRoundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return f(request)
}

func TestNormalizeMonitorHeartbeatsUsesLatestTimestamp(t *testing.T) {
	oldPing := 1200
	latestPing := 800
	monitor := Monitor{
		Heartbeats: []Heartbeat{
			{Status: 1, Time: "2026-07-13 10:00:00.000", Ping: &latestPing},
			{Status: 0, Time: "2026-07-13 09:00:00.000", Ping: &oldPing},
		},
	}

	normalizeMonitorHeartbeats(&monitor)

	require.Len(t, monitor.Heartbeats, 2)
	assert.Equal(t, "2026-07-13 09:00:00.000", monitor.Heartbeats[0].Time)
	assert.Equal(t, "2026-07-13 10:00:00.000", monitor.LastChecked)
	assert.Equal(t, 1, monitor.Status)
	assert.Equal(t, latestPing, *monitor.Ping)
}

func TestNormalizeUptimeHeartbeatTimeMarksNaiveTimestampAsUTC(t *testing.T) {
	assert.Equal(
		t,
		"2026-07-13T03:13:06.779Z",
		normalizeUptimeHeartbeatTime("2026-07-13 03:13:06.779"),
	)
}

func TestGetAndDecodeRejectsOversizedChunkedResponse(t *testing.T) {
	client := &http.Client{Transport: uptimeRoundTripFunc(func(_ *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode:    http.StatusOK,
			ContentLength: -1,
			Body: io.NopCloser(io.MultiReader(
				strings.NewReader(`{"payload":"`),
				strings.NewReader(strings.Repeat("x", uptimeResponseMaxBytes+1)),
				strings.NewReader(`"}`),
			)),
		}, nil
	})}

	var response map[string]interface{}
	err := getAndDecode(context.Background(), client, "http://uptime.invalid", &response)

	require.Error(t, err)
	assert.True(t, errors.Is(err, errUptimeResponseTooLarge))
}

func TestGetAndDecodeAcceptsBoundedJSONResponse(t *testing.T) {
	client := &http.Client{Transport: uptimeRoundTripFunc(func(_ *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode:    http.StatusOK,
			ContentLength: int64(len(`{"status":"ok"}`)),
			Body:          io.NopCloser(strings.NewReader(`{"status":"ok"}`)),
		}, nil
	})}

	var response map[string]string
	require.NoError(t, getAndDecode(context.Background(), client, "http://uptime.invalid", &response))
	assert.Equal(t, "ok", response["status"])
}

func TestGetAndDecodeRejectsTrailingJSON(t *testing.T) {
	client := &http.Client{Transport: uptimeRoundTripFunc(func(_ *http.Request) (*http.Response, error) {
		body := `{"status":"ok"}{"extra":"payload"}`
		return &http.Response{
			StatusCode:    http.StatusOK,
			ContentLength: int64(len(body)),
			Body:          io.NopCloser(strings.NewReader(body)),
		}, nil
	})}

	var response map[string]string
	err := getAndDecode(context.Background(), client, "http://uptime.invalid", &response)

	require.ErrorContains(t, err, "trailing JSON")
}

func uptimeLoaderTestSnapshot(degraded bool) uptimeStatusSnapshot {
	ping := 42
	uptime7 := 0.99
	return uptimeStatusSnapshot{
		Degraded: degraded,
		Results: []UptimeGroupResult{
			{
				CategoryName: "primary",
				Monitors: []Monitor{
					{
						Name:       "api",
						Status:     1,
						Ping:       &ping,
						Uptime7:    &uptime7,
						Heartbeats: []Heartbeat{{Status: 1, Ping: &ping}},
					},
				},
			},
		},
	}
}

func TestUptimeStatusLoaderCoalescesConcurrentFetches(t *testing.T) {
	loader := &uptimeStatusLoader{}
	groups := []map[string]interface{}{{
		"categoryName": "primary",
		"url":          "https://status.example.com",
		"slug":         "public",
	}}

	var calls atomic.Int32
	fetchStarted := make(chan struct{})
	releaseFetch := make(chan struct{})
	fetch := func(context.Context, []map[string]interface{}) uptimeStatusSnapshot {
		if calls.Add(1) == 1 {
			close(fetchStarted)
		}
		<-releaseFetch
		return uptimeLoaderTestSnapshot(false)
	}

	const clients = 16
	start := make(chan struct{})
	results := make(chan uptimeStatusSnapshot, clients)
	errorsCh := make(chan error, clients)
	var ready sync.WaitGroup
	var done sync.WaitGroup
	ready.Add(clients)
	done.Add(clients)
	for range clients {
		go func() {
			defer done.Done()
			ready.Done()
			<-start
			snapshot, err := loader.load(context.Background(), groups, fetch)
			results <- snapshot
			errorsCh <- err
		}()
	}

	ready.Wait()
	close(start)
	<-fetchStarted
	close(releaseFetch)
	done.Wait()
	close(results)
	close(errorsCh)

	assert.Equal(t, int32(1), calls.Load())
	for err := range errorsCh {
		require.NoError(t, err)
	}
	for snapshot := range results {
		require.Len(t, snapshot.Results, 1)
		assert.Equal(t, "primary", snapshot.Results[0].CategoryName)
	}
}

func TestUptimeStatusLoaderCachesDegradedResultsBriefly(t *testing.T) {
	now := time.Date(2026, 7, 19, 12, 0, 0, 0, time.UTC)
	loader := &uptimeStatusLoader{now: func() time.Time { return now }}
	groups := []map[string]interface{}{{"categoryName": "primary"}}
	var calls atomic.Int32
	fetch := func(context.Context, []map[string]interface{}) uptimeStatusSnapshot {
		calls.Add(1)
		return uptimeLoaderTestSnapshot(true)
	}

	_, err := loader.load(context.Background(), groups, fetch)
	require.NoError(t, err)
	_, err = loader.load(context.Background(), groups, fetch)
	require.NoError(t, err)
	assert.Equal(t, int32(1), calls.Load())

	now = now.Add(uptimeStatusErrorTTL)
	_, err = loader.load(context.Background(), groups, fetch)
	require.NoError(t, err)
	assert.Equal(t, int32(2), calls.Load())
}

func TestUptimeStatusLoaderReturnsDefensiveCopies(t *testing.T) {
	loader := &uptimeStatusLoader{}
	groups := []map[string]interface{}{{"categoryName": "primary"}}
	fetch := func(context.Context, []map[string]interface{}) uptimeStatusSnapshot {
		return uptimeLoaderTestSnapshot(false)
	}

	first, err := loader.load(context.Background(), groups, fetch)
	require.NoError(t, err)
	first.Results[0].CategoryName = "modified"
	first.Results[0].Monitors[0].Name = "modified"
	*first.Results[0].Monitors[0].Ping = 1000
	*first.Results[0].Monitors[0].Heartbeats[0].Ping = 1000

	second, err := loader.load(context.Background(), groups, fetch)
	require.NoError(t, err)
	assert.Equal(t, "primary", second.Results[0].CategoryName)
	assert.Equal(t, "api", second.Results[0].Monitors[0].Name)
	assert.Equal(t, 42, *second.Results[0].Monitors[0].Ping)
	assert.Equal(t, 42, *second.Results[0].Monitors[0].Heartbeats[0].Ping)
}
