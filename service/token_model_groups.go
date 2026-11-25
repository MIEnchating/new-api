package service

import "github.com/QuantumNous/new-api/model"

// TokenModelGroups reports the groups of a token whose routing template has
// already been resolved. The account group is the fallback for legacy keys.
func TokenModelGroups(token *model.Token, userGroup string) ([]string, error) {
	_, routes, err := model.NormalizeTokenGroupRouteConfig(token.GroupRouteConfig)
	if err != nil {
		return nil, err
	}
	if len(routes) > 0 {
		enabled := model.EnabledTokenGroupRoutes(routes)
		groups := make([]string, 0, len(enabled))
		for _, route := range enabled {
			groups = append(groups, route.Group)
		}
		return groups, nil
	}
	if token.Group != "" && token.Group != "auto" {
		return []string{token.Group}, nil
	}
	if userGroup == "" {
		userGroup, err = model.GetUserGroup(token.UserId, false)
		if err != nil {
			return nil, err
		}
	}
	if token.Group == "" {
		return []string{userGroup}, nil
	}
	autoGroups, err := token.GetAutoGroups()
	if err != nil {
		return nil, err
	}
	if len(autoGroups) > 0 {
		return FilterUserTokenAutoGroups(userGroup, autoGroups), nil
	}
	return GetUserAutoGroup(userGroup), nil
}
