package model

import (
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

type groupRenameEffects struct {
	userIDs             []int
	subscriptionPlanIDs []int
	channelsChanged     bool
}

// UpdateGroupSettingsAndReferences commits a group-settings snapshot together
// with every live database reference whose meaning depends on the group name.
func UpdateGroupSettingsAndReferences(optionValues map[string]string, renames map[string]string) error {
	if len(renames) == 0 {
		return UpdateOptionsBulk(optionValues)
	}
	for key, value := range optionValues {
		if err := validateOptionValue(key, value); err != nil {
			return err
		}
	}

	effects := groupRenameEffects{}
	err := DB.Transaction(func(tx *gorm.DB) error {
		if err := updateOptionsWithTx(tx, optionValues); err != nil {
			return err
		}
		if err := renameUserGroupsWithTx(tx, renames, &effects); err != nil {
			return err
		}
		if err := renameTokenGroupsWithTx(tx, renames); err != nil {
			return err
		}
		if err := renameChannelGroupsWithTx(tx, renames, &effects); err != nil {
			return err
		}
		if err := renameSubscriptionGroupsWithTx(tx, renames, &effects); err != nil {
			return err
		}
		return renameUnsettledTaskGroupsWithTx(tx, renames)
	})
	if err != nil {
		return err
	}

	if effects.channelsChanged {
		InitChannelCache()
	}
	if err := publishOptionUpdates(optionValues); err != nil {
		return err
	}
	for _, userID := range effects.userIDs {
		if err := RefreshUserGroupCache(userID); err != nil {
			common.SysError(fmt.Sprintf("failed to refresh user group cache after group rename for user %d: %v", userID, err))
		}
	}
	for _, planID := range effects.subscriptionPlanIDs {
		InvalidateSubscriptionPlanCache(planID)
	}
	return nil
}

func renameUserGroupsWithTx(tx *gorm.DB, renames map[string]string, effects *groupRenameEffects) error {
	sources := groupRenameSources(renames)
	var users []User
	if err := tx.Select("id", commonGroupCol, "deleted_at").
		Where(commonGroupCol+" IN ?", sources).
		Find(&users).Error; err != nil {
		return err
	}
	for _, user := range users {
		effects.userIDs = append(effects.userIDs, user.Id)
	}
	for source, target := range renames {
		if err := tx.Unscoped().Model(&User{}).
			Where(commonGroupCol+" = ?", source).
			Update("group", target).Error; err != nil {
			return err
		}
	}
	return nil
}

func renameTokenGroupsWithTx(tx *gorm.DB, renames map[string]string) error {
	var tokens []Token
	if err := tx.Unscoped().
		Where(commonGroupCol+" IN ? OR auto_groups <> ? OR group_route_config <> ?", groupRenameSources(renames), "", "").
		Find(&tokens).Error; err != nil {
		return err
	}

	changedTokens := make([]Token, 0)
	for i := range tokens {
		changed := false
		if target, ok := renames[tokens[i].Group]; ok {
			tokens[i].Group = target
			changed = true
		}
		if tokens[i].AutoGroups != "" {
			groups, err := tokens[i].GetAutoGroups()
			if err != nil {
				return fmt.Errorf("rename token %d auto groups: %w", tokens[i].Id, err)
			}
			if renameGroupNames(groups, renames) {
				if err := tokens[i].SetAutoGroups(groups); err != nil {
					return fmt.Errorf("rename token %d auto groups: %w", tokens[i].Id, err)
				}
				changed = true
			}
		}
		if strings.TrimSpace(tokens[i].GroupRouteConfig) != "" {
			var routes []TokenGroupRoute
			if err := common.UnmarshalJsonStr(tokens[i].GroupRouteConfig, &routes); err != nil {
				return fmt.Errorf("rename token %d group routes: %w", tokens[i].Id, err)
			}
			for routeIndex := range routes {
				if target, ok := renames[routes[routeIndex].Group]; ok {
					routes[routeIndex].Group = target
					changed = true
				}
			}
			if changed {
				encoded, err := common.Marshal(routes)
				if err != nil {
					return err
				}
				tokens[i].GroupRouteConfig = string(encoded)
			}
		}
		if changed {
			changedTokens = append(changedTokens, tokens[i])
		}
	}

	if err := invalidateTokensCache(changedTokens); err != nil {
		return err
	}
	for _, token := range changedTokens {
		if err := tx.Unscoped().Model(&Token{}).Where("id = ?", token.Id).Updates(map[string]any{
			"group":              token.Group,
			"auto_groups":        token.AutoGroups,
			"group_route_config": token.GroupRouteConfig,
		}).Error; err != nil {
			return err
		}
	}
	return nil
}

func renameChannelGroupsWithTx(tx *gorm.DB, renames map[string]string, effects *groupRenameEffects) error {
	var channels []Channel
	if err := tx.Where(commonGroupCol+" <> ?", "").Find(&channels).Error; err != nil {
		return err
	}
	for i := range channels {
		groups := channels[i].GetGroups()
		if !renameGroupNames(groups, renames) {
			continue
		}
		channels[i].Group = strings.Join(uniqueGroupNames(groups), ",")
		if utf8.RuneCountInString(channels[i].Group) > 64 {
			return fmt.Errorf("renamed group list for channel %d exceeds 64 characters", channels[i].Id)
		}
		if err := tx.Model(&Channel{}).Where("id = ?", channels[i].Id).
			Update("group", channels[i].Group).Error; err != nil {
			return err
		}
		if err := channels[i].UpdateAbilities(tx); err != nil {
			return err
		}
		effects.channelsChanged = true
	}
	return nil
}

func renameSubscriptionGroupsWithTx(tx *gorm.DB, renames map[string]string, effects *groupRenameEffects) error {
	var plans []SubscriptionPlan
	if err := tx.Select("id").Where(
		"upgrade_group IN ? OR downgrade_group IN ?",
		groupRenameSources(renames), groupRenameSources(renames),
	).Find(&plans).Error; err != nil {
		return err
	}
	for _, plan := range plans {
		effects.subscriptionPlanIDs = append(effects.subscriptionPlanIDs, plan.Id)
	}
	for source, target := range renames {
		if err := tx.Model(&SubscriptionPlan{}).Where("upgrade_group = ?", source).
			Update("upgrade_group", target).Error; err != nil {
			return err
		}
		if err := tx.Model(&SubscriptionPlan{}).Where("downgrade_group = ?", source).
			Update("downgrade_group", target).Error; err != nil {
			return err
		}
		for _, column := range []string{"upgrade_group", "prev_user_group", "downgrade_group"} {
			if err := tx.Model(&UserSubscription{}).Where(column+" = ?", source).
				Update(column, target).Error; err != nil {
				return err
			}
		}
	}
	return nil
}

func renameUnsettledTaskGroupsWithTx(tx *gorm.DB, renames map[string]string) error {
	for source, target := range renames {
		if err := tx.Model(&Task{}).
			Where(commonGroupCol+" = ? AND status NOT IN ?", source, []TaskStatus{TaskStatusSuccess, TaskStatusFailure}).
			Update("group", target).Error; err != nil {
			return err
		}
	}
	return nil
}

func groupRenameSources(renames map[string]string) []string {
	sources := make([]string, 0, len(renames))
	for source := range renames {
		sources = append(sources, source)
	}
	return sources
}

func renameGroupNames(groups []string, renames map[string]string) bool {
	changed := false
	for index, group := range groups {
		if target, ok := renames[group]; ok {
			groups[index] = target
			changed = true
		}
	}
	return changed
}

func uniqueGroupNames(groups []string) []string {
	result := make([]string, 0, len(groups))
	seen := make(map[string]struct{}, len(groups))
	for _, group := range groups {
		if _, ok := seen[group]; ok {
			continue
		}
		seen[group] = struct{}{}
		result = append(result, group)
	}
	return result
}
