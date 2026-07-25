package controller

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"golang.org/x/sync/errgroup"
)

const (
	officialStatusCacheTTL = 60 * time.Second
	officialStatusTimeout  = 8 * time.Second
)

type officialStatusSource struct {
	Provider     string
	SummaryURL   string
	StatusURL    string
	SubscribeURL string
}

var officialStatusSources = []officialStatusSource{
	{
		Provider:     "OpenAI",
		SummaryURL:   "https://status.openai.com/api/v2/summary.json",
		StatusURL:    "https://status.openai.com/",
		SubscribeURL: "https://status.openai.com/#subscribe-to-updates",
	},
	{
		Provider:     "Claude",
		SummaryURL:   "https://status.claude.com/api/v2/summary.json",
		StatusURL:    "https://status.claude.com/",
		SubscribeURL: "https://status.claude.com/#subscribe-to-updates",
	},
}

type officialProviderIncident struct {
	Name       string                      `json:"name"`
	Status     string                      `json:"status"`
	Impact     string                      `json:"impact"`
	Message    string                      `json:"message"`
	UpdatedAt  string                      `json:"updated_at"`
	URL        string                      `json:"url"`
	Components []officialProviderComponent `json:"components"`
}

type officialProviderComponent struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Status    string `json:"status"`
	UpdatedAt string `json:"updated_at"`
	Group     bool   `json:"group"`
	GroupID   string `json:"group_id"`
}

type officialProviderStatus struct {
	Provider     string                      `json:"provider"`
	Available    bool                        `json:"available"`
	Indicator    string                      `json:"indicator"`
	Description  string                      `json:"description"`
	StatusURL    string                      `json:"status_url"`
	SubscribeURL string                      `json:"subscribe_url"`
	CheckedAt    string                      `json:"checked_at"`
	Components   []officialProviderComponent `json:"components"`
	Incidents    []officialProviderIncident  `json:"incidents"`
	ErrorCode    string                      `json:"error_code,omitempty"`
	ErrorMessage string                      `json:"error_message,omitempty"`
}

type statuspageComponent struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Status    string `json:"status"`
	UpdatedAt string `json:"updated_at"`
	Group     bool   `json:"group"`
	GroupID   string `json:"group_id"`
}

type statuspageIncidentUpdate struct {
	Body               string                `json:"body"`
	UpdatedAt          string                `json:"updated_at"`
	AffectedComponents []statuspageComponent `json:"affected_components"`
}

type statuspageIncident struct {
	Name       string                     `json:"name"`
	Status     string                     `json:"status"`
	Impact     string                     `json:"impact"`
	Shortlink  string                     `json:"shortlink"`
	UpdatedAt  string                     `json:"updated_at"`
	Components []statuspageComponent      `json:"components"`
	Updates    []statuspageIncidentUpdate `json:"incident_updates"`
}

type statuspageSummary struct {
	Status struct {
		Indicator   string `json:"indicator"`
		Description string `json:"description"`
	} `json:"status"`
	Components            []statuspageComponent `json:"components"`
	Incidents             []statuspageIncident  `json:"incidents"`
	ScheduledMaintenances []statuspageIncident  `json:"scheduled_maintenances"`
}

var officialProviderStatusCache struct {
	sync.Mutex
	expiresAt time.Time
	providers []officialProviderStatus
}

type officialStatusFetchError struct {
	code    string
	message string
}

func (e *officialStatusFetchError) Error() string {
	return e.message
}

func officialStatusErrorDetails(err error) (string, string) {
	var fetchErr *officialStatusFetchError
	if errors.As(err, &fetchErr) {
		return fetchErr.code, fetchErr.message
	}
	return "network_error", "Unable to connect to official status service"
}

func isOfficialStatusTimeout(err error) bool {
	if errors.Is(err, context.DeadlineExceeded) {
		return true
	}
	var networkErr net.Error
	return errors.As(err, &networkErr) && networkErr.Timeout()
}

func newOfficialStatusTransportError(err error) error {
	if isOfficialStatusTimeout(err) {
		return &officialStatusFetchError{
			code:    "timeout",
			message: "Official status request timed out",
		}
	}
	return &officialStatusFetchError{
		code:    "network_error",
		message: "Unable to connect to official status service",
	}
}

func newUnavailableOfficialProviderStatus(source officialStatusSource, err error) officialProviderStatus {
	errorCode, errorMessage := officialStatusErrorDetails(err)
	return officialProviderStatus{
		Provider:     source.Provider,
		Available:    false,
		StatusURL:    source.StatusURL,
		SubscribeURL: source.SubscribeURL,
		CheckedAt:    time.Now().UTC().Format(time.RFC3339),
		Components:   []officialProviderComponent{},
		Incidents:    []officialProviderIncident{},
		ErrorCode:    errorCode,
		ErrorMessage: errorMessage,
	}
}

func cloneOfficialProviderStatuses(providers []officialProviderStatus) []officialProviderStatus {
	cloned := make([]officialProviderStatus, len(providers))
	for i, provider := range providers {
		cloned[i] = provider
		cloned[i].Components = append(
			make([]officialProviderComponent, 0, len(provider.Components)),
			provider.Components...,
		)
		cloned[i].Incidents = append(
			make([]officialProviderIncident, 0, len(provider.Incidents)),
			provider.Incidents...,
		)
		for incidentIndex := range cloned[i].Incidents {
			cloned[i].Incidents[incidentIndex].Components = append(
				make([]officialProviderComponent, 0, len(provider.Incidents[incidentIndex].Components)),
				provider.Incidents[incidentIndex].Components...,
			)
		}
	}
	return cloned
}

func normalizeOfficialComponents(components []statuspageComponent) []officialProviderComponent {
	result := make([]officialProviderComponent, 0, len(components))
	indexes := make(map[string]int, len(components))
	for _, component := range components {
		key := component.ID
		if key == "" {
			key = component.Name
		}
		if key == "" {
			continue
		}
		normalized := officialProviderComponent{
			ID:        component.ID,
			Name:      component.Name,
			Status:    component.Status,
			UpdatedAt: component.UpdatedAt,
			Group:     component.Group,
			GroupID:   component.GroupID,
		}
		if index, exists := indexes[key]; exists {
			// Statuspage incident updates repeat affected components. The latest
			// occurrence carries the current state and must replace the snapshot.
			result[index] = normalized
			continue
		}
		indexes[key] = len(result)
		result = append(result, normalized)
	}
	return result
}

func latestOfficialIncidentUpdate(updates []statuspageIncidentUpdate) statuspageIncidentUpdate {
	latest := updates[0]
	latestTime, latestTimeValid := time.Parse(time.RFC3339Nano, latest.UpdatedAt)
	for _, update := range updates[1:] {
		updatedAt, err := time.Parse(time.RFC3339Nano, update.UpdatedAt)
		if err != nil {
			continue
		}
		if latestTimeValid != nil || updatedAt.After(latestTime) {
			latest = update
			latestTime = updatedAt
			latestTimeValid = nil
		}
	}
	return latest
}

func normalizeOfficialIncident(incident statuspageIncident) officialProviderIncident {
	message := ""
	updatedAt := incident.UpdatedAt
	components := incident.Components
	if len(incident.Updates) > 0 {
		latestUpdate := latestOfficialIncidentUpdate(incident.Updates)
		message = latestUpdate.Body
		if latestUpdate.UpdatedAt != "" {
			updatedAt = latestUpdate.UpdatedAt
		}
		if len(latestUpdate.AffectedComponents) > 0 {
			components = append(components, latestUpdate.AffectedComponents...)
		}
	}
	return officialProviderIncident{
		Name:       incident.Name,
		Status:     incident.Status,
		Impact:     incident.Impact,
		Message:    message,
		UpdatedAt:  updatedAt,
		URL:        incident.Shortlink,
		Components: normalizeOfficialComponents(components),
	}
}

func fetchOfficialProviderStatus(ctx context.Context, client *http.Client, source officialStatusSource) (officialProviderStatus, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, source.SummaryURL, nil)
	if err != nil {
		return officialProviderStatus{}, newOfficialStatusTransportError(err)
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("User-Agent", "new-api-status-monitor")

	response, err := client.Do(request)
	if err != nil {
		return officialProviderStatus{}, newOfficialStatusTransportError(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return officialProviderStatus{}, &officialStatusFetchError{
			code:    "http_status",
			message: fmt.Sprintf("Official status service returned HTTP %d", response.StatusCode),
		}
	}

	var summary statuspageSummary
	if err := json.NewDecoder(io.LimitReader(response.Body, 2<<20)).Decode(&summary); err != nil {
		if isOfficialStatusTimeout(err) {
			return officialProviderStatus{}, newOfficialStatusTransportError(err)
		}
		return officialProviderStatus{}, &officialStatusFetchError{
			code:    "invalid_json",
			message: "Official status service returned invalid JSON",
		}
	}

	result := officialProviderStatus{
		Provider:     source.Provider,
		Available:    true,
		Indicator:    summary.Status.Indicator,
		Description:  summary.Status.Description,
		StatusURL:    source.StatusURL,
		SubscribeURL: source.SubscribeURL,
		CheckedAt:    time.Now().UTC().Format(time.RFC3339),
		Components:   normalizeOfficialComponents(summary.Components),
		Incidents:    make([]officialProviderIncident, 0, len(summary.Incidents)+len(summary.ScheduledMaintenances)),
	}
	for _, incident := range summary.Incidents {
		result.Incidents = append(result.Incidents, normalizeOfficialIncident(incident))
	}
	for _, maintenance := range summary.ScheduledMaintenances {
		result.Incidents = append(result.Incidents, normalizeOfficialIncident(maintenance))
	}
	return result, nil
}

func loadOfficialProviderStatuses(ctx context.Context) []officialProviderStatus {
	officialProviderStatusCache.Lock()
	defer officialProviderStatusCache.Unlock()

	if time.Now().Before(officialProviderStatusCache.expiresAt) {
		return cloneOfficialProviderStatuses(officialProviderStatusCache.providers)
	}

	providers := make([]officialProviderStatus, len(officialStatusSources))
	client := &http.Client{Timeout: officialStatusTimeout}
	group, groupCtx := errgroup.WithContext(ctx)
	for i, source := range officialStatusSources {
		i, source := i, source
		group.Go(func() error {
			provider, err := fetchOfficialProviderStatus(groupCtx, client, source)
			if err != nil {
				providers[i] = newUnavailableOfficialProviderStatus(source, err)
				return nil
			}
			providers[i] = provider
			return nil
		})
	}
	_ = group.Wait()

	officialProviderStatusCache.providers = cloneOfficialProviderStatuses(providers)
	officialProviderStatusCache.expiresAt = time.Now().Add(officialStatusCacheTTL)
	return providers
}

func GetOfficialProviderStatuses(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), officialStatusTimeout)
	defer cancel()

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"providers": loadOfficialProviderStatuses(ctx),
		},
	})
}
