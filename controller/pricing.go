package controller

import (
	"net/http"
	"strconv"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/pkg/billingexpr"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"

	"github.com/gin-gonic/gin"
)

func filterPricingByUsableGroups(pricing []model.Pricing, usableGroup map[string]string) []model.Pricing {
	if len(pricing) == 0 {
		return pricing
	}
	if len(usableGroup) == 0 {
		return []model.Pricing{}
	}

	filtered := make([]model.Pricing, 0, len(pricing))
	for _, item := range pricing {
		// The pricing cache is shared by all viewers.
		groups := make([]string, 0, len(item.EnableGroup))
		for _, group := range item.EnableGroup {
			if _, ok := usableGroup[group]; ok || group == "all" {
				groups = append(groups, group)
			}
		}
		if len(groups) > 0 {
			item.EnableGroup = groups
			prices := ratio_setting.GroupRequestPrices(item.ModelName)
			fixed := item.QuotaType == 1
			if item.BillingMode == "tiered_expr" {
				_, fixed = billingexpr.FlatFixedPrice(item.BillingExpr)
			}
			if fixed && len(prices) > 0 {
				item.GroupRequestPrices = make(map[string]float64)
				for _, group := range groups {
					if _, visible := usableGroup[group]; !visible {
						continue
					}
					if price, found := ratio_setting.GroupRequestPrice(prices, group); found {
						item.GroupRequestPrices[group] = price
					}
				}
			}
			filtered = append(filtered, item)
		}
	}
	return filtered
}

func GetPricing(c *gin.Context) {
	userGroup := common.GetContextKeyString(c, constant.ContextKeyUserGroup)
	usableGroup := service.GetUserUsableGroups(userGroup)
	pricing := filterPricingByUsableGroups(model.GetPricing(), usableGroup)
	groupRatio := ratio_setting.GetGroupRatioCopy()
	now := time.Now()
	for group := range groupRatio {
		if _, ok := usableGroup[group]; !ok {
			delete(groupRatio, group)
			continue
		}
		if userGroup != "" {
			ratio, _, _ := service.GetEffectiveGroupRatio(userGroup, group, now)
			groupRatio[group] = ratio
			continue
		}
		ratio, _, _ := ratio_setting.GetEffectiveGroupRatio(group, now)
		groupRatio[group] = ratio
	}
	orderedUsableGroup := make(map[string]map[string]any, len(usableGroup))
	usableGroupNames := make([]string, 0, len(usableGroup))
	for name := range usableGroup {
		usableGroupNames = append(usableGroupNames, name)
	}
	for order, name := range service.OrderGroupNames(usableGroupNames) {
		orderedUsableGroup[name] = map[string]any{"desc": usableGroup[name], "order": order}
	}

	c.JSON(200, gin.H{
		"success":            true,
		"data":               pricing,
		"vendors":            model.GetVendors(),
		"vendor_order":       model.GetModelSquareVendorOrder(),
		"group_ratio":        groupRatio,
		"usable_group":       orderedUsableGroup,
		"supported_endpoint": model.GetSupportedEndpointMap(),
		"auto_groups":        service.GetUserAutoGroup(userGroup),
		"model_order":        service.BuildModelSquareOrder(pricing, usableGroup),
		"pricing_version":    "a42d372ccf0b5dd13ecf71203521f9d2",
	})
}

func GetModelSquareVendors(c *gin.Context) {
	counts, err := model.GetVendorModelCounts()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	groupVendors, err := model.GetGroupVendors(setting.GetGroupCategories())
	if err != nil {
		common.ApiError(c, err)
		return
	}
	used := make(map[int]bool)
	for _, entry := range model.GetPricing() {
		used[entry.VendorID] = true
	}
	for _, vendor := range groupVendors {
		used[vendor.ID] = true
	}
	type vendorRow struct {
		model.PricingVendor
		CanDelete bool `json:"can_delete"`
	}
	vendors := model.GetVendors()
	rows := make([]vendorRow, 0, len(vendors))
	for _, vendor := range vendors {
		rows = append(rows, vendorRow{
			PricingVendor: vendor,
			CanDelete:     vendor.ID > 0 && counts[int64(vendor.ID)] == 0 && !used[vendor.ID],
		})
	}
	common.ApiSuccess(c, rows)
}

type modelSquareUsage struct {
	ModelName  string `json:"model_name"`
	Icon       string `json:"icon,omitempty"`
	VendorName string `json:"vendor_name,omitempty"`
	VendorIcon string `json:"vendor_icon,omitempty"`
	Requests   int64  `json:"requests"`
	Tokens     int64  `json:"tokens"`
}

// GetModelSquareUsage lists every model of the model square, whichever group
// can see it, with its usage for the order preview.
func GetModelSquareUsage(c *gin.Context) {
	days := c.DefaultQuery("days", "7")
	if err := operation_setting.ValidateModelSquareOption("model_square_setting.sort_days", days); err != nil {
		common.ApiErrorStatus(c, http.StatusBadRequest, err)
		return
	}
	usage := make(map[string]model.ModelUsageTotal)
	if c.Query("include_usage") != "false" {
		dayCount, _ := strconv.Atoi(days)
		totals, err := service.GetModelUsageTotals(dayCount)
		if err != nil {
			common.ApiError(c, err)
			return
		}
		for _, total := range totals {
			usage[total.ModelName] = total
		}
	}
	pricing := model.GetPricing()
	vendors := make(map[int]model.PricingVendor)
	for _, vendor := range model.GetVendors() {
		vendors[vendor.ID] = vendor
	}
	rows := make([]modelSquareUsage, 0, len(pricing))
	for _, item := range pricing {
		vendor := vendors[item.VendorID]
		total := usage[item.ModelName]
		rows = append(rows, modelSquareUsage{
			ModelName:  item.ModelName,
			Icon:       item.Icon,
			VendorName: vendor.Name,
			VendorIcon: vendor.Icon,
			Requests:   total.Requests,
			Tokens:     total.Tokens,
		})
	}
	common.ApiSuccess(c, rows)
}

func ResetModelRatio(c *gin.Context) {
	defaultStr := ratio_setting.DefaultModelRatio2JSONString()
	err := model.UpdateOption("ModelRatio", defaultStr)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	err = ratio_setting.UpdateModelRatioByJSONString(defaultStr)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccessT(c, "Model ratios reset", nil)
}
