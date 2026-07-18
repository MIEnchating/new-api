/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
package controller

import (
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestBuildTokenUsageLabelsFollowUserLanguage(t *testing.T) {
	require.NoError(t, i18n.Init())

	tests := []struct {
		language       string
		accountBalance string
		keyQuota       string
	}{
		{language: "zh", accountBalance: "账户余额", keyQuota: "Key 额度"},
		{language: "zh-TW", accountBalance: "帳戶餘額", keyQuota: "Key 額度"},
		{language: "en", accountBalance: "Account Balance", keyQuota: "Key Quota"},
	}

	for _, tt := range tests {
		t.Run(tt.language, func(t *testing.T) {
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			common.SetContextKey(c, constant.ContextKeyUserSetting, dto.UserSetting{Language: tt.language})
			labels := buildTokenUsageLabels(c)
			require.Equal(t, tt.accountBalance, labels["account_balance"])
			require.Equal(t, tt.keyQuota, labels["key_quota"])
		})
	}
}

func TestBuildTokenUsageDataIncludesAccountAndKeyQuota(t *testing.T) {
	token := &model.Token{
		Name:           "limited-key",
		RemainQuota:    4_000_000,
		UsedQuota:      1_000_000,
		UnlimitedQuota: false,
	}

	labels := gin.H{
		"account_balance": "账户余额",
		"key_quota":       "Key 额度",
		"api_key":         "API 密钥",
	}
	data := buildTokenUsageData(token, 12_500_000, 0, labels)
	account, ok := data["account"].(gin.H)
	require.True(t, ok)
	require.Equal(t, 12_500_000, account["total_available"])
	require.NotContains(t, account, "name")
	require.NotContains(t, account, "group")
	require.Equal(t, 5_000_000, data["total_granted"])
	require.Equal(t, 1_000_000, data["total_used"])
	require.Equal(t, 4_000_000, data["total_available"])
	require.Equal(t, false, data["unlimited_quota"])
	require.Equal(t, labels, data["labels"])
}
