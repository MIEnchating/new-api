package model

import (
	"errors"
	"sort"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

var (
	ErrBillingInvoiceNotFound   = errors.New("billing invoice target not found")
	ErrBillingInvoiceIneligible = errors.New("billing invoice target is not eligible")
)

type BillingInvoiceTarget struct {
	Id   int    `json:"id"`
	Type string `json:"type"`
}

type BillingInvoiceRecord struct {
	Id        int    `json:"id"`
	Type      string `json:"type"`
	UserId    int    `json:"user_id"`
	Reference string `json:"reference"`
}

func billingInvoiceUpdates(action string, now int64, operatorId int) map[string]interface{} {
	if action == TopUpInvoiceActionIssue {
		return map[string]interface{}{
			"invoice_status":      TopUpInvoiceStatusIssued,
			"invoiced_at":         now,
			"invoiced_by":         operatorId,
			"invoice_returned_at": 0,
			"invoice_returned_by": 0,
		}
	}
	return map[string]interface{}{
		"invoice_status":      TopUpInvoiceStatusReturned,
		"invoice_returned_at": now,
		"invoice_returned_by": operatorId,
	}
}

func validateBillingInvoiceStatus(status int, action string) error {
	if action == TopUpInvoiceActionIssue && status == TopUpInvoiceStatusIssued {
		return ErrTopUpInvoiceStatus
	}
	if action == TopUpInvoiceActionReturn && status != TopUpInvoiceStatusIssued {
		return ErrTopUpInvoiceStatus
	}
	return nil
}

// UpdateBillingInvoiceStatuses atomically updates invoice markers across
// successful online top-ups and regular redemption-code credits.
func UpdateBillingInvoiceStatuses(targets []BillingInvoiceTarget, action string, operatorId int) ([]BillingInvoiceRecord, error) {
	if len(targets) == 0 || len(targets) > 100 || operatorId <= 0 {
		return nil, ErrTopUpInvoiceBatch
	}
	if action != TopUpInvoiceActionIssue && action != TopUpInvoiceActionReturn {
		return nil, ErrTopUpInvoiceAction
	}

	seen := make(map[BillingInvoiceTarget]struct{}, len(targets))
	topupIds := make([]int, 0, len(targets))
	redemptionIds := make([]int, 0, len(targets))
	for _, target := range targets {
		if target.Id <= 0 {
			return nil, ErrTopUpInvoiceBatch
		}
		if _, exists := seen[target]; exists {
			continue
		}
		seen[target] = struct{}{}
		switch target.Type {
		case BillingTypeOnlineTopup:
			topupIds = append(topupIds, target.Id)
		case BillingTypeRedemption:
			redemptionIds = append(redemptionIds, target.Id)
		default:
			return nil, ErrBillingInvoiceIneligible
		}
	}
	sort.Ints(topupIds)
	sort.Ints(redemptionIds)

	records := make([]BillingInvoiceRecord, 0, len(seen))
	now := common.GetTimestamp()
	err := DB.Transaction(func(tx *gorm.DB) error {
		if len(topupIds) > 0 {
			locked := make([]TopUp, 0, len(topupIds))
			if err := lockForUpdate(tx).Where("id IN ?", topupIds).Order("id ASC").Find(&locked).Error; err != nil {
				return err
			}
			if len(locked) != len(topupIds) {
				return ErrBillingInvoiceNotFound
			}
			for _, topup := range locked {
				if topup.Status != common.TopUpStatusSuccess {
					return ErrBillingInvoiceIneligible
				}
				if err := validateBillingInvoiceStatus(topup.InvoiceStatus, action); err != nil {
					return err
				}
				records = append(records, BillingInvoiceRecord{
					Id: topup.Id, Type: BillingTypeOnlineTopup,
					UserId: topup.UserId, Reference: topup.TradeNo,
				})
			}
			if err := tx.Model(&TopUp{}).Where("id IN ?", topupIds).Updates(billingInvoiceUpdates(action, now, operatorId)).Error; err != nil {
				return err
			}
		}

		if len(redemptionIds) > 0 {
			locked := make([]Redemption, 0, len(redemptionIds))
			if err := lockForUpdate(tx.Unscoped()).Where("id IN ?", redemptionIds).Order("id ASC").Find(&locked).Error; err != nil {
				return err
			}
			if len(locked) != len(redemptionIds) {
				return ErrBillingInvoiceNotFound
			}
			for _, redemption := range locked {
				if redemption.Status != common.RedemptionCodeStatusUsed || redemption.UsedUserId <= 0 || redemption.RedeemedTime <= 0 || redemption.LimitOnePerUser {
					return ErrBillingInvoiceIneligible
				}
				if err := validateBillingInvoiceStatus(redemption.InvoiceStatus, action); err != nil {
					return err
				}
				records = append(records, BillingInvoiceRecord{
					Id: redemption.Id, Type: BillingTypeRedemption,
					UserId: redemption.UsedUserId, Reference: redemption.Name,
				})
			}
			if err := tx.Unscoped().Model(&Redemption{}).Where("id IN ?", redemptionIds).Updates(billingInvoiceUpdates(action, now, operatorId)).Error; err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return records, nil
}

func initializeRedemptionInvoiceFields() error {
	columns := []string{
		"invoice_status",
		"invoiced_at",
		"invoiced_by",
		"invoice_returned_at",
		"invoice_returned_by",
	}
	for _, column := range columns {
		if err := DB.Unscoped().Model(&Redemption{}).Where(column+" IS NULL").Update(column, 0).Error; err != nil {
			return err
		}
	}
	return nil
}
