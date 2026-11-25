package qqbot

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
)

func postJSON(ctx context.Context, client *http.Client, endpoint string, headers map[string]string, payload, result any) (int, error) {
	data, err := common.Marshal(payload)
	if err != nil {
		return 0, errors.New("could not encode request")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(data))
	if err != nil {
		return 0, errors.New("could not create request")
	}
	req.Header.Set("Content-Type", "application/json")
	for name, value := range headers {
		if value != "" {
			req.Header.Set(name, value)
		}
	}
	resp, err := client.Do(req)
	if err != nil {
		return 0, errors.New("could not reach the server")
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return resp.StatusCode, fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	return resp.StatusCode, decodeJSONResponse(resp.Body, result, maxJSONResponse)
}

func decodeJSONResponse(body io.Reader, result any, maxBytes int) error {
	raw, err := io.ReadAll(io.LimitReader(body, int64(maxBytes)+1))
	if err != nil || len(raw) > maxBytes || common.Unmarshal(raw, result) != nil {
		return errors.New("invalid or oversized JSON response")
	}
	return nil
}

func (b *Bot) token(ctx context.Context) (string, error) {
	select {
	case b.tokenGate <- struct{}{}:
		defer func() { <-b.tokenGate }()
	case <-ctx.Done():
		return "", ctx.Err()
	}
	if b.now().Before(b.tokenExpires) {
		return b.accessToken, nil
	}
	var result struct {
		Token     string            `json:"access_token"`
		ExpiresIn common.RawMessage `json:"expires_in"`
		Code      int               `json:"code"`
	}
	_, err := postJSON(ctx, b.qqClient, b.qqAPI+"/app/getAppAccessToken", nil, map[string]string{
		"appId": b.appID, "clientSecret": b.appSecret,
	}, &result)
	if err != nil {
		return "", fmt.Errorf("QQ access token request: %w", err)
	}
	if result.Code != 0 {
		return "", fmt.Errorf("QQ access token request returned code %d", result.Code)
	}
	expires, err := strconv.ParseInt(strings.Trim(string(result.ExpiresIn), "\""), 10, 64)
	if err != nil || expires <= 0 || result.Token == "" {
		return "", errors.New("QQ returned an invalid access token response")
	}
	expires = min(expires, 7200)
	b.accessToken = result.Token
	b.tokenExpires = b.now().Add(time.Duration(expires-min(55, expires/2)) * time.Second)
	return b.accessToken, nil
}

func (b *Bot) sendReply(ctx context.Context, event groupMessage, text string) error {
	path := "/v2/groups/" + event.GroupID + "/messages"
	if event.Private {
		path = "/v2/users/" + event.Author.UserOpenID + "/messages"
	}
	return b.sendQQText(ctx, path, text, event.ID)
}

func (b *Bot) sendQQText(ctx context.Context, path, text, incomingID string) error {
	token, err := b.token(ctx)
	if err != nil {
		return err
	}
	// QQ group text messages have a 2,000-character limit.
	if runes := []rune(text); len(runes) > 1800 {
		text = string(runes[:1799]) + "…"
	}
	var result struct {
		ID      string `json:"id"`
		ErrCode int    `json:"err_code"`
		Code    int    `json:"code"`
	}
	payload := map[string]any{"msg_type": 0, "content": text}
	if incomingID != "" {
		payload["msg_id"] = incomingID
		payload["msg_seq"] = 1
	}
	status, err := postJSON(ctx, b.qqClient, b.qqAPI+path, map[string]string{"Authorization": "QQBot " + token}, payload, &result)
	if status == http.StatusUnauthorized {
		select {
		case b.tokenGate <- struct{}{}:
			if token == b.accessToken {
				b.tokenExpires = time.Time{}
			}
			<-b.tokenGate
		case <-ctx.Done():
		}
	}
	if err != nil {
		return err
	}
	if result.ErrCode != 0 || result.Code != 0 {
		return fmt.Errorf("QQ reply returned error codes %d/%d", result.ErrCode, result.Code)
	}
	if result.ID == "" {
		return errors.New("QQ reply did not return a message ID")
	}
	return nil
}
