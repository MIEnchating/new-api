package service

import (
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
)

func PerformUserCheckin(userID int) (*model.Checkin, error) {
	checkin, err := model.UserCheckin(userID)
	if err != nil {
		return nil, err
	}
	model.RecordLog(userID, model.LogTypeSystem, common.NewMessage("Daily check-in, received {{quota}}", map[string]any{"quota": logger.FormatQuota(checkin.QuotaAwarded)}))
	return checkin, nil
}
