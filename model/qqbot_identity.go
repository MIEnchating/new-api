package model

import (
	"crypto/sha256"
	"encoding/hex"
	"time"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

const (
	QQBotIdentityProvider = "qq_bot"
	qqBotBindingPurpose   = "qq_bot_bind"
	qqBotGroupBindPurpose = "qq_bot_group_bind"
	qqBotGroupProvider    = "qqbotg-"
)

func qqBotIdentitySubject(appID, openID string) string {
	digest := sha256.Sum256([]byte(appID + "\x00" + openID))
	return hex.EncodeToString(digest[:])
}

func qqBotGroupIdentityProvider(appID, groupID string) string {
	return qqBotGroupProvider + qqBotIdentitySubject(appID, groupID)[:25]
}

type qqBotGroupBinding struct {
	GroupID   string
	Subject   string
	EmailHash string
}

func CreateQQBotGroupBindingCode(appID, groupID, memberID string, user *User) (string, error) {
	payload, err := common.Marshal(qqBotGroupBinding{
		GroupID: groupID, Subject: qqBotIdentitySubject(appID, groupID+"\x00"+memberID),
		EmailHash: qqBotIdentitySubject(appID, NormalizeEmail(user.Email)),
	})
	if err != nil {
		return "", err
	}
	token, _, err := CreateAuthFlow(AuthFlowCreate{
		Purpose: qqBotGroupBindPurpose, Provider: qqBotIdentitySubject(appID, ""), Intent: AuthFlowIntentBind,
		UserId: user.Id, Payload: string(payload), ExpiresAt: time.Now().Add(5 * time.Minute),
	})
	return token, err
}

func BindQQBotGroupIdentity(token, appID string, identity AuthSessionIdentity, groups map[string]struct{}) error {
	_, err := ConsumeAuthFlowWithAction(token, AuthFlowMatch{
		Purpose: qqBotGroupBindPurpose, Provider: qqBotIdentitySubject(appID, ""), Intent: AuthFlowIntentBind, UserId: identity.UserID,
	}, func(tx *gorm.DB, flow *AuthFlow) error {
		var binding qqBotGroupBinding
		if common.UnmarshalJsonStr(flow.Payload, &binding) != nil {
			return ErrAuthFlowInvalid
		}
		if _, allowed := groups[binding.GroupID]; !allowed {
			return ErrAuthFlowInvalid
		}
		if err := ValidateAuthSessionWithTx(tx, identity); err != nil {
			return err
		}
		var user User
		if err := tx.Select("email").First(&user, identity.UserID).Error; err != nil {
			return err
		}
		if NormalizeEmail(user.Email) == "" ||
			qqBotIdentitySubject(appID, NormalizeEmail(user.Email)) != binding.EmailHash ||
			!flow.ExpiresAt.After(time.Now()) {
			return ErrAuthFlowInvalid
		}
		return ClaimExternalIdentityWithTx(tx, qqBotGroupIdentityProvider(appID, binding.GroupID), binding.Subject, identity.UserID)
	})
	return err
}

func CreateQQBotBindingCode(appID, openID string) (string, error) {
	token, _, err := CreateAuthFlow(AuthFlowCreate{
		Purpose: qqBotBindingPurpose, Provider: qqBotIdentitySubject(appID, ""), Intent: AuthFlowIntentBind,
		Payload: qqBotIdentitySubject(appID, openID), ExpiresAt: time.Now().Add(5 * time.Minute),
	})
	return token, err
}

func BindQQBotIdentity(token, appID string, identity AuthSessionIdentity) error {
	_, err := ConsumeAuthFlowWithAction(token, AuthFlowMatch{
		Purpose: qqBotBindingPurpose, Provider: qqBotIdentitySubject(appID, ""), Intent: AuthFlowIntentBind,
	}, func(tx *gorm.DB, flow *AuthFlow) error {
		if err := ValidateAuthSessionWithTx(tx, identity); err != nil {
			return err
		}
		return ClaimExternalIdentityWithTx(tx, QQBotIdentityProvider, flow.Payload, identity.UserID)
	})
	return err
}

func UnbindQQBotIdentity(identity AuthSessionIdentity) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		now := time.Now()
		if err := tx.Model(&AuthFlow{}).Where("user_id = ? AND purpose = ? AND consumed_at IS NULL AND expires_at > ?",
			identity.UserID, qqBotGroupBindPurpose, now).Update("consumed_at", now).Error; err != nil {
			return err
		}
		if err := ValidateAuthSessionWithTx(tx, identity); err != nil {
			return err
		}
		return tx.Where("user_id = ? AND (provider = ? OR provider LIKE ?)",
			identity.UserID, QQBotIdentityProvider, qqBotGroupProvider+"%").Delete(&ExternalIdentityClaim{}).Error
	})
}

func HasQQBotIdentity(userID int) (bool, error) {
	var count int64
	err := DB.Model(&ExternalIdentityClaim{}).Where("user_id = ? AND (provider = ? OR provider LIKE ?)",
		userID, QQBotIdentityProvider, qqBotGroupProvider+"%").Count(&count).Error
	return count != 0, err
}

func GetQQBotUser(appID, openID string) (*User, error) {
	return getQQBotUser(QQBotIdentityProvider, qqBotIdentitySubject(appID, openID))
}

func GetQQBotGroupUser(appID, groupID, memberID string) (*User, error) {
	return getQQBotUser(qqBotGroupIdentityProvider(appID, groupID), qqBotIdentitySubject(appID, groupID+"\x00"+memberID))
}

func getQQBotUser(provider, subject string) (*User, error) {
	var claim ExternalIdentityClaim
	if err := DB.Select("user_id").Where("provider = ? AND subject = ?", provider, subject).Take(&claim).Error; err != nil {
		return nil, err
	}
	return GetSelfUserById(claim.UserId)
}

// ClaimQQBotAccountAction permits a signed QQ message to change account state
// once, including when Redis is disabled or the bot restarts.
func ClaimQQBotAccountAction(appID, openID, messageID string) error {
	now := time.Now()
	return DB.Create(&AuthFlow{
		TokenHash: authFlowTokenHash("qq_bot_action:" + qqBotIdentitySubject(appID, openID) + ":" + messageID),
		Purpose:   "qq_bot_action", ExpiresAt: now.Add(24 * time.Hour), ConsumedAt: &now,
	}).Error
}
