package controller

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
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
	Name      string `json:"name"`
	Status    string `json:"status"`
	Impact    string `json:"impact"`
	Message   string `json:"message"`
	UpdatedAt string `json:"updated_at"`
	URL       string `json:"url"`
}

type officialProviderStatus struct {
	Provider     string                     `json:"provider"`
	Available    bool                       `json:"available"`
	Indicator    string                     `json:"indicator"`
	Description  string                     `json:"description"`
	StatusURL    string                     `json:"status_url"`
	SubscribeURL string                     `json:"subscribe_url"`
	Incidents    []officialProviderIncident `json:"incidents"`
}

type statuspageSummary struct {
	Status struct {
		Indicator   string `json:"indicator"`
		Description string `json:"description"`
	} `json:"status"`
	Incidents []struct {
		Name      string `json:"name"`
		Status    string `json:"status"`
		Impact    string `json:"impact"`
		Shortlink string `json:"shortlink"`
		UpdatedAt string `json:"updated_at"`
		Updates   []struct {
			Body      string `json:"body"`
			UpdatedAt string `json:"updated_at"`
		} `json:"incident_updates"`
	} `json:"incidents"`
}

var officialProviderStatusCache struct {
	sync.Mutex
	expiresAt time.Time
	providers []officialProviderStatus
}

func cloneOfficialProviderStatuses(providers []officialProviderStatus) []officialProviderStatus {
	cloned := make([]officialProviderStatus, len(providers))
	for i, provider := range providers {
		cloned[i] = provider
		cloned[i].Incidents = append(
			make([]officialProviderIncident, 0, len(provider.Incidents)),
			provider.Incidents...,
		)
	}
	return cloned
}

func fetchOfficialProviderStatus(ctx context.Context, client *http.Client, source officialStatusSource) (officialProviderStatus, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, source.SummaryURL, nil)
	if err != nil {
		return officialProviderStatus{}, err
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("User-Agent", "new-api-status-monitor")

	response, err := client.Do(request)
	if err != nil {
		return officialProviderStatus{}, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return officialProviderStatus{}, fmt.Errorf("official status returned HTTP %d", response.StatusCode)
	}

	var summary statuspageSummary
	if err := json.NewDecoder(io.LimitReader(response.Body, 2<<20)).Decode(&summary); err != nil {
		return officialProviderStatus{}, err
	}

	result := officialProviderStatus{
		Provider:     source.Provider,
		Available:    true,
		Indicator:    summary.Status.Indicator,
		Description:  summary.Status.Description,
		StatusURL:    source.StatusURL,
		SubscribeURL: source.SubscribeURL,
		Incidents:    make([]officialProviderIncident, 0, len(summary.Incidents)),
	}
	for _, incident := range summary.Incidents {
		message := ""
		updatedAt := incident.UpdatedAt
		if len(incident.Updates) > 0 {
			message = incident.Updates[0].Body
			if incident.Updates[0].UpdatedAt != "" {
				updatedAt = incident.Updates[0].UpdatedAt
			}
		}
		result.Incidents = append(result.Incidents, officialProviderIncident{
			Name:      incident.Name,
			Status:    incident.Status,
			Impact:    incident.Impact,
			Message:   message,
			UpdatedAt: updatedAt,
			URL:       incident.Shortlink,
		})
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
				providers[i] = officialProviderStatus{
					Provider:     source.Provider,
					Available:    false,
					StatusURL:    source.StatusURL,
					SubscribeURL: source.SubscribeURL,
					Incidents:    []officialProviderIncident{},
				}
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
