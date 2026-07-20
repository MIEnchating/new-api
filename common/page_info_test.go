package common

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func pageInfoForQuery(t *testing.T, query string) *PageInfo {
	t.Helper()
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodGet, "/?"+query, nil)
	return GetPageQuery(c)
}

func TestGetPageQueryNormalizesPageAndPageSize(t *testing.T) {
	tests := []struct {
		name      string
		query     string
		wantPage  int
		wantSize  int
		wantStart int
	}{
		{name: "defaults", query: "", wantPage: 1, wantSize: ItemsPerPage, wantStart: 0},
		{name: "negative page", query: "p=-4&page_size=20", wantPage: 1, wantSize: 20, wantStart: 0},
		{name: "zero page", query: "p=0&page_size=20", wantPage: 1, wantSize: 20, wantStart: 0},
		{name: "invalid page", query: "p=invalid&page_size=20", wantPage: 1, wantSize: 20, wantStart: 0},
		{name: "large page size is capped", query: "p=2&page_size=101", wantPage: 2, wantSize: 100, wantStart: 100},
		{name: "negative current size falls back to ps", query: "page_size=-1&ps=25", wantPage: 1, wantSize: 25, wantStart: 0},
		{name: "zero ps falls back to size", query: "page_size=0&ps=0&size=30", wantPage: 1, wantSize: 30, wantStart: 0},
		{name: "negative aliases fall back to default", query: "page_size=-1&ps=-2&size=-3", wantPage: 1, wantSize: ItemsPerPage, wantStart: 0},
		{name: "invalid current size falls back to alias", query: "page_size=invalid&ps=12", wantPage: 1, wantSize: 12, wantStart: 0},
		{name: "current size takes precedence", query: "p=3&page_size=7&ps=99&size=88", wantPage: 3, wantSize: 7, wantStart: 14},
		{name: "normal deep page is preserved", query: "p=10000&page_size=100", wantPage: 10000, wantSize: 100, wantStart: 999900},
		{name: "page is capped by maximum offset", query: "p=10002&page_size=100", wantPage: 10001, wantSize: 100, wantStart: maxPaginationOffset},
		{name: "maximum offset respects page size", query: "p=999999999&page_size=99", wantPage: 10102, wantSize: 99, wantStart: 999999},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := pageInfoForQuery(t, tt.query)
			if got.Page != tt.wantPage || got.PageSize != tt.wantSize || got.GetStartIdx() != tt.wantStart {
				t.Fatalf("GetPageQuery(%q) = page=%d page_size=%d start=%d, want page=%d page_size=%d start=%d", tt.query, got.Page, got.PageSize, got.GetStartIdx(), tt.wantPage, tt.wantSize, tt.wantStart)
			}
		})
	}
}

func TestGetPageQueryUsesSafeDefaultWhenItemsPerPageIsInvalid(t *testing.T) {
	previous := ItemsPerPage
	ItemsPerPage = 0
	t.Cleanup(func() { ItemsPerPage = previous })

	got := pageInfoForQuery(t, "page_size=-1&ps=0&size=-8")
	if got.Page != 1 || got.PageSize != 10 || got.GetStartIdx() != 0 {
		t.Fatalf("invalid default produced page=%d page_size=%d start=%d", got.Page, got.PageSize, got.GetStartIdx())
	}
}
