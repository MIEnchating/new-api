package controller

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/oauth"
	"github.com/gin-contrib/sessions"
	"github.com/gin-contrib/sessions/cookie"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

type oauthBindTestProvider struct {
	providerIDSet bool
}

func (p *oauthBindTestProvider) GetName() string { return "Test OAuth" }
func (p *oauthBindTestProvider) IsEnabled() bool { return true }
func (p *oauthBindTestProvider) ExchangeToken(context.Context, string, *gin.Context) (*oauth.OAuthToken, error) {
	return &oauth.OAuthToken{AccessToken: "test-token"}, nil
}
func (p *oauthBindTestProvider) GetUserInfo(context.Context, *oauth.OAuthToken) (*oauth.OAuthUser, error) {
	return &oauth.OAuthUser{ProviderUserID: "provider-user"}, nil
}
func (p *oauthBindTestProvider) IsUserIDTaken(string) bool { return false }
func (p *oauthBindTestProvider) FillUserByProviderID(*model.User, string) error {
	return nil
}
func (p *oauthBindTestProvider) SetProviderUserID(*model.User, string) {
	p.providerIDSet = true
}
func (p *oauthBindTestProvider) GetProviderPrefix() string { return "test_" }

func TestHandleOAuthRejectsNonStringStateWithoutPanicking(t *testing.T) {
	require.NoError(t, i18n.Init())
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.Use(sessions.Sessions("session", cookie.NewStore([]byte("oauth-malformed-state-test-secret"))))
	engine.GET("/seed", func(c *gin.Context) {
		session := sessions.Default(c)
		session.Set("oauth_state", 1234)
		require.NoError(t, session.Save())
		c.Status(http.StatusNoContent)
	})
	engine.GET("/oauth/:provider", HandleOAuth)

	seedResponse := httptest.NewRecorder()
	engine.ServeHTTP(seedResponse, httptest.NewRequest(http.MethodGet, "/seed", nil))
	require.Len(t, seedResponse.Result().Cookies(), 1)

	request := httptest.NewRequest(http.MethodGet, "/oauth/github?state=1234", nil)
	request.AddCookie(seedResponse.Result().Cookies()[0])
	response := httptest.NewRecorder()
	engine.ServeHTTP(response, request)

	assert.Equal(t, http.StatusForbidden, response.Code)
}

func TestOAuthBindSessionRequiresCompleteEnabledUser(t *testing.T) {
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.Use(sessions.Sessions("session", cookie.NewStore([]byte("oauth-bind-session-test-secret"))))
	engine.GET("/check/:kind", func(c *gin.Context) {
		session := sessions.Default(c)
		session.Set("username", "oauth-user")
		session.Set("id", 42)
		session.Set("role", common.RoleCommonUser)
		session.Set("status", common.UserStatusEnabled)
		switch c.Param("kind") {
		case "missing-id":
			session.Delete("id")
		case "invalid-role":
			session.Set("role", "admin")
		case "disabled":
			session.Set("status", common.UserStatusDisabled)
		}
		userID, ok := oauthBindSessionUserID(session)
		c.JSON(http.StatusOK, gin.H{"id": userID, "ok": ok})
	})

	tests := []struct {
		kind string
		id   int
		ok   bool
	}{
		{kind: "valid", id: 42, ok: true},
		{kind: "missing-id", ok: false},
		{kind: "invalid-role", ok: false},
		{kind: "disabled", ok: false},
	}
	for _, tt := range tests {
		t.Run(tt.kind, func(t *testing.T) {
			response := httptest.NewRecorder()
			engine.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/check/"+tt.kind, nil))
			require.Equal(t, http.StatusOK, response.Code)
			var body struct {
				ID int  `json:"id"`
				OK bool `json:"ok"`
			}
			require.NoError(t, json.Unmarshal(response.Body.Bytes(), &body))
			assert.Equal(t, tt.id, body.ID)
			assert.Equal(t, tt.ok, body.OK)
		})
	}
}

func TestHandleOAuthBindRejectsUserDisabledAfterSessionWasIssued(t *testing.T) {
	require.NoError(t, i18n.Init())
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.User{}))

	previousDB := model.DB
	model.DB = db
	t.Cleanup(func() { model.DB = previousDB })
	require.NoError(t, db.Create(&model.User{
		Id:       42,
		Username: "disabled-oauth-user",
		Role:     common.RoleCommonUser,
		Status:   common.UserStatusDisabled,
	}).Error)

	provider := &oauthBindTestProvider{}
	response := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(response)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/oauth/test?code=code", nil)

	handleOAuthBind(c, provider, 42)

	assert.Equal(t, http.StatusOK, response.Code)
	assert.False(t, provider.providerIDSet)
	assert.Contains(t, response.Body.String(), "success")
	assert.Contains(t, response.Body.String(), "false")
}
