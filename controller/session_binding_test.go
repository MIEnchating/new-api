package controller

import (
	"bytes"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

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

func setupSessionBindingTest(t *testing.T) {
	t.Helper()
	previousDB := model.DB
	previousRedisEnabled := common.RedisEnabled
	previousWeChatEnabled := common.WeChatAuthEnabled
	previousTelegramEnabled := common.TelegramOAuthEnabled
	previousTelegramToken := common.TelegramBotToken
	dsn := fmt.Sprintf("file:%s?mode=memory&cache=shared", strings.ReplaceAll(t.Name(), "/", "_"))
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.User{}))
	model.DB = db
	common.RedisEnabled = false
	common.WeChatAuthEnabled = true
	common.TelegramOAuthEnabled = true
	common.TelegramBotToken = "session-binding-telegram-token"
	t.Cleanup(func() {
		model.DB = previousDB
		common.RedisEnabled = previousRedisEnabled
		common.WeChatAuthEnabled = previousWeChatEnabled
		common.TelegramOAuthEnabled = previousTelegramEnabled
		common.TelegramBotToken = previousTelegramToken
		if sqlDB, dbErr := db.DB(); dbErr == nil {
			_ = sqlDB.Close()
		}
	})
}

func bindingSessionCookie(t *testing.T, engine *gin.Engine, id any) *http.Cookie {
	t.Helper()
	engine.GET("/seed", func(c *gin.Context) {
		session := sessions.Default(c)
		session.Set("id", id)
		require.NoError(t, session.Save())
		c.Status(http.StatusNoContent)
	})
	response := httptest.NewRecorder()
	engine.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/seed", nil))
	require.Len(t, response.Result().Cookies(), 1)
	return response.Result().Cookies()[0]
}

func bindingTestEngine() *gin.Engine {
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.Use(sessions.Sessions("session", cookie.NewStore([]byte("session-binding-test-secret"))))
	engine.POST("/email", EmailBind)
	engine.POST("/wechat", WeChatBind)
	engine.GET("/telegram", TelegramBind)
	return engine
}

func performBindingRequest(engine *gin.Engine, cookie *http.Cookie, method, path, body string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(method, path, bytes.NewBufferString(body))
	request.Header.Set("Content-Type", "application/json")
	request.AddCookie(cookie)
	response := httptest.NewRecorder()
	engine.ServeHTTP(response, request)
	return response
}

func TestBindingEndpointsRejectMalformedSession(t *testing.T) {
	setupSessionBindingTest(t)
	engine := bindingTestEngine()
	sessionCookie := bindingSessionCookie(t, engine, "not-an-integer")

	requests := []struct {
		method string
		path   string
		body   string
	}{
		{method: http.MethodPost, path: "/email", body: `{"email":"user@example.com","code":"123456"}`},
		{method: http.MethodPost, path: "/wechat", body: `{"code":"provider-code"}`},
		{method: http.MethodGet, path: "/telegram"},
	}
	for _, request := range requests {
		response := performBindingRequest(engine, sessionCookie, request.method, request.path, request.body)
		assert.Equal(t, http.StatusOK, response.Code)
		assert.Contains(t, response.Body.String(), `"success":false`)
		assert.Contains(t, response.Body.String(), "无效的会话信息")
	}
}

func TestBindingEndpointsRejectDisabledUser(t *testing.T) {
	setupSessionBindingTest(t)
	user := model.User{
		Id:       7601,
		Username: "disabled-binding-user",
		Role:     common.RoleCommonUser,
		Status:   common.UserStatusDisabled,
		Group:    "default",
	}
	require.NoError(t, model.DB.Create(&user).Error)
	engine := bindingTestEngine()
	sessionCookie := bindingSessionCookie(t, engine, user.Id)

	requests := []struct {
		method string
		path   string
		body   string
	}{
		{method: http.MethodPost, path: "/email", body: `{"email":"user@example.com","code":"123456"}`},
		{method: http.MethodPost, path: "/wechat", body: `{"code":"provider-code"}`},
		{method: http.MethodGet, path: "/telegram"},
	}
	for _, request := range requests {
		response := performBindingRequest(engine, sessionCookie, request.method, request.path, request.body)
		assert.Equal(t, http.StatusOK, response.Code)
		assert.Contains(t, response.Body.String(), `"success":false`)
		assert.Contains(t, response.Body.String(), "该用户已被禁用")
	}
}

func TestEmailBindAcceptsEnabledSessionUser(t *testing.T) {
	setupSessionBindingTest(t)
	user := model.User{
		Id:       7701,
		Username: "enabled-binding-user",
		Role:     common.RoleCommonUser,
		Status:   common.UserStatusEnabled,
		Group:    "default",
	}
	require.NoError(t, model.DB.Create(&user).Error)
	const email = "bound@example.com"
	const code = "654321"
	common.RegisterVerificationCodeWithKey(email, code, common.EmailVerificationPurpose)
	t.Cleanup(func() { common.DeleteKey(email, common.EmailVerificationPurpose) })

	engine := bindingTestEngine()
	sessionCookie := bindingSessionCookie(t, engine, user.Id)
	response := performBindingRequest(
		engine,
		sessionCookie,
		http.MethodPost,
		"/email",
		`{"email":"bound@example.com","code":"654321"}`,
	)

	require.Equal(t, http.StatusOK, response.Code)
	assert.Contains(t, response.Body.String(), `"success":true`)
	var updated model.User
	require.NoError(t, model.DB.First(&updated, user.Id).Error)
	assert.Equal(t, email, updated.Email)
}

func TestVerify2FALoginRejectsUserDisabledAfterPasswordStep(t *testing.T) {
	setupSessionBindingTest(t)
	user := model.User{
		Id:       7801,
		Username: "disabled-pending-2fa-user",
		Role:     common.RoleCommonUser,
		Status:   common.UserStatusDisabled,
		Group:    "default",
	}
	require.NoError(t, model.DB.Create(&user).Error)

	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.Use(sessions.Sessions("session", cookie.NewStore([]byte("pending-2fa-disabled-test-secret"))))
	engine.GET("/seed", func(c *gin.Context) {
		session := sessions.Default(c)
		setPending2FALogin(session, &user)
		require.NoError(t, session.Save())
		c.Status(http.StatusNoContent)
	})
	engine.POST("/verify", Verify2FALogin)

	seedResponse := httptest.NewRecorder()
	engine.ServeHTTP(seedResponse, httptest.NewRequest(http.MethodGet, "/seed", nil))
	require.Len(t, seedResponse.Result().Cookies(), 1)
	response := performBindingRequest(
		engine,
		seedResponse.Result().Cookies()[0],
		http.MethodPost,
		"/verify",
		`{"code":"123456"}`,
	)

	assert.Equal(t, http.StatusOK, response.Code)
	assert.Contains(t, response.Body.String(), `"success":false`)
	assert.Contains(t, response.Body.String(), "该用户已被禁用")
}

func TestTelegramLoginRejectsDisabledUser(t *testing.T) {
	setupSessionBindingTest(t)
	user := model.User{
		Id:         7901,
		Username:   "disabled-telegram-user",
		Role:       common.RoleCommonUser,
		Status:     common.UserStatusDisabled,
		Group:      "default",
		TelegramId: "123456",
	}
	require.NoError(t, model.DB.Create(&user).Error)
	params := signedTelegramAuthorization(common.TelegramBotToken, time.Now())

	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.Use(sessions.Sessions("session", cookie.NewStore([]byte("telegram-disabled-test-secret"))))
	engine.GET("/login", TelegramLogin)
	response := httptest.NewRecorder()
	engine.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/login?"+params.Encode(), nil))

	assert.Equal(t, http.StatusOK, response.Code)
	assert.Contains(t, response.Body.String(), `"success":false`)
	assert.Contains(t, response.Body.String(), "用户已被封禁")
}
