package operation_setting

import (
	"math"
	"sync/atomic"

	"github.com/QuantumNous/new-api/common"
)

const AffiliateUsageRewardOptionKey = "AffiliateUsageReward"
const DefaultAffiliateUsageRewardOption = `{"enabled":true,"rate_percent":5}`
const AffiliateUsageRewardDays = 60

type AffiliateUsageRewardSetting struct {
	Enabled     bool    `json:"enabled"`
	RatePercent float64 `json:"rate_percent"`
}

var affiliateUsageReward atomic.Pointer[AffiliateUsageRewardSetting]

func GetAffiliateUsageRewardSetting() AffiliateUsageRewardSetting {
	if settings := affiliateUsageReward.Load(); settings != nil {
		return *settings
	}
	return AffiliateUsageRewardSetting{Enabled: true, RatePercent: 5}
}

func (settings AffiliateUsageRewardSetting) Active() bool {
	return settings.Enabled && settings.RatePercent > 0
}

func ParseAffiliateUsageRewardSetting(value string) (AffiliateUsageRewardSetting, error) {
	var input struct {
		Enabled     *bool    `json:"enabled"`
		RatePercent *float64 `json:"rate_percent"`
	}
	if err := common.UnmarshalJsonStr(value, &input); err != nil || input.Enabled == nil || input.RatePercent == nil {
		return AffiliateUsageRewardSetting{}, common.NewMessage("Invalid parameters")
	}
	rate := *input.RatePercent
	if math.IsNaN(rate) || math.IsInf(rate, 0) || rate < 0 || rate > 100 {
		return AffiliateUsageRewardSetting{}, common.NewMessage("Wallet usage commission rate must be between 0 and 100.")
	}
	return AffiliateUsageRewardSetting{Enabled: *input.Enabled, RatePercent: rate}, nil
}

func UpdateAffiliateUsageRewardSetting(value string) error {
	settings, err := ParseAffiliateUsageRewardSetting(value)
	if err != nil {
		return err
	}
	affiliateUsageReward.Store(&settings)
	return nil
}
