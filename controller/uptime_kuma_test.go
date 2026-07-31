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

	perfmetrics "github.com/QuantumNous/new-api/pkg/perf_metrics"
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

func TestResolveSevenDayUptimeAcceptsOnlySevenDayKeys(t *testing.T) {
	t.Run("accepts supported seven day suffixes", func(t *testing.T) {
		for _, testCase := range []struct {
			name   string
			suffix string
			value  float64
		}{
			{name: "168 hours", suffix: "_168", value: 0.981},
			{name: "7d", suffix: "_7d", value: 0.982},
			{name: "7 days", suffix: "_7", value: 0.983},
		} {
			t.Run(testCase.name, func(t *testing.T) {
				uptime, exists := resolveSevenDayUptime(
					map[string]float64{"42" + testCase.suffix: testCase.value},
					"42",
				)

				require.True(t, exists)
				assert.Equal(t, testCase.value, uptime)
			})
		}
	})

	t.Run("rejects non seven day suffixes", func(t *testing.T) {
		for _, suffix := range []string{"_24", "_720", "_30d"} {
			t.Run(suffix, func(t *testing.T) {
				uptime, exists := resolveSevenDayUptime(
					map[string]float64{"42" + suffix: 0.999},
					"42",
				)

				assert.False(t, exists)
				assert.Zero(t, uptime)
			})
		}
	})
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

func TestParseUptimeBadge(t *testing.T) {
	uptime, err := parseUptimeBadge(strings.NewReader(
		`<svg xmlns="http://www.w3.org/2000/svg"><title>uptime: 98.76%</title></svg>`,
	))

	require.NoError(t, err)
	assert.InDelta(t, 0.9876, uptime, 0.000001)
}

func TestParseUptimeBadgeRejectsUnavailableValue(t *testing.T) {
	_, err := parseUptimeBadge(strings.NewReader(
		`<svg xmlns="http://www.w3.org/2000/svg"><title>uptime: N/A</title></svg>`,
	))

	require.ErrorContains(t, err, "invalid percentage")
}

func uptimeLoaderTestSnapshot(degraded bool) uptimeStatusSnapshot {
	ping := 42
	uptime30m := 0.97
	uptime1h := 0.98
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
						Uptime30m:  &uptime30m,
						Uptime1h:   &uptime1h,
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
	*first.Results[0].Monitors[0].Uptime30m = 0
	*first.Results[0].Monitors[0].Uptime1h = 0
	*first.Results[0].Monitors[0].Uptime7 = 0
	*first.Results[0].Monitors[0].Heartbeats[0].Ping = 1000

	second, err := loader.load(context.Background(), groups, fetch)
	require.NoError(t, err)
	assert.Equal(t, "primary", second.Results[0].CategoryName)
	assert.Equal(t, "api", second.Results[0].Monitors[0].Name)
	assert.Equal(t, 42, *second.Results[0].Monitors[0].Ping)
	assert.Equal(t, 0.97, *second.Results[0].Monitors[0].Uptime30m)
	assert.Equal(t, 0.98, *second.Results[0].Monitors[0].Uptime1h)
	assert.Equal(t, 0.99, *second.Results[0].Monitors[0].Uptime7)
	assert.Equal(t, 42, *second.Results[0].Monitors[0].Heartbeats[0].Ping)
}

func TestRequestStatsLoaderCachesForUptimeTTL(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	loader := &requestStatsLoader{now: func() time.Time { return now }}
	var calls atomic.Int32
	fetch := func() (perfmetrics.RecentRequestStats, error) {
		calls.Add(1)
		return perfmetrics.RecentRequestStats{
			FiveMinutes: perfmetrics.RequestWindowStats{SuccessRate: 99, HasData: true},
		}, nil
	}

	first, err := loader.load(context.Background(), fetch)
	require.NoError(t, err)
	second, err := loader.load(context.Background(), fetch)
	require.NoError(t, err)
	assert.Equal(t, first, second)
	assert.Equal(t, int32(1), calls.Load())

	now = now.Add(uptimeStatusCacheTTL)
	_, err = loader.load(context.Background(), fetch)
	require.NoError(t, err)
	assert.Equal(t, int32(2), calls.Load())
}
