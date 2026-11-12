package common

import (
	"strconv"

	"github.com/gin-gonic/gin"
)

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
	// Keep legacy aliases, but never pass a non-positive Limit to GORM:
	// Limit(-1) removes the database query's row bound.
	for _, key := range []string{"page_size", "ps", "size"} {
		if size, err := strconv.Atoi(c.Query(key)); err == nil && size > 0 {
			pageInfo.PageSize = size
			break
		}
	}
	if pageInfo.PageSize == 0 {
		pageInfo.PageSize = max(ItemsPerPage, 1)
	}
	pageInfo.PageSize = min(pageInfo.PageSize, 100)
	// Bound the multiplication as well as the work of OFFSET-based queries.
	pageInfo.Page = min(pageInfo.Page, 1_000_000/pageInfo.PageSize+1)

	return pageInfo
}
