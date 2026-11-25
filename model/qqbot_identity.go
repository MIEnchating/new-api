package model

import (
	"crypto/sha256"
	"encoding/hex"
	"time"

	"gorm.io/gorm"
)

const (
	QQBotIdentityProvider = "qq_bot"
	qqBotBindingPurpose   = "qq_bot_bind"
)

func qqBotIdentitySubject(appID, openID string) string {
	digest := sha256.Sum256([]byte(appID + "\x00" + openID))
	return hex.EncodeToString(digest[:])
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
		if err := ValidateAuthSessionWithTx(tx, identity); err != nil {
			return err
		}
		return ReleaseExternalIdentityWithTx(tx, QQBotIdentityProvider, identity.UserID)
	})
}

func HasQQBotIdentity(userID int) (bool, error) {
	var count int64
	err := DB.Model(&ExternalIdentityClaim{}).Where("provider = ? AND user_id = ?", QQBotIdentityProvider, userID).Count(&count).Error
	return count != 0, err
}

func GetQQBotUser(appID, openID string) (*User, error) {
	var claim ExternalIdentityClaim
	if err := DB.Select("user_id").Where("provider = ? AND subject = ?", QQBotIdentityProvider, qqBotIdentitySubject(appID, openID)).Take(&claim).Error; err != nil {
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
