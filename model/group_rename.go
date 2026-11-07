package model

import (
	"errors"
	"fmt"
	"strings"
	"sync"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var groupAliasRefreshMutex sync.Mutex

func init() {
	common.RefreshGroupAliases = refreshGroupAliases
}

func refreshGroupAliases() error {
	groupAliasRefreshMutex.Lock()
	defer groupAliasRefreshMutex.Unlock()
	if DB == nil {
		return nil
	}
	var option Option
	if err := DB.Where(&Option{Key: common.GroupAliasesOptionKey}).Find(&option).Error; err != nil {
		return err
	}
	aliases := map[string]string{}
	if option.Value != "" {
		if err := common.UnmarshalJsonStr(option.Value, &aliases); err != nil {
			return err
		}
	}
	return common.SetGroupAliases(aliases)
}

// lockGroupAliases serializes renames and writes to the group registry across
// nodes. SQLite serializes the initial write; other engines lock the row.
func lockGroupAliases(tx *gorm.DB) (*Option, map[string]string, error) {
	option := Option{Key: common.GroupAliasesOptionKey, Value: "{}"}
	if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&option).Error; err != nil {
		return nil, nil, err
	}
	if err := lockForUpdate(tx).Where(&Option{Key: option.Key}).First(&option).Error; err != nil {
		return nil, nil, err
	}
	aliases := map[string]string{}
	if err := common.UnmarshalJsonStr(option.Value, &aliases); err != nil {
		return nil, nil, err
	}
	return &option, aliases, nil
}

func validateGroupNamesWithTx(tx *gorm.DB, values map[string]string, renames map[string]string) error {
	for _, key := range []string{"GroupRatio", "group_ratio_setting.group_ratio"} {
		value, ok := values[key]
		if !ok {
			continue
		}
		_, aliases, err := lockGroupAliases(tx)
		if err != nil {
			return err
		}
		history, err := common.NewGroupAliasHistory(aliases)
		if err != nil {
			return err
		}
		var option Option
		if err := tx.Where(&Option{Key: "GroupRatio"}).Find(&option).Error; err != nil {
			return err
		}
		current := ratio_setting.GetGroupRatioCopy()
		if option.Value != "" {
			current = nil
			if err := common.UnmarshalJsonStr(option.Value, &current); err != nil {
				return err
			}
		}
		for source, target := range renames {
			delete(current, source)
			current[target] = 0
		}
		var groups map[string]float64
		if err := common.UnmarshalJsonStr(value, &groups); err != nil {
			return err
		}
		seen := make(map[string]bool)
		for name := range groups {
			_, active := current[name]
			identity := history.Identity(name)
			if (len(history.Names(name)) > 1 && !active) || seen[identity] {
				return errors.New("Retired group names cannot be reused")
			}
			seen[identity] = true
		}
	}
	return nil
}

type groupRenameEffects struct {
	userIDs             []int
	subscriptionPlanIDs []int
	channelsChanged     bool
	tokens              []Token
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
		option, aliases, err := lockGroupAliases(tx)
		if err != nil {
			return err
		}
		var ratioOption Option
		if err := tx.Where(&Option{Key: "GroupRatio"}).Find(&ratioOption).Error; err != nil {
			return err
		}
		groups := ratio_setting.GetGroupRatioCopy()
		if ratioOption.Value != "" {
			groups = nil
			if err := common.UnmarshalJsonStr(ratioOption.Value, &groups); err != nil {
				return err
			}
		}
		history, err := common.NewGroupAliasHistory(aliases)
		if err != nil {
			return err
		}
		for source, target := range renames {
			if _, exists := groups[source]; !exists {
				return fmt.Errorf("source group %s does not exist", source)
			}
			if _, exists := groups[target]; exists {
				return fmt.Errorf("target group %s already exists", target)
			}
			if history.Identity(source) == history.Identity(target) {
				continue // Restore this group's own name without creating a cycle.
			}
			if len(history.Names(target)) > 1 {
				return errors.New("Retired group names cannot be reused")
			}
			// Append after the last introduced name, even if source is an older
			// restored name. Rewriting source would orphan intermediate names.
			aliases[history.Names(source)[0]] = target
		}
		encoded, err := common.Marshal(aliases)
		if err != nil {
			return err
		}
		if err := tx.Model(option).Update("value", string(encoded)).Error; err != nil {
			return err
		}
		if err := updateOptionsWithTx(tx, optionValues, renames); err != nil {
			return err
		}
		if err := renameUserGroupsWithTx(tx, renames, &effects); err != nil {
			return err
		}
		if err := renameTokenGroupsWithTx(tx, renames, &effects); err != nil {
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
	// Publish identity history before replacing any local cache. Other nodes
	// can discover the same committed history on a missing-name lookup.
	if err := refreshGroupAliases(); err != nil {
		return err
	}
	// A pre-commit fence can expire during a long transaction. Fence and clear
	// after commit; in-flight old snapshots remain usable through aliases.
	if err := invalidateTokensCache(effects.tokens); err != nil {
		common.SysError(common.LogText("failed to refresh token caches after group rename: %s", err.Error()))
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
	if err := tx.Select("id").
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

func renameTokenGroupsWithTx(tx *gorm.DB, renames map[string]string, effects *groupRenameEffects) error {
	var tokens []Token
	conditions := make([]string, 0, len(renames)*3)
	args := make([]any, 0, len(renames)*3)
	for source := range renames {
		conditions = append(conditions,
			commonGroupCol+" = ? OR auto_groups LIKE ? OR group_route_config LIKE ?")
		args = append(args, source, "%"+source+"%", "%"+source+"%")
	}
	if err := tx.Unscoped().
		Select("id", commonKeyCol, "group", "auto_groups", "group_route_config").
		Where(strings.Join(conditions, " OR "), args...).
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

	effects.tokens = changedTokens
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
