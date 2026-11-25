package model

import (
	"errors"
	"fmt"
	"os"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"
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

func creditAffiliateUsageRewardForTest(inviteeID int, chargeKey string, spentQuota int, settledAt int64) error {
	eventKey, err := enqueueAffiliateUsageReward(DB, inviteeID, chargeKey, spentQuota, settledAt)
	if err != nil || eventKey == "" {
		return err
	}
	return applyPendingAffiliateUsageReward(DB, eventKey, common.GetTimestamp())
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
			models := []any{&AffiliateReward{}, &PendingAffiliateUsageReward{}, &BillingTransaction{}, &TopUp{}, &User{}, &Log{}, &Option{}, &SystemTask{}, &Task{}, &Midjourney{}}
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

			t.Run("failed outbox write rolls back wallet adjustment and task completion", func(t *testing.T) {
				const inviterID, inviteeID = 371, 372
				insertInviteRebateUser(t, inviterID, "atomic_usage_inviter", 0)
				insertInviteRebateUser(t, inviteeID, "atomic_usage_invitee", inviterID)
				t.Cleanup(func() {
					assert.NoError(t, DB.Where("inviter_id = ?", inviterID).Delete(&AffiliateReward{}).Error)
				})
				require.NoError(t, DB.Model(&User{}).Where("id = ?", inviteeID).Update("quota", 3800).Error)
				task := Task{UserId: inviteeID, TaskID: "atomic-usage-task", Quota: 1200, Status: TaskStatusSubmitted}
				require.NoError(t, task.Insert())
				const callback = "test:reject_wallet_reward_insert"
				reject := true
				injected := errors.New("forced reward queue insert failure")
				require.NoError(t, DB.Callback().Create().Before("gorm:create").Register(callback, func(tx *gorm.DB) {
					if reject && tx.Statement.Schema != nil && tx.Statement.Schema.Table == "pending_affiliate_usage_rewards" {
						tx.AddError(injected)
					}
				}))
				t.Cleanup(func() { assert.NoError(t, DB.Callback().Create().Remove(callback)) })

				won, err := CommitWalletUsage(inviteeID, 200, 200, "request:rollback", nil)
				require.ErrorIs(t, err, injected)
				assert.False(t, won)
				assert.Equal(t, 3800, getInviteRebateUser(t, inviteeID).Quota)

				inline := Midjourney{UserId: inviteeID, MjId: "atomic-usage-midjourney", Quota: 200, Status: string(TaskStatusSuccess)}
				fundingErr, err := inline.InsertWithWalletBilling()
				require.ErrorIs(t, fundingErr, injected)
				require.ErrorIs(t, err, injected)
				assert.Zero(t, inline.Id)
				var inlineCount int64
				require.NoError(t, DB.Model(&Midjourney{}).Where("mj_id = ?", inline.MjId).Count(&inlineCount).Error)
				assert.Zero(t, inlineCount)
				assert.Equal(t, 3800, getInviteRebateUser(t, inviteeID).Quota)

				task.Status = TaskStatusSuccess
				won, err = task.CompleteWalletTask(TaskStatusSubmitted, 1000)
				require.ErrorIs(t, err, injected)
				assert.False(t, won)
				var persisted Task
				require.NoError(t, DB.First(&persisted, task.ID).Error)
				assert.Equal(t, TaskStatus(TaskStatusSubmitted), persisted.Status)
				assert.Equal(t, 1200, persisted.Quota)
				assert.Equal(t, 3800, getInviteRebateUser(t, inviteeID).Quota)
				assert.Zero(t, getInviteRebateUser(t, inviterID).AffQuota)

				reject = false
				stale := task
				won, err = task.CompleteWalletTask(TaskStatusSubmitted, 1000)
				require.NoError(t, err)
				require.True(t, won)
				won, err = stale.CompleteWalletTask(TaskStatusSubmitted, 1000)
				require.NoError(t, err)
				assert.False(t, won)
				require.NoError(t, DB.First(&persisted, task.ID).Error)
				assert.Equal(t, TaskStatus(TaskStatusSuccess), persisted.Status)
				assert.Equal(t, 1000, persisted.Quota)
				assert.Equal(t, 4000, getInviteRebateUser(t, inviteeID).Quota)
				assert.Equal(t, 50, getInviteRebateUser(t, inviterID).AffQuota)
			})

			t.Run("wallet charges earn five percent until the sixtieth day", func(t *testing.T) {
				const inviterID, inviteeID = 301, 302
				const joinedAt int64 = 1_800_000_000
				const endOfWindow = joinedAt + 60*24*60*60
				insertInviteRebateUser(t, inviterID, "usage_inviter", 0)
				insertInviteRebateUser(t, inviteeID, "usage_invitee", inviterID)
				require.NoError(t, DB.Model(&User{}).Where("id = ?", inviteeID).Update("created_at", joinedAt).Error)

				if dialect != "sqlite" {
					sqlDB.SetMaxOpenConns(2)
					t.Cleanup(func() { sqlDB.SetMaxOpenConns(1) })
				}
				starts := make(chan struct{})
				attempts := make(chan error, 2)
				for range 2 {
					go func() {
						<-starts
						attempts <- creditAffiliateUsageRewardForTest(inviteeID, "request:first", 2009, joinedAt)
					}()
				}
				close(starts)
				for range 2 {
					require.NoError(t, <-attempts)
				}

				for _, charge := range []struct {
					key       string
					quota     int
					settledAt int64
				}{
					{"request:last", 220, endOfWindow - 1},
					{"request:expired", 2000, endOfWindow},
					{"request:before-signup", 2000, joinedAt - 1},
					{"request:below-one-unit", 19, joinedAt},
					{"request:refund", -2000, joinedAt},
				} {
					require.NoError(t, creditAffiliateUsageRewardForTest(inviteeID, charge.key, charge.quota, charge.settledAt))
				}
				require.NoError(t, creditAffiliateUsageRewardForTest(inviterID, "request:no-inviter", 2000, joinedAt))

				inviter := getInviteRebateUser(t, inviterID)
				assert.Equal(t, 111, inviter.AffQuota)
				assert.Equal(t, 111, inviter.AffHistoryQuota)
				assert.Zero(t, inviter.Quota)
				items, total, err := GetAffiliateRewards(inviterID, nil)
				require.NoError(t, err)
				assert.EqualValues(t, 2, total)
				require.Len(t, items, 2)
				assert.Equal(t, AffiliateRewardTypeWalletUsage, items[0].Type)
				assert.Equal(t, 11, items[0].Quota)
				assert.Equal(t, "u****e", items[0].InviteeDisplay)
				assert.Equal(t, 100, items[1].Quota)
				adminItems, total, err := GetAllAffiliateRewards(nil, AffiliateRewardAdminFilter{Type: AffiliateRewardTypeWalletUsage})
				require.NoError(t, err)
				assert.EqualValues(t, 2, total)
				require.Len(t, adminItems, 2)
				assert.Equal(t, "usage_invitee", adminItems[0].InviteeUsername)

				require.NoError(t, inviter.TransferAffQuotaToQuota(100, "affiliate-transfer:usage"))
				inviter = getInviteRebateUser(t, inviterID)
				assert.Equal(t, 100, inviter.Quota)
				assert.Equal(t, 11, inviter.AffQuota)
				assert.Equal(t, 111, inviter.AffHistoryQuota)
			})

			t.Run("wallet reward ledger rolls back when the inviter balance cannot be credited", func(t *testing.T) {
				const inviterID, inviteeID = 311, 312
				insertInviteRebateUser(t, inviterID, "capped_usage_inviter", 0)
				insertInviteRebateUser(t, inviteeID, "capped_usage_invitee", inviterID)
				settledAt := getInviteRebateUser(t, inviteeID).CreatedAt
				require.NoError(t, DB.Model(&User{}).Where("id = ?", inviterID).Update("aff_history", common.MaxWalletQuota).Error)
				require.ErrorIs(t, creditAffiliateUsageRewardForTest(inviteeID, "request:retry", 1000, settledAt), ErrWalletQuotaLimitExceeded)
				items, total, err := GetAffiliateRewards(inviterID, nil)
				require.NoError(t, err)
				assert.Empty(t, items)
				assert.Zero(t, total)
				assert.Zero(t, getInviteRebateUser(t, inviterID).AffQuota)

				var pending PendingAffiliateUsageReward
				require.NoError(t, DB.Where("event_key = ?", "wallet-usage:request:retry").First(&pending).Error)
				require.Equal(t, 50, pending.Quota)
				require.Equal(t, settledAt, pending.SettledAt)
				require.Positive(t, pending.NextAttemptAt)

				require.NoError(t, DB.Model(&User{}).Where("id = ?", inviterID).Update("aff_history", 0).Error)
				require.NoError(t, RetryPendingAffiliateUsageRewards(t.Context(), pending.NextAttemptAt-1))
				assert.Zero(t, getInviteRebateUser(t, inviterID).AffQuota)
				require.NoError(t, RetryPendingAffiliateUsageRewards(t.Context(), pending.NextAttemptAt))
				require.NoError(t, RetryPendingAffiliateUsageRewards(t.Context(), pending.NextAttemptAt))
				require.NoError(t, creditAffiliateUsageRewardForTest(inviteeID, "request:retry", 1000, settledAt))
				assert.Equal(t, 50, getInviteRebateUser(t, inviterID).AffQuota)
				var remaining int64
				require.NoError(t, DB.Model(&PendingAffiliateUsageReward{}).Where("event_key = ?", pending.EventKey).Count(&remaining).Error)
				assert.Zero(t, remaining)
			})

			t.Run("saved wallet commission settings control future rewards", func(t *testing.T) {
				const inviterID, inviteeID = 321, 322
				const key = operation_setting.AffiliateUsageRewardOptionKey
				const enabled = `{"enabled":true,"rate_percent":12.5}`
				const disabled = `{"enabled":false,"rate_percent":12.5}`
				oldSetting, err := common.Marshal(operation_setting.GetAffiliateUsageRewardSetting())
				require.NoError(t, err)
				common.OptionMapRWMutex.Lock()
				oldOptions := common.OptionMap
				common.OptionMap = make(map[string]string)
				common.OptionMapRWMutex.Unlock()
				t.Cleanup(func() {
					assert.NoError(t, operation_setting.UpdateAffiliateUsageRewardSetting(string(oldSetting)))
					common.OptionMapRWMutex.Lock()
					common.OptionMap = oldOptions
					common.OptionMapRWMutex.Unlock()
				})

				insertInviteRebateUser(t, inviterID, "configured_usage_inviter", 0)
				insertInviteRebateUser(t, inviteeID, "configured_usage_invitee", inviterID)
				settledAt := getInviteRebateUser(t, inviteeID).CreatedAt

				require.NoError(t, UpdateOption(key, enabled))
				require.Error(t, UpdateOption(key, `{"enabled":true,"rate_percent":101}`))
				require.Error(t, UpdateOption(key, `{"enabled":true,"rate_percent":-1}`))
				require.Error(t, UpdateOption(key, `{"enabled":true,"rate_percent":null}`))
				require.NoError(t, creditAffiliateUsageRewardForTest(inviteeID, "request:configured", 1007, settledAt))
				assert.Equal(t, 125, getInviteRebateUser(t, inviterID).AffQuota)

				require.NoError(t, UpdateOption(key, `{"enabled":true,"rate_percent":0}`))
				require.NoError(t, creditAffiliateUsageRewardForTest(inviteeID, "request:zero-rate", 1007, settledAt))
				require.NoError(t, UpdateOption(key, disabled))
				require.NoError(t, creditAffiliateUsageRewardForTest(inviteeID, "request:disabled", 1007, settledAt))
				assert.Equal(t, 125, getInviteRebateUser(t, inviterID).AffQuota)
				payment := operation_setting.GetPaymentSetting()
				payment.ComplianceConfirmed = false
				t.Cleanup(func() { payment.ComplianceConfirmed = true })
				require.Error(t, UpdateOption(key, enabled))
				var saved Option
				require.NoError(t, DB.First(&saved, &Option{Key: key}).Error)
				assert.JSONEq(t, disabled, saved.Value)
			})

			t.Run("topup succeeds when its inviter is unavailable", func(t *testing.T) {
				for i, tc := range []struct {
					name       string
					hardDelete bool
					manual     bool
				}{
					{name: "callback soft-deleted inviter"},
					{name: "manual completion soft-deleted inviter", manual: true},
					{name: "callback missing inviter", hardDelete: true},
				} {
					t.Run(tc.name, func(t *testing.T) {
						inviterID, inviteeID := 200+i*2, 201+i*2
						insertInviteRebateUser(t, inviterID, fmt.Sprintf("removed_inviter_%d", i), 0)
						insertInviteRebateUser(t, inviteeID, fmt.Sprintf("pending_invitee_%d", i), inviterID)
						deletion := DB
						if tc.hardDelete {
							deletion = deletion.Unscoped()
						}
						require.NoError(t, deletion.Delete(&User{}, inviterID).Error)
						trade := fmt.Sprintf("rebate-unavailable-inviter-%d", i)
						insertInviteRebateTopUp(t, trade, inviteeID, 10)

						if tc.manual {
							require.NoError(t, ManualCompleteTopUp(trade, "127.0.0.1"))
						} else {
							alreadyDone, err := RechargeEpay(trade, "alipay", "127.0.0.1")
							require.NoError(t, err)
							assert.False(t, alreadyDone)
						}
						alreadyDone, err := RechargeEpay(trade, "alipay", "127.0.0.1")
						require.NoError(t, err)
						assert.True(t, alreadyDone)
						topUp := GetTopUpByTradeNo(trade)
						require.NotNil(t, topUp)
						assert.Equal(t, common.TopUpStatusSuccess, topUp.Status)
						assert.Positive(t, topUp.CompleteTime)
						assert.Equal(t, 1000, getInviteRebateUser(t, inviteeID).Quota)
						var count int64
						require.NoError(t, DB.Model(&AffiliateReward{}).Where("invitee_id = ?", inviteeID).Count(&count).Error)
						assert.Zero(t, count)
					})
				}
			})

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
