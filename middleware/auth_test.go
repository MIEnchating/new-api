package middleware

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-contrib/sessions"
	"github.com/gin-contrib/sessions/cookie"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupAuthTestDatabase(t *testing.T) {
	t.Helper()
	previousDB := model.DB
	previousRedisEnabled := common.RedisEnabled
	dsn := fmt.Sprintf("file:%s?mode=memory&cache=shared", strings.ReplaceAll(t.Name(), "/", "_"))
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.User{}))
	model.DB = db
	common.RedisEnabled = false
	t.Cleanup(func() {
		model.DB = previousDB
		common.RedisEnabled = previousRedisEnabled
		if sqlDB, dbErr := db.DB(); dbErr == nil {
			_ = sqlDB.Close()
		}
	})
}

func TestUserSelfAuthRestoresIdentityFromSession(t *testing.T) {
	setupAuthTestDatabase(t)
	require.NoError(t, model.DB.Create(&model.User{
		Id:       42,
		Username: "oauth-user",
		Role:     common.RoleCommonUser,
		Status:   common.UserStatusEnabled,
		Group:    "default",
	}).Error)
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.Use(sessions.Sessions("session", cookie.NewStore([]byte("user-self-auth-test-secret"))))
	engine.GET("/seed", func(c *gin.Context) {
		session := sessions.Default(c)
		session.Set("id", 42)
		session.Set("username", "oauth-user")
		session.Set("role", common.RoleCommonUser)
		session.Set("status", common.UserStatusEnabled)
		session.Set("group", "default")
		require.NoError(t, session.Save())
		c.Status(http.StatusNoContent)
	})
	engine.GET("/self", UserSelfAuth(), func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"id": c.GetInt("id")})
	})
	engine.GET("/protected", UserAuth(), func(c *gin.Context) {
		c.Status(http.StatusNoContent)
	})

	seedResponse := httptest.NewRecorder()
	engine.ServeHTTP(seedResponse, httptest.NewRequest(http.MethodGet, "/seed", nil))
	require.Len(t, seedResponse.Result().Cookies(), 1)
	sessionCookie := seedResponse.Result().Cookies()[0]

	request := func(path string, userID string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		req.AddCookie(sessionCookie)
		if userID != "" {
			req.Header.Set("New-Api-User", userID)
		}
		response := httptest.NewRecorder()
		engine.ServeHTTP(response, req)
		return response
	}

	selfWithoutHeader := request("/self", "")
	require.Equal(t, http.StatusOK, selfWithoutHeader.Code)
	assert.JSONEq(t, `{"id":42}`, selfWithoutHeader.Body.String())

	assert.Equal(t, http.StatusOK, request("/self", "42").Code)
	assert.Equal(t, http.StatusUnauthorized, request("/self", "41").Code)
	assert.Equal(t, http.StatusUnauthorized, request("/protected", "").Code)
}

func TestSessionAuthUsesCurrentStatusAndRole(t *testing.T) {
	tests := []struct {
		name           string
		middleware     gin.HandlerFunc
		update         map[string]any
		expectedStatus int
	}{
		{
			name:           "disabled user",
			middleware:     UserAuth(),
			update:         map[string]any{"status": common.UserStatusDisabled},
			expectedStatus: http.StatusOK,
		},
		{
			name:           "demoted administrator",
			middleware:     AdminAuth(),
			update:         map[string]any{"role": common.RoleCommonUser},
			expectedStatus: http.StatusOK,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			setupAuthTestDatabase(t)
			user := model.User{
				Id:       7301,
				Username: "current-auth-user",
				Role:     common.RoleAdminUser,
				Status:   common.UserStatusEnabled,
				Group:    "default",
			}
			require.NoError(t, model.DB.Create(&user).Error)

			gin.SetMode(gin.TestMode)
			engine := gin.New()
			engine.Use(sessions.Sessions("session", cookie.NewStore([]byte("current-auth-test-secret"))))
			engine.GET("/seed", func(c *gin.Context) {
				session := sessions.Default(c)
				session.Set("id", user.Id)
				session.Set("username", user.Username)
				session.Set("role", user.Role)
				session.Set("status", user.Status)
				session.Set("group", user.Group)
				require.NoError(t, session.Save())
				c.Status(http.StatusNoContent)
			})
			handlerReached := false
			engine.GET("/protected", test.middleware, func(c *gin.Context) {
				handlerReached = true
				c.Status(http.StatusNoContent)
			})

			seedResponse := httptest.NewRecorder()
			engine.ServeHTTP(seedResponse, httptest.NewRequest(http.MethodGet, "/seed", nil))
			require.Len(t, seedResponse.Result().Cookies(), 1)
			require.NoError(t, model.DB.Model(&model.User{}).Where("id = ?", user.Id).Updates(test.update).Error)

			req := httptest.NewRequest(http.MethodGet, "/protected", nil)
			req.AddCookie(seedResponse.Result().Cookies()[0])
			req.Header.Set("New-Api-User", fmt.Sprint(user.Id))
			response := httptest.NewRecorder()
			engine.ServeHTTP(response, req)

			assert.Equal(t, test.expectedStatus, response.Code)
			assert.False(t, handlerReached)
			assert.Contains(t, response.Body.String(), `"success":false`)
		})
	}
}

func TestTokenOrUserAuthDoesNotTrustSessionStatus(t *testing.T) {
	setupAuthTestDatabase(t)
	user := model.User{
		Id:       7401,
		Username: "disabled-video-user",
		Role:     common.RoleCommonUser,
		Status:   common.UserStatusDisabled,
		Group:    "default",
	}
	require.NoError(t, model.DB.Create(&user).Error)

	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.Use(sessions.Sessions("session", cookie.NewStore([]byte("token-or-user-auth-test-secret"))))
	engine.GET("/seed", func(c *gin.Context) {
		session := sessions.Default(c)
		session.Set("id", user.Id)
		session.Set("username", user.Username)
		session.Set("role", user.Role)
		session.Set("status", common.UserStatusEnabled)
		session.Set("group", user.Group)
		require.NoError(t, session.Save())
		c.Status(http.StatusNoContent)
	})
	handlerReached := false
	engine.GET("/video", TokenOrUserAuth(), func(c *gin.Context) {
		handlerReached = true
		c.Status(http.StatusNoContent)
	})

	seedResponse := httptest.NewRecorder()
	engine.ServeHTTP(seedResponse, httptest.NewRequest(http.MethodGet, "/seed", nil))
	require.Len(t, seedResponse.Result().Cookies(), 1)
	req := httptest.NewRequest(http.MethodGet, "/video", nil)
	req.AddCookie(seedResponse.Result().Cookies()[0])
	response := httptest.NewRecorder()
	engine.ServeHTTP(response, req)

	assert.Equal(t, http.StatusOK, response.Code)
	assert.False(t, handlerReached)
	assert.Contains(t, response.Body.String(), `"success":false`)
}

func TestTryUserAuthIgnoresDisabledSessionUser(t *testing.T) {
	setupAuthTestDatabase(t)
	user := model.User{
		Id:       7501,
		Username: "disabled-public-user",
		Role:     common.RoleCommonUser,
		Status:   common.UserStatusDisabled,
		Group:    "default",
	}
	require.NoError(t, model.DB.Create(&user).Error)

	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.Use(sessions.Sessions("session", cookie.NewStore([]byte("try-user-auth-test-secret"))))
	engine.GET("/seed", func(c *gin.Context) {
		session := sessions.Default(c)
		session.Set("id", user.Id)
		require.NoError(t, session.Save())
		c.Status(http.StatusNoContent)
	})
	engine.GET("/public", TryUserAuth(), func(c *gin.Context) {
		_, authenticated := c.Get("id")
		c.JSON(http.StatusOK, gin.H{"authenticated": authenticated})
	})

	seedResponse := httptest.NewRecorder()
	engine.ServeHTTP(seedResponse, httptest.NewRequest(http.MethodGet, "/seed", nil))
	require.Len(t, seedResponse.Result().Cookies(), 1)
	req := httptest.NewRequest(http.MethodGet, "/public", nil)
	req.AddCookie(seedResponse.Result().Cookies()[0])
	response := httptest.NewRecorder()
	engine.ServeHTTP(response, req)

	assert.Equal(t, http.StatusOK, response.Code)
	assert.JSONEq(t, `{"authenticated":false}`, response.Body.String())
}

func TestUserSelfAuthClearsMalformedSession(t *testing.T) {
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.Use(sessions.Sessions("session", cookie.NewStore([]byte("malformed-auth-session-test-secret"))))
	engine.GET("/seed", func(c *gin.Context) {
		session := sessions.Default(c)
		session.Set("id", 42)
		session.Set("username", "stale-user")
		session.Set("role", "not-an-integer")
		session.Set("status", common.UserStatusEnabled)
		session.Set("group", "default")
		require.NoError(t, session.Save())
		c.Status(http.StatusNoContent)
	})
	engine.GET("/self", UserSelfAuth(), func(c *gin.Context) {
		c.Status(http.StatusNoContent)
	})
	engine.GET("/inspect", func(c *gin.Context) {
		session := sessions.Default(c)
		c.JSON(http.StatusOK, gin.H{
			"id":       session.Get("id"),
			"username": session.Get("username"),
			"role":     session.Get("role"),
			"status":   session.Get("status"),
			"group":    session.Get("group"),
		})
	})

	seedResponse := httptest.NewRecorder()
	engine.ServeHTTP(seedResponse, httptest.NewRequest(http.MethodGet, "/seed", nil))
	require.Len(t, seedResponse.Result().Cookies(), 1)

	authRequest := httptest.NewRequest(http.MethodGet, "/self", nil)
	authRequest.AddCookie(seedResponse.Result().Cookies()[0])
	authResponse := httptest.NewRecorder()
	engine.ServeHTTP(authResponse, authRequest)
	require.Equal(t, http.StatusUnauthorized, authResponse.Code)

	var clearedCookie *http.Cookie
	for _, responseCookie := range authResponse.Result().Cookies() {
		if responseCookie.Name == "session" {
			clearedCookie = responseCookie
		}
	}
	require.NotNil(t, clearedCookie)

	inspectRequest := httptest.NewRequest(http.MethodGet, "/inspect", nil)
	inspectRequest.AddCookie(clearedCookie)
	inspectResponse := httptest.NewRecorder()
	engine.ServeHTTP(inspectResponse, inspectRequest)
	require.Equal(t, http.StatusOK, inspectResponse.Code)
	assert.JSONEq(t, `{"id":null,"username":null,"role":null,"status":null,"group":null}`, inspectResponse.Body.String())
}
