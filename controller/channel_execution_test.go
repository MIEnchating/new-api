package controller

import (
	"encoding/json"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGetChannelExecutionOptionsReturnsChannelsAndGroups(t *testing.T) {
	db := setupModelListControllerTestDB(t)
	require.NoError(t, db.Create(&model.Channel{
		Id:     11,
		Name:   "route-channel",
		Group:  "premium,default",
		Models: "gpt-5,gpt-4.1",
		Status: common.ChannelStatusEnabled,
	}).Error)
	require.NoError(t, db.Create(&model.Ability{
		Group:     "premium",
		Model:     "gpt-5",
		ChannelId: 11,
		Enabled:   true,
	}).Error)

	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	GetChannelExecutionOptions(ctx)

	var response struct {
		Success bool `json:"success"`
		Data    struct {
			Channels []channelExecutionOption      `json:"channels"`
			Groups   []channelExecutionGroupOption `json:"groups"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(recorder.Body.Bytes(), &response))
	require.True(t, response.Success)
	require.Len(t, response.Data.Channels, 1)
	assert.Equal(t, 11, response.Data.Channels[0].ID)

	groups := make(map[string][]string, len(response.Data.Groups))
	for _, group := range response.Data.Groups {
		groups[group.Name] = group.Models
	}
	assert.Equal(t, []string{"gpt-5"}, groups["premium"])
	_, hasDefault := groups["default"]
	assert.False(t, hasDefault)
}
