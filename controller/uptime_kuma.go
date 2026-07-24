package controller

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/setting/console_setting"

	"github.com/gin-gonic/gin"
	"golang.org/x/sync/errgroup"
	"golang.org/x/sync/singleflight"
)

const (
	requestTimeout         = 30 * time.Second
	httpTimeout            = 10 * time.Second
	uptimeStatusCacheTTL   = 15 * time.Second
	uptimeStatusErrorTTL   = 3 * time.Second
	uptimeResponseMaxBytes = 8 << 20
	uptimeBadgeMaxBytes    = 128 << 10
	uptimeMetricWorkers    = 12
	uptimeKeySuffix        = "_24"
	apiStatusPath          = "/api/status-page/"
	apiHeartbeatPath       = "/api/status-page/heartbeat/"
	apiBadgePath           = "/api/badge/"
)

var errUptimeResponseTooLarge = errors.New("uptime response exceeds size limit")

type uptimeStatusSnapshot struct {
	Results  []UptimeGroupResult
	Degraded bool
}

type uptimeStatusCacheEntry struct {
	key       string
	expiresAt time.Time
	snapshot  uptimeStatusSnapshot
}

type uptimeStatusLoader struct {
	mu       sync.RWMutex
	entry    uptimeStatusCacheEntry
	requests singleflight.Group
	now      func() time.Time
}

var defaultUptimeStatusLoader uptimeStatusLoader

type Monitor struct {
	Name        string      `json:"name"`
	Uptime      float64     `json:"uptime"`
	Uptime30m   *float64    `json:"uptime30m,omitempty"`
	Uptime1h    *float64    `json:"uptime1h,omitempty"`
	Uptime24    float64     `json:"uptime24"`
	Uptime7     *float64    `json:"uptime7,omitempty"`
	Status      int         `json:"status"`
	Group       string      `json:"group,omitempty"`
	Ping        *int        `json:"ping,omitempty"`
	LastChecked string      `json:"lastChecked,omitempty"`
	Heartbeats  []Heartbeat `json:"heartbeats,omitempty"`
}

type Heartbeat struct {
	Status int    `json:"status"`
	Time   string `json:"time,omitempty"`
	Ping   *int   `json:"ping,omitempty"`
	Msg    string `json:"msg,omitempty"`
}

type UptimeGroupResult struct {
	CategoryName string    `json:"categoryName"`
	Monitors     []Monitor `json:"monitors"`
}

func normalizeUptimeHeartbeatTime(value string) string {
	if value == "" {
		return ""
	}
	if parsed, err := time.Parse(time.RFC3339Nano, value); err == nil {
		return parsed.Format(time.RFC3339Nano)
	}
	for _, layout := range []string{"2006-01-02 15:04:05.999999999", "2006-01-02 15:04:05"} {
		if parsed, err := time.ParseInLocation(layout, value, time.UTC); err == nil {
			return parsed.Format(time.RFC3339Nano)
		}
	}
	return value
}

func normalizeMonitorHeartbeats(monitor *Monitor) {
	if monitor == nil || len(monitor.Heartbeats) == 0 {
		return
	}
	sort.SliceStable(monitor.Heartbeats, func(i, j int) bool {
		return monitor.Heartbeats[i].Time < monitor.Heartbeats[j].Time
	})
	latest := monitor.Heartbeats[len(monitor.Heartbeats)-1]
	monitor.Status = latest.Status
	monitor.LastChecked = latest.Time
	monitor.Ping = latest.Ping
}

func getAndDecode(ctx context.Context, client *http.Client, url string, dest interface{}) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}

	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return errors.New("non-200 status")
	}
	if resp.ContentLength > uptimeResponseMaxBytes {
		return errUptimeResponseTooLarge
	}

	limited := &io.LimitedReader{R: resp.Body, N: uptimeResponseMaxBytes + 1}
	decoder := json.NewDecoder(limited)
	err = decoder.Decode(dest)
	if err == nil {
		var trailing interface{}
		trailingErr := decoder.Decode(&trailing)
		if trailingErr == nil {
			return errors.New("response contains trailing JSON data")
		}
		if trailingErr != io.EOF {
			err = trailingErr
		}
	}
	if limited.N <= 0 {
		return errUptimeResponseTooLarge
	}
	return err
}

func parseUptimeBadge(reader io.Reader) (float64, error) {
	limited := &io.LimitedReader{R: reader, N: uptimeBadgeMaxBytes + 1}
	var badge struct {
		Title string `xml:"title"`
	}
	if err := xml.NewDecoder(limited).Decode(&badge); err != nil {
		return 0, err
	}
	if limited.N <= 0 {
		return 0, errUptimeResponseTooLarge
	}

	separator := strings.LastIndex(badge.Title, ":")
	if separator < 0 {
		return 0, errors.New("uptime badge title has no value")
	}
	value := strings.TrimSpace(strings.TrimSuffix(badge.Title[separator+1:], "%"))
	percentage, err := strconv.ParseFloat(value, 64)
	if err != nil || percentage < 0 || percentage > 100 {
		return 0, errors.New("uptime badge contains an invalid percentage")
	}
	return percentage / 100, nil
}

func fetchBadgeUptime(
	ctx context.Context,
	client *http.Client,
	baseURL string,
	monitorID string,
	duration string,
) (float64, error) {
	url := fmt.Sprintf(
		"%s%s%s/uptime/%s?label=uptime",
		baseURL,
		apiBadgePath,
		monitorID,
		duration,
	)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return 0, err
	}
	resp, err := client.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return 0, errors.New("non-200 badge status")
	}
	if resp.ContentLength > uptimeBadgeMaxBytes {
		return 0, errUptimeResponseTooLarge
	}
	return parseUptimeBadge(resp.Body)
}

func fetchGroupData(ctx context.Context, client *http.Client, groupConfig map[string]interface{}) (UptimeGroupResult, error) {
	url, _ := groupConfig["url"].(string)
	slug, _ := groupConfig["slug"].(string)
	categoryName, _ := groupConfig["categoryName"].(string)

	result := UptimeGroupResult{
		CategoryName: categoryName,
		Monitors:     []Monitor{},
	}

	if url == "" || slug == "" {
		return result, errors.New("invalid uptime group configuration")
	}

	baseURL := strings.TrimSuffix(url, "/")

	var statusData struct {
		PublicGroupList []struct {
			ID          int    `json:"id"`
			Name        string `json:"name"`
			MonitorList []struct {
				ID   int    `json:"id"`
				Name string `json:"name"`
			} `json:"monitorList"`
		} `json:"publicGroupList"`
	}

	var heartbeatData struct {
		HeartbeatList map[string][]struct {
			Status int    `json:"status"`
			Time   string `json:"time"`
			Ping   *int   `json:"ping"`
			Msg    string `json:"msg"`
		} `json:"heartbeatList"`
		UptimeList map[string]float64 `json:"uptimeList"`
	}

	g, gCtx := errgroup.WithContext(ctx)
	g.Go(func() error {
		return getAndDecode(gCtx, client, baseURL+apiStatusPath+slug, &statusData)
	})
	g.Go(func() error {
		return getAndDecode(gCtx, client, baseURL+apiHeartbeatPath+slug, &heartbeatData)
	})

	if err := g.Wait(); err != nil {
		return result, err
	}

	type monitorReference struct {
		index int
		id    string
	}
	monitorReferences := make([]monitorReference, 0)

	for _, pg := range statusData.PublicGroupList {
		if len(pg.MonitorList) == 0 {
			continue
		}

		for _, m := range pg.MonitorList {
			monitor := Monitor{
				Name:  m.Name,
				Group: pg.Name,
			}

			monitorID := strconv.Itoa(m.ID)

			if uptime, exists := heartbeatData.UptimeList[monitorID+uptimeKeySuffix]; exists {
				monitor.Uptime = uptime
				monitor.Uptime24 = uptime
			}
			if uptime, exists := resolveSevenDayUptime(heartbeatData.UptimeList, monitorID); exists {
				monitor.Uptime7 = float64Ptr(uptime)
			}

			if heartbeats, exists := heartbeatData.HeartbeatList[monitorID]; exists && len(heartbeats) > 0 {
				monitor.Heartbeats = make([]Heartbeat, 0, len(heartbeats))
				for _, heartbeat := range heartbeats {
					monitor.Heartbeats = append(monitor.Heartbeats, Heartbeat{
						Status: heartbeat.Status,
						Time:   normalizeUptimeHeartbeatTime(heartbeat.Time),
						Ping:   heartbeat.Ping,
						Msg:    heartbeat.Msg,
					})
				}
				normalizeMonitorHeartbeats(&monitor)
			}

			result.Monitors = append(result.Monitors, monitor)
			monitorReferences = append(monitorReferences, monitorReference{
				index: len(result.Monitors) - 1,
				id:    monitorID,
			})
		}
	}

	type metricResult struct {
		monitorIndex int
		duration     string
		uptime       float64
	}
	metricResults := make(chan metricResult, len(monitorReferences)*3)
	metricsGroup, metricsCtx := errgroup.WithContext(ctx)
	metricsGroup.SetLimit(uptimeMetricWorkers)
	for _, reference := range monitorReferences {
		for _, duration := range []string{"30m", "1h", "7d"} {
			reference, duration := reference, duration
			metricsGroup.Go(func() error {
				uptime, err := fetchBadgeUptime(metricsCtx, client, baseURL, reference.id, duration)
				if err == nil {
					metricResults <- metricResult{
						monitorIndex: reference.index,
						duration:     duration,
						uptime:       uptime,
					}
				}
				return nil
			})
		}
	}
	_ = metricsGroup.Wait()
	close(metricResults)
	for metric := range metricResults {
		switch metric.duration {
		case "30m":
			result.Monitors[metric.monitorIndex].Uptime30m = float64Ptr(metric.uptime)
		case "1h":
			result.Monitors[metric.monitorIndex].Uptime1h = float64Ptr(metric.uptime)
		case "7d":
			result.Monitors[metric.monitorIndex].Uptime7 = float64Ptr(metric.uptime)
		}
	}

	return result, nil
}

func float64Ptr(value float64) *float64 {
	return &value
}

func resolveSevenDayUptime(uptimeList map[string]float64, monitorID string) (float64, bool) {
	for _, suffix := range []string{"_168", "_7d", "_7"} {
		if uptime, exists := uptimeList[monitorID+suffix]; exists {
			return uptime, true
		}
	}
	return 0, false
}

func fetchUptimeStatusSnapshot(ctx context.Context, groups []map[string]interface{}) uptimeStatusSnapshot {
	client := &http.Client{Timeout: httpTimeout}
	results := make([]UptimeGroupResult, len(groups))
	errorsByGroup := make([]error, len(groups))

	g, gCtx := errgroup.WithContext(ctx)
	for i, group := range groups {
		i, group := i, group
		g.Go(func() error {
			results[i], errorsByGroup[i] = fetchGroupData(gCtx, client, group)
			return nil
		})
	}

	_ = g.Wait()
	degraded := false
	for _, err := range errorsByGroup {
		if err != nil {
			degraded = true
			break
		}
	}
	return uptimeStatusSnapshot{Results: results, Degraded: degraded}
}

func cloneUptimeStatusSnapshot(snapshot uptimeStatusSnapshot) uptimeStatusSnapshot {
	cloned := uptimeStatusSnapshot{
		Results:  make([]UptimeGroupResult, len(snapshot.Results)),
		Degraded: snapshot.Degraded,
	}
	for groupIndex, group := range snapshot.Results {
		cloned.Results[groupIndex] = group
		cloned.Results[groupIndex].Monitors = make([]Monitor, len(group.Monitors))
		for monitorIndex, monitor := range group.Monitors {
			cloned.Results[groupIndex].Monitors[monitorIndex] = monitor
			clonedHeartbeats := make([]Heartbeat, len(monitor.Heartbeats))
			for heartbeatIndex, heartbeat := range monitor.Heartbeats {
				clonedHeartbeats[heartbeatIndex] = heartbeat
				if heartbeat.Ping != nil {
					ping := *heartbeat.Ping
					clonedHeartbeats[heartbeatIndex].Ping = &ping
				}
			}
			cloned.Results[groupIndex].Monitors[monitorIndex].Heartbeats = clonedHeartbeats
			if monitor.Ping != nil {
				ping := *monitor.Ping
				cloned.Results[groupIndex].Monitors[monitorIndex].Ping = &ping
			}
			if monitor.Uptime30m != nil {
				uptime30m := *monitor.Uptime30m
				cloned.Results[groupIndex].Monitors[monitorIndex].Uptime30m = &uptime30m
			}
			if monitor.Uptime1h != nil {
				uptime1h := *monitor.Uptime1h
				cloned.Results[groupIndex].Monitors[monitorIndex].Uptime1h = &uptime1h
			}
			if monitor.Uptime7 != nil {
				uptime7 := *monitor.Uptime7
				cloned.Results[groupIndex].Monitors[monitorIndex].Uptime7 = &uptime7
			}
		}
	}
	return cloned
}

func uptimeStatusCacheKey(groups []map[string]interface{}) string {
	encoded, err := json.Marshal(groups)
	if err != nil {
		return ""
	}
	digest := sha256.Sum256(encoded)
	return string(digest[:])
}

func (loader *uptimeStatusLoader) currentTime() time.Time {
	if loader.now != nil {
		return loader.now()
	}
	return time.Now()
}

func (loader *uptimeStatusLoader) cached(key string, now time.Time) (uptimeStatusSnapshot, bool) {
	loader.mu.RLock()
	defer loader.mu.RUnlock()
	if key == "" || loader.entry.key != key || !now.Before(loader.entry.expiresAt) {
		return uptimeStatusSnapshot{}, false
	}
	return cloneUptimeStatusSnapshot(loader.entry.snapshot), true
}

func (loader *uptimeStatusLoader) load(
	ctx context.Context,
	groups []map[string]interface{},
	fetch func(context.Context, []map[string]interface{}) uptimeStatusSnapshot,
) (uptimeStatusSnapshot, error) {
	key := uptimeStatusCacheKey(groups)
	if snapshot, ok := loader.cached(key, loader.currentTime()); ok {
		return snapshot, nil
	}

	result := loader.requests.DoChan(key, func() (interface{}, error) {
		if snapshot, ok := loader.cached(key, loader.currentTime()); ok {
			return snapshot, nil
		}

		fetchCtx, cancel := context.WithTimeout(context.Background(), requestTimeout)
		defer cancel()
		snapshot := fetch(fetchCtx, groups)
		ttl := uptimeStatusCacheTTL
		if snapshot.Degraded {
			ttl = uptimeStatusErrorTTL
		}

		loader.mu.Lock()
		loader.entry = uptimeStatusCacheEntry{
			key:       key,
			expiresAt: loader.currentTime().Add(ttl),
			snapshot:  cloneUptimeStatusSnapshot(snapshot),
		}
		loader.mu.Unlock()
		return cloneUptimeStatusSnapshot(snapshot), nil
	})

	select {
	case <-ctx.Done():
		return uptimeStatusSnapshot{}, ctx.Err()
	case loaded := <-result:
		if loaded.Err != nil {
			return uptimeStatusSnapshot{}, loaded.Err
		}
		snapshot, ok := loaded.Val.(uptimeStatusSnapshot)
		if !ok {
			return uptimeStatusSnapshot{}, errors.New("invalid uptime cache result")
		}
		return cloneUptimeStatusSnapshot(snapshot), nil
	}
}

func GetUptimeKumaStatus(c *gin.Context) {
	groups := console_setting.GetUptimeKumaGroups()
	if len(groups) == 0 {
		c.JSON(http.StatusOK, gin.H{"success": true, "message": "", "data": []UptimeGroupResult{}})
		return
	}

	snapshot, err := defaultUptimeStatusLoader.load(c.Request.Context(), groups, fetchUptimeStatusSnapshot)
	if err != nil {
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "", "data": snapshot.Results})
}
