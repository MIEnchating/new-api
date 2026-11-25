package model

import (
	"context"
	"errors"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const QQBotSettingsOptionKey = "QQBotSettingsSecret"

var ErrQQBotSettingsChanged = errors.New("QQ bot settings changed")

func CachedQQBotSettings() string {
	common.OptionMapRWMutex.RLock()
	defer common.OptionMapRWMutex.RUnlock()
	return common.OptionMap[QQBotSettingsOptionKey]
}

// SaveQQBotSettings stores the sealed configuration as one existing option row.
// Compare against the prior value in the database so another node cannot
// overwrite a newer credential or enabled state with a stale form.
func SaveQQBotSettings(ctx context.Context, previous, sealed string) error {
	db := DB.WithContext(ctx)
	var affected int64
	if previous == "" {
		err := db.Transaction(func(tx *gorm.DB) error {
			if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&Option{Key: QQBotSettingsOptionKey, Value: sealed}).Error; err != nil {
				return err
			}
			// MySQL can report an existing unchanged row as affected.
			var stored Option
			if err := tx.Where(&Option{Key: QQBotSettingsOptionKey}).Take(&stored).Error; err != nil {
				return err
			}
			if stored.Value != sealed {
				return ErrQQBotSettingsChanged
			}
			return nil
		})
		if err != nil {
			return err
		}
		affected = 1
	} else {
		result := db.Model(&Option{}).Where(&Option{Key: QQBotSettingsOptionKey, Value: previous}).Update("value", sealed)
		if result.Error != nil {
			return result.Error
		}
		affected = result.RowsAffected
	}
	if affected != 1 {
		return ErrQQBotSettingsChanged
	}
	_ = updateOptionMap(QQBotSettingsOptionKey, sealed)
	BumpSyncTopic(SyncTopicOptions)
	return nil
}
