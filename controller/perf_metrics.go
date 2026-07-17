package controller

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	perfmetrics "github.com/QuantumNous/new-api/pkg/perf_metrics"
	"github.com/QuantumNous/new-api/setting/perf_metrics_setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"

	"github.com/gin-gonic/gin"
	"github.com/samber/lo"
)

func GetPerfMetricsSummary(c *gin.Context) {
	hours := 24
	if rawHours := c.Query("hours"); rawHours != "" {
		if parsed, err := strconv.Atoi(rawHours); err == nil {
			hours = parsed
		}
	}

	activeGroups := append(lo.Keys(ratio_setting.GetGroupRatioCopy()), "auto")
	result, err := perfmetrics.QuerySummaryAll(hours, activeGroups)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    result,
	})
}

func GetCacheMetrics(c *gin.Context) {
	hours := 24
	if rawHours := c.Query("hours"); rawHours != "" {
		if parsed, err := strconv.Atoi(rawHours); err == nil {
			hours = parsed
		}
	}

	availableGroups := getAvailableCacheGroups()
	configuredGroups := perf_metrics_setting.GetCacheMonitorGroups()
	displayGroups := resolveCacheMonitorGroups(availableGroups, configuredGroups)
	result, err := perfmetrics.QueryCache(hours, displayGroups)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"total":            result.Total,
			"groups":           result.Groups,
			"baseline":         perf_metrics_setting.GetCacheHitRateBaseline(),
			"bucket_seconds":   perf_metrics_setting.GetBucketSeconds(),
			"available_groups": availableGroups,
			"display_groups":   displayGroups,
			"all_groups":       len(configuredGroups) == 0,
		},
	})
}

func getAvailableCacheGroups() []string {
	groups := append(lo.Keys(ratio_setting.GetGroupRatioCopy()), "auto")
	groups = lo.Uniq(groups)
	sort.Strings(groups)
	return groups
}

func resolveCacheMonitorGroups(availableGroups []string, configuredGroups []string) []string {
	if len(configuredGroups) == 0 {
		return append([]string(nil), availableGroups...)
	}

	allowed := lo.SliceToMap(availableGroups, func(group string) (string, struct{}) {
		return group, struct{}{}
	})
	resolved := make([]string, 0, len(configuredGroups))
	seen := make(map[string]struct{}, len(configuredGroups))
	for _, rawGroup := range configuredGroups {
		group := strings.TrimSpace(rawGroup)
		if _, ok := allowed[group]; !ok {
			continue
		}
		if _, ok := seen[group]; ok {
			continue
		}
		seen[group] = struct{}{}
		resolved = append(resolved, group)
	}
	return resolved
}

type updateCacheHitRateBaselineRequest struct {
	Baseline *int `json:"baseline"`
}

func validateCacheHitRateBaseline(baseline int) error {
	if baseline < 0 || baseline > 100 {
		return fmt.Errorf("缓存命中率基线必须在 0 到 100 之间")
	}
	return nil
}

func UpdateCacheHitRateBaseline(c *gin.Context) {
	var request updateCacheHitRateBaselineRequest
	if err := common.DecodeJson(c.Request.Body, &request); err != nil {
		common.ApiErrorMsg(c, "无效的参数")
		return
	}
	if request.Baseline == nil {
		common.ApiErrorMsg(c, "无效的参数")
		return
	}
	if err := validateCacheHitRateBaseline(*request.Baseline); err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}
	if err := model.UpdateOption(
		"perf_metrics_setting.cache_hit_rate_baseline",
		strconv.Itoa(*request.Baseline),
	); err != nil {
		common.ApiError(c, err)
		return
	}

	recordManageAudit(c, "cache_hit_rate_baseline.update", map[string]interface{}{
		"baseline": *request.Baseline,
	})
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"baseline": *request.Baseline,
		},
	})
}

type updateCacheMonitorGroupsRequest struct {
	AllGroups bool     `json:"all_groups"`
	Groups    []string `json:"groups"`
}

func normalizeCacheMonitorGroups(request updateCacheMonitorGroupsRequest, availableGroups []string) ([]string, error) {
	if request.AllGroups {
		return []string{}, nil
	}

	groups := resolveCacheMonitorGroups(availableGroups, request.Groups)
	if len(groups) == 0 {
		return nil, fmt.Errorf("至少选择一个缓存监控分组")
	}
	if len(groups) != len(lo.Uniq(lo.Map(request.Groups, func(group string, _ int) string {
		return strings.TrimSpace(group)
	}))) {
		return nil, fmt.Errorf("缓存监控分组包含无效选项")
	}
	return groups, nil
}

func buildCacheMonitorGroupsAuditParams(
	availableGroups []string,
	previousGroups []string,
	groups []string,
) map[string]interface{} {
	displayGroups := resolveCacheMonitorGroups(availableGroups, groups)
	previousDisplayGroups := resolveCacheMonitorGroups(availableGroups, previousGroups)
	return map[string]interface{}{
		"all_groups":              len(groups) == 0,
		"display_groups":          displayGroups,
		"group_count":             len(displayGroups),
		"previous_all_groups":     len(previousGroups) == 0,
		"previous_display_groups": previousDisplayGroups,
	}
}

func UpdateCacheMonitorGroups(c *gin.Context) {
	var request updateCacheMonitorGroupsRequest
	if err := common.DecodeJson(c.Request.Body, &request); err != nil {
		common.ApiErrorMsg(c, "无效的参数")
		return
	}

	availableGroups := getAvailableCacheGroups()
	previousGroups := perf_metrics_setting.GetCacheMonitorGroups()
	groups, err := normalizeCacheMonitorGroups(request, availableGroups)
	if err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}
	encoded, err := json.Marshal(groups)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if err := model.UpdateOption("perf_metrics_setting.cache_monitor_groups", string(encoded)); err != nil {
		common.ApiError(c, err)
		return
	}

	displayGroups := resolveCacheMonitorGroups(availableGroups, groups)
	auditParams := buildCacheMonitorGroupsAuditParams(availableGroups, previousGroups, groups)
	recordManageAudit(c, "cache_monitor_groups.update", auditParams)
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"all_groups":     len(groups) == 0,
			"display_groups": displayGroups,
		},
	})
}

func GetPerfMetrics(c *gin.Context) {
	modelName := c.Query("model")
	if modelName == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "model is required",
		})
		return
	}

	hours := 24
	if rawHours := c.Query("hours"); rawHours != "" {
		if parsed, err := strconv.Atoi(rawHours); err == nil {
			hours = parsed
		}
	}

	result, err := perfmetrics.Query(perfmetrics.QueryParams{
		Model: modelName,
		Group: c.Query("group"),
		Hours: hours,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}

	result.Groups = filterActiveGroups(result.Groups)

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    result,
	})
}

func filterActiveGroups(groups []perfmetrics.GroupResult) []perfmetrics.GroupResult {
	activeRatios := ratio_setting.GetGroupRatioCopy()
	return lo.Filter(groups, func(g perfmetrics.GroupResult, _ int) bool {
		_, ok := activeRatios[g.Group]
		return ok || g.Group == "auto"
	})
}
