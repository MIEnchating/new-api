package vertex

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/service"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// stubAccessTokenFetch replaces the Google token exchange for one test and
// clears the token cache before and after it.
func stubAccessTokenFetch(t *testing.T, fetch func(Credentials, string) (string, time.Duration, error)) {
	t.Helper()
	accessTokens.Clear()
	original := fetchAccessToken
	fetchAccessToken = fetch
	t.Cleanup(func() {
		fetchAccessToken = original
		accessTokens.Clear()
	})
}

func newAccessTokenTestInfo(channelID int) *relaycommon.RelayInfo {
	return &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{ChannelId: channelID}}
}

func newAccessTokenTestAdaptor(keyID string) *Adaptor {
	return &Adaptor{AccountCredentials: Credentials{ClientEmail: "sa@project.iam.gserviceaccount.com", PrivateKeyID: keyID}}
}

func TestGetAccessTokenReusesTokenUntilNearExpiry(t *testing.T) {
	var calls atomic.Int32
	stubAccessTokenFetch(t, func(Credentials, string) (string, time.Duration, error) {
		return fmt.Sprintf("token-%d", calls.Add(1)), time.Hour, nil
	})
	info := newAccessTokenTestInfo(7)
	a := newAccessTokenTestAdaptor("key-1")

	first, err := getAccessToken(a, info)
	require.NoError(t, err)
	second, err := getAccessToken(a, info)
	require.NoError(t, err)
	assert.Equal(t, "token-1", first)
	assert.Equal(t, first, second)
	assert.Equal(t, int32(1), calls.Load())

	// A token inside the refresh margin is replaced.
	value, ok := accessTokens.Load("7")
	require.True(t, ok)
	entry := value.(cachedAccessToken)
	entry.expiresAt = time.Now().Add(-time.Second)
	accessTokens.Store("7", entry)

	third, err := getAccessToken(a, info)
	require.NoError(t, err)
	assert.Equal(t, "token-2", third)
	assert.Equal(t, int32(2), calls.Load())
}

func TestGetAccessTokenSeparatesKeySlotsAndReplacedKeys(t *testing.T) {
	var calls atomic.Int32
	stubAccessTokenFetch(t, func(creds Credentials, _ string) (string, time.Duration, error) {
		calls.Add(1)
		return creds.PrivateKeyID, time.Hour, nil
	})

	multiKey := newAccessTokenTestInfo(9)
	multiKey.ChannelIsMultiKey = true
	multiKey.ChannelMultiKeyIndex = 1
	slotOne, err := getAccessToken(newAccessTokenTestAdaptor("slot-1"), multiKey)
	require.NoError(t, err)
	multiKey.ChannelMultiKeyIndex = 2
	slotTwo, err := getAccessToken(newAccessTokenTestAdaptor("slot-2"), multiKey)
	require.NoError(t, err)
	assert.Equal(t, "slot-1", slotOne)
	assert.Equal(t, "slot-2", slotTwo)

	// Replacing the channel's key fetches a token for the new key.
	single := newAccessTokenTestInfo(10)
	_, err = getAccessToken(newAccessTokenTestAdaptor("old"), single)
	require.NoError(t, err)
	replaced, err := getAccessToken(newAccessTokenTestAdaptor("new"), single)
	require.NoError(t, err)
	assert.Equal(t, "new", replaced)
	assert.Equal(t, int32(4), calls.Load())
}

func TestGetAccessTokenSharesOneExchangeAcrossConcurrentRequests(t *testing.T) {
	var calls atomic.Int32
	started := make(chan struct{})
	release := make(chan struct{})
	stubAccessTokenFetch(t, func(Credentials, string) (string, time.Duration, error) {
		if calls.Add(1) == 1 {
			close(started)
		}
		<-release
		return "shared", time.Hour, nil
	})
	info := newAccessTokenTestInfo(11)
	a := newAccessTokenTestAdaptor("key-1")

	const workers = 8
	var wg sync.WaitGroup
	results := make([]string, workers)
	errors := make([]error, workers)
	for i := range workers {
		wg.Go(func() {
			results[i], errors[i] = getAccessToken(a, info)
		})
	}
	<-started
	close(release)
	wg.Wait()

	assert.Equal(t, int32(1), calls.Load())
	for i, token := range results {
		require.NoError(t, errors[i])
		assert.Equal(t, "shared", token)
	}
}

func TestGetAccessTokenReplacesChangedPrivateKeyWithoutKeyID(t *testing.T) {
	var calls atomic.Int32
	stubAccessTokenFetch(t, func(Credentials, string) (string, time.Duration, error) {
		return fmt.Sprintf("token-%d", calls.Add(1)), time.Hour, nil
	})
	info := newAccessTokenTestInfo(13)
	a := newAccessTokenTestAdaptor("")
	a.AccountCredentials.PrivateKey = "first-test-key"
	first, err := getAccessToken(a, info)
	require.NoError(t, err)
	a.AccountCredentials.PrivateKey = "replacement-test-key"
	second, err := getAccessToken(a, info)
	require.NoError(t, err)
	assert.Equal(t, "token-1", first)
	assert.Equal(t, "token-2", second)
}

func TestGetAccessTokenDoesNotCacheShortLivedTokens(t *testing.T) {
	var calls atomic.Int32
	stubAccessTokenFetch(t, func(Credentials, string) (string, time.Duration, error) {
		return fmt.Sprintf("token-%d", calls.Add(1)), time.Minute, nil
	})
	info := newAccessTokenTestInfo(14)
	a := newAccessTokenTestAdaptor("short-lived")
	first, err := getAccessToken(a, info)
	require.NoError(t, err)
	second, err := getAccessToken(a, info)
	require.NoError(t, err)
	assert.Equal(t, "token-1", first)
	assert.Equal(t, "token-2", second)
}

type accessTokenTransport func(*http.Request) (*http.Response, error)

func (f accessTokenTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	return f(r)
}

func TestExchangeAccessTokenValidatesResponse(t *testing.T) {
	client, err := service.GetHttpClientWithProxy("")
	require.NoError(t, err)
	original := client.Transport
	t.Cleanup(func() { client.Transport = original })
	for _, tc := range []struct {
		name     string
		status   int
		body     string
		lifetime time.Duration
	}{
		{"provider expiry", 200, `{"access_token":"test-token","expires_in":1800}`, 30 * time.Minute},
		{"missing expiry", 200, `{"access_token":"test-token"}`, time.Hour},
		{"fractional expiry", 200, `{"access_token":"test-token","expires_in":0.5}`, 500 * time.Millisecond},
		{"zero expiry", 200, `{"access_token":"test-token","expires_in":0}`, 0},
		{"negative expiry", 200, `{"access_token":"test-token","expires_in":-1}`, 0},
		{"null expiry", 200, `{"access_token":"test-token","expires_in":null}`, 0},
		{"invalid expiry type", 200, `{"access_token":"test-token","expires_in":"3600"}`, 0},
		{"overflow expiry", 200, `{"access_token":"test-token","expires_in":1e30}`, 0},
		{"empty token", 200, `{"access_token":"","expires_in":3600}`, 0},
		{"missing token", 200, `{"error_description":"private-response-value"}`, 0},
		{"failed HTTP status", 401, `{"access_token":"test-token","expires_in":3600}`, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			client.Transport = accessTokenTransport(func(r *http.Request) (*http.Response, error) {
				assert.Equal(t, "https://www.googleapis.com/oauth2/v4/token", r.URL.String())
				return &http.Response{StatusCode: tc.status, Body: io.NopCloser(strings.NewReader(tc.body)), Header: make(http.Header)}, nil
			})
			token, lifetime, err := exchangeJwtForAccessToken("test-assertion", "")
			if tc.lifetime == 0 {
				require.Error(t, err)
				assert.Empty(t, token)
				assert.Zero(t, lifetime)
				assert.NotContains(t, err.Error(), "test-token")
				assert.NotContains(t, err.Error(), "private-response-value")
				return
			}
			require.NoError(t, err)
			assert.Equal(t, "test-token", token)
			assert.Equal(t, tc.lifetime, lifetime)
		})
	}
}

func TestGetAccessTokenDoesNotCacheFailures(t *testing.T) {
	var calls atomic.Int32
	stubAccessTokenFetch(t, func(Credentials, string) (string, time.Duration, error) {
		if calls.Add(1) == 1 {
			return "", 0, errors.New("exchange failed")
		}
		return "recovered", time.Hour, nil
	})
	info := newAccessTokenTestInfo(12)
	a := newAccessTokenTestAdaptor("key-1")

	_, err := getAccessToken(a, info)
	require.ErrorContains(t, err, "exchange failed")
	token, err := getAccessToken(a, info)
	require.NoError(t, err)
	assert.Equal(t, "recovered", token)
}
