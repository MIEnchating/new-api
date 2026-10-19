package model

import (
	"fmt"
	"os"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestAffiliateRewardLedgerIsIdempotentAndMasksInviteeUsername(t *testing.T) {
	truncateTables(t)
	require.NoError(t, DB.Create(&User{Id: 21, Username: "inviter", AffCode: "inviter_aff", Status: common.UserStatusEnabled}).Error)
	require.NoError(t, DB.Create(&User{Id: 142, Username: "invitee", AffCode: "invitee_aff", Status: common.UserStatusEnabled}).Error)

	reward := &AffiliateReward{EventKey: "registration:142", InviterId: 21, InviteeId: 142, Type: AffiliateRewardTypeRegistration, Quota: 100, SourceId: 142}
	created, err := createAffiliateRewardIfAbsent(DB, reward)
	require.NoError(t, err)
	assert.True(t, created)

	duplicate, err := createAffiliateRewardIfAbsent(DB, &AffiliateReward{EventKey: "registration:142", InviterId: 21, InviteeId: 142, Type: AffiliateRewardTypeRegistration, Quota: 100, SourceId: 142})
	require.NoError(t, err)
	assert.False(t, duplicate)

	items, total, err := GetAffiliateRewards(21, &common.PageInfo{Page: 1, PageSize: 10})
	require.NoError(t, err)
	assert.EqualValues(t, 1, total)
	require.Len(t, items, 1)
	assert.Equal(t, "i****e", items[0].InviteeDisplay)
	assert.NotContains(t, items[0].InviteeDisplay, "invitee")
	payload, err := common.Marshal(items[0])
	require.NoError(t, err)
	assert.NotContains(t, string(payload), "invitee_id")
	assert.NotContains(t, string(payload), "event_key")
	assert.NotContains(t, string(payload), "source_id")

	otherItems, otherTotal, err := GetAffiliateRewards(142, &common.PageInfo{Page: 1, PageSize: 10})
	require.NoError(t, err)
	assert.Empty(t, otherItems)
	assert.Zero(t, otherTotal)
}

func TestMaskAffiliateUsername(t *testing.T) {
	assert.Equal(t, "****", maskAffiliateUsername(""))
	assert.Equal(t, "****", maskAffiliateUsername("李"))
	assert.Equal(t, "张**", maskAffiliateUsername("张三"))
	assert.Equal(t, "b*b", maskAffiliateUsername("bob"))
	assert.Equal(t, "i****e", maskAffiliateUsername("invitee"))
}

func TestAffiliateRewardPagination(t *testing.T) {
	truncateTables(t)
	for i := 1; i <= 4; i++ {
		require.NoError(t, DB.Create(&AffiliateReward{EventKey: fmt.Sprintf("registration:%d", i), InviterId: 7, InviteeId: i, Type: AffiliateRewardTypeRegistration, Quota: i, SourceId: int64(i), CreatedAt: int64(i)}).Error)
	}
	items, total, err := GetAffiliateRewards(7, &common.PageInfo{Page: 2, PageSize: 2})
	require.NoError(t, err)
	assert.EqualValues(t, 4, total)
	assert.Len(t, items, 2)
}

func TestAllAffiliateRewardsFiltersInviterInviteeAndType(t *testing.T) {
	truncateTables(t)
	users := []User{
		{Id: 11, Username: "alice-inviter", DisplayName: "Alice", AffCode: "alice_aff", Status: common.UserStatusEnabled},
		{Id: 12, Username: "bob-inviter", DisplayName: "Bob", AffCode: "bob_aff", Status: common.UserStatusEnabled},
		{Id: 21, Username: "carol-invitee", DisplayName: "Carol", AffCode: "carol_aff", Status: common.UserStatusEnabled},
		{Id: 22, Username: "dave-invitee", DisplayName: "Dave", AffCode: "dave_aff", Status: common.UserStatusEnabled},
	}
	require.NoError(t, DB.Create(&users).Error)
	rewards := []AffiliateReward{
		{EventKey: "registration:21", InviterId: 11, InviteeId: 21, Type: AffiliateRewardTypeRegistration, Quota: 100, CreatedAt: 10},
		{EventKey: "first_topup:22", InviterId: 12, InviteeId: 22, Type: AffiliateRewardTypeFirstTopUp, Quota: 200, CreatedAt: 20},
	}
	require.NoError(t, DB.Create(&rewards).Error)

	items, total, err := GetAllAffiliateRewards(
		&common.PageInfo{Page: 1, PageSize: 10},
		AffiliateRewardAdminFilter{
			InviterKeyword: "alice",
			InviteeKeyword: "21",
			Type:           AffiliateRewardTypeRegistration,
		},
	)
	require.NoError(t, err)
	assert.EqualValues(t, 1, total)
	require.Len(t, items, 1)
	assert.Equal(t, 11, items[0].InviterId)
	assert.Equal(t, "alice-inviter", items[0].InviterUsername)
	assert.Equal(t, 21, items[0].InviteeId)
	assert.Equal(t, "carol-invitee", items[0].InviteeUsername)
}

// External DSNs must point to disposable databases, as this suite owns its tables.
func TestAffiliateAccountingDatabase(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			var driver gorm.Dialector
			switch dialect {
			case "sqlite":
				driver = sqlite.Open(":memory:")
			case "mysql":
				dsn := os.Getenv("TEST_MYSQL_DSN")
				if dsn == "" {
					t.Skip("TEST_MYSQL_DSN is not configured")
				}
				driver = mysql.Open(dsn)
			case "postgres":
				dsn := os.Getenv("TEST_POSTGRES_DSN")
				if dsn == "" {
					t.Skip("TEST_POSTGRES_DSN is not configured")
				}
				driver = postgres.New(postgres.Config{DSN: dsn, PreferSimpleProtocol: true})
			}
			db, err := gorm.Open(driver, &gorm.Config{})
			require.NoError(t, err)
			sqlDB, err := db.DB()
			require.NoError(t, err)
			sqlDB.SetMaxOpenConns(1)
			t.Cleanup(func() { assert.NoError(t, sqlDB.Close()) })
			var version string
			query := "SELECT version()"
			if dialect == "sqlite" {
				query = "SELECT sqlite_version()"
			}
			require.NoError(t, db.Raw(query).Scan(&version).Error)
			t.Logf("%s %s", dialect, version)
			models := []any{&AffiliateReward{}, &BillingTransaction{}, &TopUp{}, &User{}, &Log{}}
			require.NoError(t, db.Migrator().DropTable(models...))
			require.NoError(t, db.AutoMigrate(models...))
			t.Cleanup(func() { assert.NoError(t, db.Migrator().DropTable(models...)) })
			oldDB, oldLogDB := DB, LOG_DB
			oldMain, oldLog := common.MainDatabaseType(), common.LogDatabaseType()
			DB, LOG_DB = db, db
			common.SetDatabaseTypes(common.DatabaseType(dialect), common.DatabaseType(dialect))
			initCol()
			t.Cleanup(func() { DB, LOG_DB = oldDB, oldLogDB; common.SetDatabaseTypes(oldMain, oldLog); initCol() })
			enablePaymentComplianceForInviteRebateTest(t)
			configureInviteRechargeRebateForTest(t, 0.2, 100)
			oldReward := common.QuotaForInviter
			common.QuotaForInviter = 200
			t.Cleanup(func() { common.QuotaForInviter = oldReward })

			t.Run("invitation count includes unrewarded historical referrals", func(t *testing.T) {
				insertInviteRebateUser(t, 1, "count_inviter", 0)
				insertInviteRebateUser(t, 2, "count_invitee", 1)
				insertInviteRebateUser(t, 3, "count_deleted", 1)
				insertInviteRebateUser(t, 4, "count_unrelated", 0)
				require.NoError(t, DB.Delete(&User{}, 3).Error)
				// The persisted counter stayed at zero when registration rewards were off.
				user, err := GetSelfUserById(1)
				require.NoError(t, err)
				assert.Equal(t, 2, user.AffCount)
				assert.Zero(t, user.AffQuota)
			})

			for i, tc := range []struct {
				name           string
				quota, history int
				registration   bool
				wantError      bool
			}{
				{"first topup balance limit", common.MaxWalletQuota, 0, false, true},
				{"first topup history limit", 0, common.MaxWalletQuota, false, true},
				{"registration balance limit", common.MaxWalletQuota, 0, true, true},
				{"registration history limit", 0, common.MaxWalletQuota, true, true},
				{"first topup exact limit", common.MaxWalletQuota - 200, common.MaxWalletQuota - 200, false, false},
				{"registration exact limit", common.MaxWalletQuota - 200, common.MaxWalletQuota - 200, true, false},
			} {
				t.Run(tc.name, func(t *testing.T) {
					inviterID, inviteeID := 10+i*2, 11+i*2
					insertInviteRebateUser(t, inviterID, fmt.Sprintf("inviter_%d", i), 0)
					insertInviteRebateUser(t, inviteeID, fmt.Sprintf("invitee_%d", i), inviterID)
					require.NoError(t, DB.Model(&User{}).Where("id = ?", inviterID).Updates(map[string]any{"aff_quota": tc.quota, "aff_history": tc.history}).Error)
					trade := fmt.Sprintf("affiliate-limit-%d", i)
					if tc.registration {
						err = inviteUser(inviterID, inviteeID)
					} else {
						insertInviteRebateTopUp(t, trade, inviteeID, 10)
						_, err = RechargeEpay(trade, "alipay", "127.0.0.1")
					}
					if tc.wantError {
						assert.ErrorIs(t, err, ErrWalletQuotaLimitExceeded)
					} else {
						require.NoError(t, err)
					}
					inviter := getInviteRebateUser(t, inviterID)
					expectedAdded := 200
					if tc.wantError {
						expectedAdded = 0
					}
					assert.Equal(t, tc.quota+expectedAdded, inviter.AffQuota)
					assert.Equal(t, tc.history+expectedAdded, inviter.AffHistoryQuota)
					var count int64
					require.NoError(t, DB.Model(&AffiliateReward{}).Where("inviter_id = ?", inviterID).Count(&count).Error)
					if tc.wantError {
						assert.Zero(t, count)
					} else {
						assert.EqualValues(t, 1, count)
					}
					if !tc.registration {
						invitee := getInviteRebateUser(t, inviteeID)
						var topup TopUp
						require.NoError(t, DB.Where("trade_no = ?", trade).First(&topup).Error)
						if tc.wantError {
							assert.Zero(t, invitee.Quota)
							assert.Equal(t, common.TopUpStatusPending, topup.Status)
						} else {
							assert.Equal(t, 1000, invitee.Quota)
							assert.Equal(t, common.TopUpStatusSuccess, topup.Status)
						}
					}
					if !tc.wantError {
						if tc.registration {
							require.NoError(t, inviteUser(inviterID, inviteeID))
						} else {
							alreadyDone, replayErr := RechargeEpay(trade, "alipay", "127.0.0.1")
							require.NoError(t, replayErr)
							assert.True(t, alreadyDone)
						}
						updated := getInviteRebateUser(t, inviterID)
						assert.Equal(t, inviter.AffQuota, updated.AffQuota)
					}
				})
			}
			t.Run("transfer replay at wallet limit succeeds", func(t *testing.T) {
				insertInviteRebateUser(t, 100, "transfer_inviter", 0)
				require.NoError(t, DB.Model(&User{}).Where("id = ?", 100).Updates(map[string]any{"quota": common.MaxWalletQuota - 100, "aff_quota": 200}).Error)
				user := getInviteRebateUser(t, 100)
				require.NoError(t, user.TransferAffQuotaToQuota(100, "affiliate-transfer:limit-replay"))
				assert.NoError(t, user.TransferAffQuotaToQuota(100, "affiliate-transfer:limit-replay"))
				assert.ErrorIs(t, user.TransferAffQuotaToQuota(100, "affiliate-transfer:new"), ErrWalletQuotaLimitExceeded)
				assert.Error(t, user.TransferAffQuotaToQuota(200, "affiliate-transfer:limit-replay"))
				updated := getInviteRebateUser(t, 100)
				assert.Equal(t, common.MaxWalletQuota, updated.Quota)
				assert.Equal(t, 100, updated.AffQuota)
				var count int64
				require.NoError(t, DB.Model(&BillingTransaction{}).Where("user_id = ?", 100).Count(&count).Error)
				assert.EqualValues(t, 1, count)
			})
		})
	}
}
