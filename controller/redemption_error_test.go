package controller

import (
	"errors"
	"testing"

	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/assert"
)

func TestRedemptionErrorMessageKey(t *testing.T) {
	tests := []struct {
		err  error
		want string
	}{
		{model.ErrRedemptionNotProvided, i18n.MsgRedemptionNotProvided},
		{model.ErrRedemptionInvalid, i18n.MsgRedemptionInvalid},
		{model.ErrRedemptionUsed, i18n.MsgRedemptionUsed},
		{model.ErrRedemptionExpired, i18n.MsgRedemptionExpired},
		{model.ErrRedemptionBatchLimit, i18n.MsgRedemptionBatchLimit},
		{errors.New("database unavailable"), i18n.MsgRedeemFailed},
	}

	for _, test := range tests {
		assert.Equal(t, test.want, redemptionErrorMessageKey(test.err))
	}
}
