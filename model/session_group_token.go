package model

import (
	"errors"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"gorm.io/gorm"
)

var (
	ErrSessionTokenGroupForbidden = errors.New("token group is not available to this user")
	ErrSessionTokenNameConflict   = errors.New("usable token names must be unique")
	ErrSessionTokenLimitReached   = errors.New("user token limit reached")
)

// EnsureSessionGroupToken serializes provisioning with the authoritative user
// and session rows, so a repeated SSO request cannot create a second token.
func EnsureSessionGroupToken(identity AuthSessionIdentity, group, name string, groupAllowed func(string, string) bool) (*Token, bool, int, error) {
	var result *Token
	created := false
	actorRole := 0
	err := DB.Transaction(func(tx *gorm.DB) error {
		if common.UsingMainDatabase(common.DatabaseTypeSQLite) {
			// Acquire SQLite's writer lock before taking the transaction snapshot.
			if err := tx.Model(&User{}).Where("id = ?", identity.UserID).UpdateColumn("auth_version", gorm.Expr("auth_version")).Error; err != nil {
				return err
			}
		}
		if err := ValidateAuthSessionWithTx(tx, identity); err != nil {
			return err
		}
		var user User
		if err := tx.First(&user, identity.UserID).Error; err != nil {
			return err
		}
		actorRole = user.Role
		if !groupAllowed(user.Group, group) {
			return ErrSessionTokenGroupForbidden
		}
		var tokens []*Token
		if err := tx.Where("user_id = ?", identity.UserID).Order("id ASC").Find(&tokens).Error; err != nil {
			return err
		}
		now := common.GetTimestamp()
		usable := make([]*Token, 0, len(tokens))
		nameCounts := make(map[string]int, len(tokens))
		for _, token := range tokens {
			if token.Status != common.TokenStatusEnabled || strings.TrimSpace(token.Key) == "" || strings.TrimSpace(token.Name) == "" ||
				(token.ExpiredTime != -1 && token.ExpiredTime < now) || (!token.UnlimitedQuota && token.RemainQuota <= 0) {
				continue
			}
			usable = append(usable, token)
			nameCounts[strings.TrimSpace(token.Name)]++
		}
		for _, token := range usable {
			candidateGroup := strings.TrimSpace(token.Group)
			if config := strings.TrimSpace(token.GroupRouteConfig); config != "" {
				_, routes, err := NormalizeTokenGroupRouteConfig(config)
				if err != nil || len(routes) == 0 {
					continue
				}
				routes = EnabledTokenGroupRoutes(routes)
				if len(routes) != 1 {
					continue
				}
				candidateGroup = routes[0].Group
			} else if candidateGroup == "" {
				candidateGroup = strings.TrimSpace(user.Group)
			}
			if candidateGroup != group {
				continue
			}
			if nameCounts[strings.TrimSpace(token.Name)] != 1 {
				return ErrSessionTokenNameConflict
			}
			result = token
			return nil
		}
		if nameCounts[name] != 0 {
			return ErrSessionTokenNameConflict
		}
		if len(tokens) >= operation_setting.GetMaxUserTokens() {
			return ErrSessionTokenLimitReached
		}
		key, err := common.GenerateKey()
		if err != nil {
			return err
		}
		result = &Token{
			UserId: identity.UserID, Name: name, Key: key, Group: group,
			Status: common.TokenStatusEnabled, CreatedTime: now, AccessedTime: now,
			ExpiredTime: -1, UnlimitedQuota: true,
		}
		if err := tx.Create(result).Error; err != nil {
			return err
		}
		created = true
		return nil
	})
	if err != nil {
		return nil, false, actorRole, err
	}
	return result, created, actorRole, nil
}
