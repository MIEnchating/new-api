package common

import (
	"strconv"

	"github.com/gin-gonic/gin"
)

// maxPaginationOffset bounds OFFSET-based queries so an extremely large page
// cannot overflow GetStartIdx or force the database to scan an unbounded prefix.
const maxPaginationOffset = 1_000_000

type PageInfo struct {
	Page     int `json:"page"`      // page num 页码
	PageSize int `json:"page_size"` // page size 页大小

	Total int `json:"total"` // 总条数，后设置
	Items any `json:"items"` // 数据，后设置
}

func (p *PageInfo) GetStartIdx() int {
	return (p.Page - 1) * p.PageSize
}

func (p *PageInfo) GetEndIdx() int {
	return p.Page * p.PageSize
}

func (p *PageInfo) GetPageSize() int {
	return p.PageSize
}

func (p *PageInfo) GetPage() int {
	return p.Page
}

func (p *PageInfo) SetTotal(total int) {
	p.Total = total
}

func (p *PageInfo) SetItems(items any) {
	p.Items = items
}

func GetPageQuery(c *gin.Context) *PageInfo {
	pageInfo := &PageInfo{Page: 1}
	if page, err := strconv.Atoi(c.Query("p")); err == nil && page > 0 {
		pageInfo.Page = page
	}

	// Accept the current parameter first, then the two legacy aliases. Invalid
	// and non-positive values are treated as absent so they can never become a
	// negative GORM offset/limit (Limit(-1) disables the SQL LIMIT clause).
	for _, key := range []string{"page_size", "ps", "size"} {
		pageSize, err := strconv.Atoi(c.Query(key))
		if err == nil && pageSize > 0 {
			pageInfo.PageSize = pageSize
			break
		}
	}
	if pageInfo.PageSize == 0 {
		pageInfo.PageSize = ItemsPerPage
		if pageInfo.PageSize <= 0 {
			pageInfo.PageSize = 10
		}
	}
	if pageInfo.PageSize > 100 {
		pageInfo.PageSize = 100
	}
	maxPage := maxPaginationOffset/pageInfo.PageSize + 1
	if pageInfo.Page > maxPage {
		pageInfo.Page = maxPage
	}

	return pageInfo
}
