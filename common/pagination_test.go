package common

import (
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPaginationKeepsQueriesBounded(t *testing.T) {
	for _, tc := range []struct {
		query      string
		page, size int
	}{
		{"p=-2&page_size=-1&ps=25", 1, 25},
		{"p=3&page_size=7&ps=99", 3, 7},
		{"p=10000&page_size=100", 10000, 100},
		{"p=9223372036854775807&page_size=1000", 10001, 100},
		{"p=999999999&page_size=99", 10102, 99},
		{"page_size=invalid&ps=0&size=30", 1, 30},
	} {
		t.Run(tc.query, func(t *testing.T) {
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			c.Request = httptest.NewRequest("GET", "/?"+tc.query, nil)
			page := GetPageQuery(c)
			require.Positive(t, page.GetPageSize())
			assert.Equal(t, tc.page, page.GetPage())
			assert.Equal(t, tc.size, page.GetPageSize())
			assert.LessOrEqual(t, page.GetStartIdx(), 1_000_000)
		})
	}
}

func TestPaginationRejectsNegativeLimitsAndInvalidDefaults(t *testing.T) {
	previous := ItemsPerPage
	ItemsPerPage = -1
	t.Cleanup(func() { ItemsPerPage = previous })
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest("GET", "/?page_size=-1&ps=-2&size=-3", nil)
	page := GetPageQuery(c)
	require.Positive(t, page.GetPageSize())
	assert.Equal(t, 1, page.GetPage())
	assert.Zero(t, page.GetStartIdx())
}
