package controller

import (
	"encoding/json"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

func TestGetCustomMenuPagesFiltersAdminPages(t *testing.T) {
	gin.SetMode(gin.TestMode)
	common.OptionMapRWMutex.Lock()
	if common.OptionMap == nil {
		common.OptionMap = make(map[string]string)
	}
	previous := common.OptionMap[model.CustomMenuPagesOptionKey]
	common.OptionMap[model.CustomMenuPagesOptionKey] = `[
		{"id":"page_public1","name":"帮助中心","url":"https://example.com/help","visibility":"public"},
		{"id":"page_admin01","name":"内部面板","url":"https://example.com/admin","visibility":"admin"},
		{"id":"page_disabled","name":"暂停页面","url":"https://example.com/disabled","visibility":"public","enabled":false}
	]`
	common.OptionMapRWMutex.Unlock()
	t.Cleanup(func() {
		common.OptionMapRWMutex.Lock()
		common.OptionMap[model.CustomMenuPagesOptionKey] = previous
		common.OptionMapRWMutex.Unlock()
	})

	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Set("role", common.RoleCommonUser)
	GetCustomMenuPages(context)

	var response struct {
		Data []model.CustomMenuPage `json:"data"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if len(response.Data) != 1 || response.Data[0].Visibility != model.CustomMenuVisibilityPublic {
		t.Fatalf("unexpected visible pages: %#v", response.Data)
	}
}
