package controller

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	perfmetrics "github.com/QuantumNous/new-api/pkg/perf_metrics"
	"github.com/QuantumNous/new-api/setting/console_setting"
	"github.com/gin-gonic/gin"
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

	require.Error(t, err)
}

func TestFetchGroupDataPreservesMonitorIdentityAndUnknownStatus(t *testing.T) {
	client := &http.Client{Transport: uptimeRoundTripFunc(func(request *http.Request) (*http.Response, error) {
		var body string
		switch request.URL.Path {
		case "/api/status-page/public":
			body = `{"publicGroupList":[{"name":"relay","monitorList":[{"id":42,"name":"api"},{"id":43,"name":"api"}]}]}`
		case "/api/status-page/heartbeat/public":
			body = `{"heartbeatList":{"43":[{"status":1,"time":"2026-09-14 10:00:00","ping":25}]},"uptimeList":{"43_24":1}}`
		default:
			return &http.Response{StatusCode: http.StatusNotFound, Body: io.NopCloser(strings.NewReader(""))}, nil
		}
		return &http.Response{
			StatusCode:    http.StatusOK,
			ContentLength: int64(len(body)),
			Body:          io.NopCloser(strings.NewReader(body)),
		}, nil
	})}

	result, err := fetchGroupData(context.Background(), client, map[string]any{
		"url": "https://uptime.invalid", "slug": "public", "categoryName": "primary",
	})

	require.NoError(t, err)
	require.Len(t, result.Monitors, 2)
	assert.Equal(t, "primary", result.CategoryName)
	assert.Equal(t, 42, result.Monitors[0].ID)
	assert.Equal(t, -1, result.Monitors[0].Status)
	assert.Empty(t, result.Monitors[0].LastChecked)
	assert.Nil(t, result.Monitors[0].Ping)
	assert.Equal(t, 43, result.Monitors[1].ID)
	assert.Equal(t, 1, result.Monitors[1].Status)
	assert.Equal(t, "2026-09-14T10:00:00Z", result.Monitors[1].LastChecked)
	assert.Equal(t, float64(1), result.Monitors[1].Uptime24)
}

func TestGetUptimeKumaStatusReportsDataAvailability(t *testing.T) {
	settings := console_setting.GetConsoleSetting()
	originalGroups := settings.UptimeKumaGroups
	defaultUptimeStatusLoader.mu.Lock()
	originalUptimeEntry := defaultUptimeStatusLoader.entry
	defaultUptimeStatusLoader.mu.Unlock()
	defaultRequestStatsLoader.mu.Lock()
	originalStatsEntry := defaultRequestStatsLoader.entry
	defaultRequestStatsLoader.mu.Unlock()
	t.Cleanup(func() {
		settings.UptimeKumaGroups = originalGroups
		defaultUptimeStatusLoader.mu.Lock()
		defaultUptimeStatusLoader.entry = originalUptimeEntry
		defaultUptimeStatusLoader.mu.Unlock()
		defaultRequestStatsLoader.mu.Lock()
		defaultRequestStatsLoader.entry = originalStatsEntry
		defaultRequestStatsLoader.mu.Unlock()
	})

	for _, testCase := range []struct {
		name              string
		configured        bool
		degraded          bool
		statsUnavailable  bool
		uptimeUnavailable bool
	}{
		{name: "unconfigured"},
		{name: "healthy", configured: true},
		{name: "partial upstream failure", configured: true, degraded: true},
		{name: "statistics unavailable", configured: true, statsUnavailable: true},
		{name: "unconfigured with statistics unavailable", statsUnavailable: true},
		{name: "catalog unavailable", configured: true, statsUnavailable: true, uptimeUnavailable: true, degraded: true},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			settings.UptimeKumaGroups = "[]"
			if testCase.configured {
				settings.UptimeKumaGroups = `[{"url":"https://uptime.invalid","slug":"public","categoryName":"primary"}]`
			}
			key := uptimeStatusCacheKey(console_setting.GetUptimeKumaGroups())
			snapshot := uptimeLoaderTestSnapshot(testCase.degraded)
			snapshot.Results[0].Monitors[0].ID = 42
			defaultUptimeStatusLoader.mu.Lock()
			defaultUptimeStatusLoader.entry = uptimeStatusCacheEntry{
				key: key, expiresAt: time.Now().Add(time.Hour), snapshot: snapshot,
			}
			if testCase.uptimeUnavailable {
				defaultUptimeStatusLoader.entry = uptimeStatusCacheEntry{}
			}
			defaultUptimeStatusLoader.mu.Unlock()
			defaultRequestStatsLoader.mu.Lock()
			defaultRequestStatsLoader.entry = requestStatsCacheEntry{
				expiresAt: time.Now().Add(time.Hour),
				stats: perfmetrics.RecentRequestStats{
					FiveMinutes: perfmetrics.RequestWindowStats{SuccessRate: 100, HasData: true},
				},
			}
			if testCase.statsUnavailable {
				defaultRequestStatsLoader.entry = requestStatsCacheEntry{}
			}
			defaultRequestStatsLoader.mu.Unlock()

			requestContext := context.Background()
			if testCase.statsUnavailable {
				// A pending shared fetch lets the canceled request exit without querying a database.
				releaseStats := make(chan struct{})
				pendingStats := defaultRequestStatsLoader.requests.DoChan("recent-request-stats", func() (any, error) {
					<-releaseStats
					return nil, errors.New("statistics unavailable")
				})
				t.Cleanup(func() { close(releaseStats); <-pendingStats })
				var cancel context.CancelFunc
				requestContext, cancel = context.WithCancel(requestContext)
				cancel()
			}
			if testCase.uptimeUnavailable {
				releaseUptime := make(chan struct{})
				pendingUptime := defaultUptimeStatusLoader.requests.DoChan(key, func() (any, error) {
					<-releaseUptime
					return nil, errors.New("catalog unavailable")
				})
				t.Cleanup(func() { close(releaseUptime); <-pendingUptime })
			}

			recorder := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(recorder)
			c.Request = httptest.NewRequestWithContext(requestContext, http.MethodGet, "/api/uptime/status", nil)
			GetUptimeKumaStatus(c)

			assert.Equal(t, http.StatusOK, recorder.Code)
			var response struct {
				Success                 bool                           `json:"success"`
				Data                    []UptimeGroupResult            `json:"data"`
				Degraded                *bool                          `json:"degraded"`
				RequestStatsUnavailable *bool                          `json:"request_stats_unavailable"`
				RequestStats            perfmetrics.RecentRequestStats `json:"request_stats"`
			}
			require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
			assert.True(t, response.Success)
			require.NotNil(t, response.Degraded)
			require.NotNil(t, response.RequestStatsUnavailable)
			assert.Equal(t, testCase.degraded, *response.Degraded)
			assert.Equal(t, testCase.statsUnavailable, *response.RequestStatsUnavailable)
			assert.Equal(t, !testCase.statsUnavailable, response.RequestStats.FiveMinutes.HasData)
			if testCase.configured && !testCase.uptimeUnavailable {
				require.Len(t, response.Data, 1)
				require.Len(t, response.Data[0].Monitors, 1)
				assert.Equal(t, 42, response.Data[0].Monitors[0].ID)
			} else {
				assert.Empty(t, response.Data)
			}
		})
	}
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
			ByGroup: map[string]perfmetrics.RecentRequestStats{
				"group-a": {
					FiveMinutes: perfmetrics.RequestWindowStats{SuccessRate: 75, HasData: true},
				},
			},
		}, nil
	}

	first, err := loader.load(context.Background(), fetch)
	require.NoError(t, err)
	second, err := loader.load(context.Background(), fetch)
	require.NoError(t, err)
	assert.Equal(t, first, second)
	assert.Equal(t, int32(1), calls.Load())
	modified := first.ByGroup["group-a"]
	modified.FiveMinutes.SuccessRate = 0
	first.ByGroup["group-a"] = modified
	third, err := loader.load(context.Background(), fetch)
	require.NoError(t, err)
	assert.Equal(t, float64(75), third.ByGroup["group-a"].FiveMinutes.SuccessRate)

	now = now.Add(uptimeStatusCacheTTL)
	_, err = loader.load(context.Background(), fetch)
	require.NoError(t, err)
	assert.Equal(t, int32(2), calls.Load())
}
