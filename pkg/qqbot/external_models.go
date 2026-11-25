package qqbot

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/service"
)

var ErrExternalModelFetch = errors.New("Failed to fetch models")

type ExternalModelsInput struct {
	ChatBaseURL  string `json:"chat_base_url"`
	ChatProtocol string `json:"chat_protocol"`
	ChatKey      string `json:"chat_key"`
}

func (r *Runtime) FetchExternalModels(ctx context.Context, encoded string, input ExternalModelsInput) ([]string, error) {
	client := service.NewPublicHTTPSClient()
	defer client.CloseIdleConnections()
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	return r.fetchExternalModels(ctx, encoded, input, client)
}

func (r *Runtime) fetchExternalModels(ctx context.Context, encoded string, input ExternalModelsInput, client *http.Client) ([]string, error) {
	baseURL := strings.TrimRight(strings.TrimSpace(input.ChatBaseURL), "/")
	key := strings.TrimSpace(input.ChatKey)
	if ChatPath(input.ChatProtocol) == "" || len(key) > 1024 || strings.ContainsAny(key, "\r\n") {
		return nil, common.NewMessage("Invalid parameters")
	}
	base, err := parseExternalBaseURL(baseURL)
	if err != nil {
		return nil, err
	}
	if key == "" {
		saved, err := r.read(encoded)
		if err != nil || saved.ChatSource != ChatSourceExternal || saved.ChatBaseURL != baseURL || saved.ChatKey == "" {
			return nil, common.NewMessage("API key is required")
		}
		key = saved.ChatKey
	}

	endpoint := base.JoinPath("models")
	headers := chatHeaders(input.ChatProtocol, key)
	models := make([]string, 0)
	seen := make(map[string]struct{})
	cursors := make(map[string]struct{})
	for range 10 {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint.String(), nil)
		if err != nil {
			return nil, ErrExternalModelFetch
		}
		req.Header.Set("Accept", "application/json")
		for name, value := range headers {
			req.Header.Set(name, value)
		}
		response, err := client.Do(req)
		if err != nil {
			return nil, ErrExternalModelFetch
		}
		var page struct {
			Data []struct {
				ID string `json:"id"`
			} `json:"data"`
			HasMore bool   `json:"has_more"`
			LastID  string `json:"last_id"`
		}
		if response.StatusCode == http.StatusOK {
			err = decodeJSONResponse(response.Body, &page, 2<<20)
		}
		response.Body.Close()
		if response.StatusCode != http.StatusOK || err != nil || page.Data == nil {
			return nil, ErrExternalModelFetch
		}
		for _, model := range page.Data {
			id := strings.TrimSpace(model.ID)
			if id == "" || len(id) > 256 || id == key || strings.ContainsAny(id, "\r\n") {
				continue
			}
			if _, exists := seen[id]; !exists {
				seen[id] = struct{}{}
				models = append(models, id)
			}
		}
		if input.ChatProtocol != ChatProtocolMessages || !page.HasMore {
			slices.Sort(models)
			return models, nil
		}
		if _, repeated := cursors[page.LastID]; repeated || page.LastID == "" || page.LastID == key || len(page.LastID) > 256 {
			return nil, ErrExternalModelFetch
		}
		cursors[page.LastID] = struct{}{}
		endpoint.RawQuery = "after_id=" + url.QueryEscape(page.LastID)
	}
	return nil, ErrExternalModelFetch
}
