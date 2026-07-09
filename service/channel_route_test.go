package service

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/types"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

const channelRouteTestModel = "gpt-channel-route-test"

func setupChannelRouteTest(t *testing.T) *gorm.DB {
	t.Helper()

	gin.SetMode(gin.TestMode)
	oldRedisEnabled := common.RedisEnabled
	oldMemoryCacheEnabled := common.MemoryCacheEnabled
	oldChannelRouteCooldownEnabled := common.ChannelRouteCooldownEnabled
	oldChannelRouteCooldownSeconds := common.ChannelRouteCooldownSeconds
	common.RedisEnabled = false
	common.MemoryCacheEnabled = true
	common.ChannelRouteCooldownEnabled = true
	common.ChannelRouteCooldownSeconds = 60
	common.SetDatabaseTypes(common.DatabaseTypeSQLite, common.DatabaseTypeSQLite)
	channelRouteCooldowns = sync.Map{}
	tokenGroupRouteCooldowns = sync.Map{}

	db, err := gorm.Open(sqlite.Open("file:"+strings.ReplaceAll(t.Name(), "/", "_")+"?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	model.DB = db
	model.LOG_DB = db
	require.NoError(t, db.AutoMigrate(&model.Channel{}, &model.Ability{}))

	t.Cleanup(func() {
		common.RedisEnabled = oldRedisEnabled
		common.MemoryCacheEnabled = oldMemoryCacheEnabled
		common.ChannelRouteCooldownEnabled = oldChannelRouteCooldownEnabled
		common.ChannelRouteCooldownSeconds = oldChannelRouteCooldownSeconds
		channelRouteCooldowns = sync.Map{}
		tokenGroupRouteCooldowns = sync.Map{}
		sqlDB, dbErr := db.DB()
		if dbErr == nil {
			_ = sqlDB.Close()
		}
	})

	return db
}

func seedChannelRouteChannel(t *testing.T, db *gorm.DB, id int, group string, priority int64) {
	t.Helper()

	weight := uint(0)
	channel := model.Channel{
		Id:       id,
		Type:     constant.ChannelTypeOpenAI,
		Key:      "sk-test",
		Status:   common.ChannelStatusEnabled,
		Name:     group,
		Group:    group,
		Models:   channelRouteTestModel,
		Priority: &priority,
		Weight:   &weight,
	}
	require.NoError(t, db.Create(&channel).Error)
	require.NoError(t, db.Create(&model.Ability{
		Group:     group,
		Model:     channelRouteTestModel,
		ChannelId: id,
		Enabled:   true,
		Priority:  &priority,
		Weight:    weight,
	}).Error)
}

func newChannelRouteContext() *gin.Context {
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	return ctx
}

func newChannelRouteRetryParam(ctx *gin.Context, group string) *RetryParam {
	return &RetryParam{
		Ctx:         ctx,
		TokenGroup:  group,
		ModelName:   channelRouteTestModel,
		RequestPath: "/v1/chat/completions",
		Retry:       common.GetPointer(0),
	}
}

func TestChannelRouteCooldownSkipsFailedChannelAndReturnsAfterClear(t *testing.T) {
	db := setupChannelRouteTest(t)
	seedChannelRouteChannel(t, db, 1, "default", 2)
	seedChannelRouteChannel(t, db, 2, "default", 1)
	model.InitChannelCache()

	ctx := newChannelRouteContext()
	channel, group, err := CacheGetRandomSatisfiedChannel(newChannelRouteRetryParam(ctx, "default"))
	require.NoError(t, err)
	require.NotNil(t, channel)
	assert.Equal(t, "default", group)
	assert.Equal(t, 1, channel.Id)

	routeErr := types.NewErrorWithStatusCode(
		errors.New("upstream unavailable"),
		types.ErrorCodeChannelInvalidKey,
		http.StatusInternalServerError,
	)
	assert.True(t, MarkChannelRouteFailure(ctx, routeErr))
	assert.True(t, IsChannelRouteFrozen("default", 1, common.GetTimestamp()))

	nextCtx := newChannelRouteContext()
	channel, group, err = CacheGetRandomSatisfiedChannel(newChannelRouteRetryParam(nextCtx, "default"))
	require.NoError(t, err)
	require.NotNil(t, channel)
	assert.Equal(t, "default", group)
	assert.Equal(t, 2, channel.Id)

	ClearChannelRouteCooldown("default", 1)
	recoveredCtx := newChannelRouteContext()
	channel, group, err = CacheGetRandomSatisfiedChannel(newChannelRouteRetryParam(recoveredCtx, "default"))
	require.NoError(t, err)
	require.NotNil(t, channel)
	assert.Equal(t, "default", group)
	assert.Equal(t, 1, channel.Id)
}

func TestChannelRouteCooldownKeepsTokenGroupBeforeFallingBackGroup(t *testing.T) {
	db := setupChannelRouteTest(t)
	seedChannelRouteChannel(t, db, 1, "premium", 2)
	seedChannelRouteChannel(t, db, 2, "premium", 1)
	seedChannelRouteChannel(t, db, 3, "fallback", 1)
	model.InitChannelCache()

	FreezeChannelRoute("premium", 1, 60)
	ctx := newTokenRouteContext([]model.TokenGroupRoute{
		{Group: "premium", Priority: 2, CooldownSeconds: 60},
		{Group: "fallback", Priority: 1, CooldownSeconds: 60},
	})

	channel, group, err := CacheGetRandomSatisfiedChannel(newChannelRouteRetryParam(ctx, "default"))
	require.NoError(t, err)
	require.NotNil(t, channel)
	assert.Equal(t, "premium", group)
	assert.Equal(t, 2, channel.Id)
}
