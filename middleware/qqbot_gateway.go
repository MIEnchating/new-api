package middleware

import (
	"context"
	"errors"
	"slices"

	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
)

type qqBotGroupKey struct{}

type qqBotGroupSelection struct {
	tokenID int
	group   string
}

// WithQQBotTokenGroup carries a group selection on an in-process HTTP request.
// Network clients have no header or body field that can set this context.
func WithQQBotTokenGroup(ctx context.Context, tokenID int, group string) context.Context {
	return context.WithValue(ctx, qqBotGroupKey{}, qqBotGroupSelection{tokenID: tokenID, group: group})
}

func restrictQQBotTokenGroup(token *model.Token, userGroup string, selection qqBotGroupSelection, path string) (*model.Token, error) {
	selectionDenied := errors.New("QQ bot token group selection denied")
	switch path {
	case "/v1/chat/completions", "/v1/responses", "/v1/messages":
	default:
		return nil, selectionDenied
	}
	if token.Id != selection.tokenID || !service.IsUserSelectableGroup(userGroup, selection.group) {
		return nil, selectionDenied
	}
	groups, err := service.TokenModelGroups(token, userGroup)
	if err != nil || !slices.Contains(groups, selection.group) {
		return nil, selectionDenied
	}
	// Keep the authenticated token identity and limits, while pinning this
	// request to one allowed group without changing the saved token policy.
	selected := *token
	selected.Group = selection.group
	selected.AutoGroups = ""
	selected.GroupRouteConfig = ""
	selected.GroupRouteSticky = false
	selected.CrossGroupRetry = false
	return &selected, nil
}
