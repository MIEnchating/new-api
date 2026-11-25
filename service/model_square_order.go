package service

import (
	"cmp"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"golang.org/x/sync/singleflight"
)

// ModelSquareOrder lists model names for the model square sorts. Models
// missing from a list follow it by name. It holds no usage figures, because
// the model square can be public while the rankings page is off.
type ModelSquareOrder struct {
	DefaultSort string   `json:"default_sort,omitempty"`
	Recommended []string `json:"recommended"`
	Requests    []string `json:"requests"`
	Tokens      []string `json:"tokens"`
}

type modelUsageCacheItem struct {
	expiresAt time.Time
	totals    []model.GroupModelUsageTotal
}

var (
	modelUsageCacheMu sync.Mutex
	modelUsageCache   = map[int]modelUsageCacheItem{}
	modelUsageLoad    singleflight.Group
)

// GetModelUsageTotals returns per-model usage for the admin preview.
func GetModelUsageTotals(days int) ([]model.ModelUsageTotal, error) {
	return getModelUsageTotals(days, nil)
}

func getModelUsageTotals(days int, usableGroups map[string]string) ([]model.ModelUsageTotal, error) {
	if !common.DataExportEnabled || (usableGroups != nil && len(usableGroups) == 0) {
		return nil, nil
	}
	result, err, _ := modelUsageLoad.Do(strconv.Itoa(days), func() (any, error) {
		now := time.Now()
		modelUsageCacheMu.Lock()
		item, ok := modelUsageCache[days]
		modelUsageCacheMu.Unlock()
		if ok && now.Before(item.expiresAt) {
			return item.totals, nil
		}

		totals, err := model.GetGroupModelUsageTotals(now.AddDate(0, 0, -days).Unix(), now.Unix())
		if err != nil {
			return nil, err
		}
		modelUsageCacheMu.Lock()
		modelUsageCache[days] = modelUsageCacheItem{expiresAt: now.Add(rankingCacheTTL), totals: totals}
		modelUsageCacheMu.Unlock()
		return totals, nil
	})
	if err != nil {
		return nil, err
	}

	var usableGroupIdentities map[string]struct{}
	if usableGroups != nil {
		usableGroupIdentities = make(map[string]struct{}, len(usableGroups))
		for name := range usableGroups {
			if name != "" {
				usableGroupIdentities[common.GroupIdentity(name)] = struct{}{}
			}
		}
	}
	byModel := make(map[string]model.ModelUsageTotal)
	for _, usage := range result.([]model.GroupModelUsageTotal) {
		if usableGroupIdentities != nil {
			// Renames retain the group identity. Rows without a group cannot be attributed.
			if _, ok := usableGroupIdentities[common.GroupIdentity(usage.UseGroup)]; !ok {
				continue
			}
		}
		total := byModel[usage.ModelName]
		total.ModelName = usage.ModelName
		total.Requests += usage.Requests
		total.Tokens += usage.Tokens
		byModel[usage.ModelName] = total
	}
	totals := make([]model.ModelUsageTotal, 0, len(byModel))
	for _, total := range byModel {
		totals = append(totals, total)
	}
	return totals, nil
}

// BuildModelSquareOrder orders the listed models for the model square sorts.
// Names that are not listed are left out.
func BuildModelSquareOrder(pricing []model.Pricing, usableGroups map[string]string) ModelSquareOrder {
	listed := make(map[string]struct{}, len(pricing))
	for _, item := range pricing {
		listed[item.ModelName] = struct{}{}
	}
	setting := operation_setting.GetModelSquareSetting()
	totals, err := getModelUsageTotals(setting.SortDays, usableGroups)
	if err != nil {
		common.SysError(common.LogText("failed to load model usage for the model square: %s", err.Error()))
	}
	order := ModelSquareOrder{
		Requests: modelNamesByUsage(totals, operation_setting.ModelSquareMetricRequests, listed),
		Tokens:   modelNamesByUsage(totals, operation_setting.ModelSquareMetricTokens, listed),
	}
	if setting.SortMode == operation_setting.ModelSquareSortVendor {
		order.DefaultSort = operation_setting.ModelSquareSortVendor
		order.Recommended = []string{}
		return order
	}

	byMetric := order.Tokens
	if setting.SortMetric == operation_setting.ModelSquareMetricRequests {
		byMetric = order.Requests
	}
	if setting.SortMode == operation_setting.ModelSquareSortUsage {
		order.Recommended = byMetric
		return order
	}

	order.Recommended = make([]string, 0, len(setting.SortModels))
	pinned := make(map[string]struct{}, len(setting.SortModels))
	for _, name := range setting.SortModels {
		_, visible := listed[name]
		_, duplicate := pinned[name]
		if visible && !duplicate {
			order.Recommended = append(order.Recommended, name)
			pinned[name] = struct{}{}
		}
	}
	if setting.SortMode == operation_setting.ModelSquareSortMixed {
		for _, name := range byMetric {
			if _, ok := pinned[name]; !ok {
				order.Recommended = append(order.Recommended, name)
			}
		}
	}
	return order
}

// modelNamesByUsage lists the listed models that have usage of the metric,
// most used first and equal usage in byte order, as the web console does.
func modelNamesByUsage(totals []model.ModelUsageTotal, metric string, listed map[string]struct{}) []string {
	usage := make(map[string]int64, len(totals))
	names := make([]string, 0, len(totals))
	for _, total := range totals {
		value := total.Tokens
		if metric == operation_setting.ModelSquareMetricRequests {
			value = total.Requests
		}
		if _, ok := listed[total.ModelName]; ok && value > 0 {
			usage[total.ModelName] = value
			names = append(names, total.ModelName)
		}
	}
	slices.SortFunc(names, func(a, b string) int {
		return cmp.Or(cmp.Compare(usage[b], usage[a]), strings.Compare(a, b))
	})
	return names
}
