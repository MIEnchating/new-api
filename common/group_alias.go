package common

import (
	"fmt"
	"maps"
	"slices"
	"sync/atomic"
)

// GroupAliasesOptionKey records names in the order they were first introduced.
// Restoring a name never reverses these edges or changes a group identity.
// The active name belongs to GroupRatio, not to this append-only history.
const GroupAliasesOptionKey = "GroupRenameAliases"

// GroupAliasHistory is an immutable view shared by runtime lookups and
// transaction validation. Building it does not publish uncommitted aliases.
type GroupAliasHistory struct {
	aliases    map[string]string
	names      map[string][]string
	identities map[string]string
}

var groupAliasState atomic.Pointer[GroupAliasHistory]

// RefreshGroupAliases is installed by the host model at startup. Lookups only
// consult the database on a missing group, not on every request or ratio read.
var RefreshGroupAliases = func() error { return nil }

func GetGroupAliases() map[string]string {
	if state := groupAliasState.Load(); state != nil {
		return maps.Clone(state.aliases)
	}
	return map[string]string{}
}

func NewGroupAliasHistory(aliases map[string]string) (*GroupAliasHistory, error) {
	state := &GroupAliasHistory{aliases: maps.Clone(aliases), names: make(map[string][]string), identities: make(map[string]string)}
	previous := make(map[string]string)
	for source, target := range aliases {
		if _, duplicate := previous[target]; duplicate {
			return nil, fmt.Errorf("invalid group rename history")
		}
		previous[target] = source
	}
	for source := range aliases {
		name := source
		seen := make(map[string]bool)
		for {
			if name == "" || name == "auto" || seen[name] {
				return nil, fmt.Errorf("invalid group rename history")
			}
			seen[name] = true
			next, ok := aliases[name]
			if !ok {
				break
			}
			name = next
		}
		state.names[name] = append(state.names[name], source)
	}
	for name, previous := range state.names {
		slices.Sort(previous)
		state.names[name] = append([]string{name}, previous...)
	}
	for source := range aliases {
		name := source
		for aliases[name] != "" {
			name = aliases[name]
		}
		state.names[source] = state.names[name]
	}
	for name := range state.names {
		identity := name
		for previous[identity] != "" {
			identity = previous[identity]
		}
		state.identities[name] = identity
	}
	return state, nil
}

func SetGroupAliases(aliases map[string]string) error {
	state, err := NewGroupAliasHistory(aliases)
	if err != nil {
		return err
	}
	groupAliasState.Store(state)
	return nil
}

func (history *GroupAliasHistory) Identity(name string) string {
	if identity, exists := history.identities[name]; exists {
		return identity
	}
	return name
}

// Names returns equivalent names, newest introduced name first. That name
// need not be active: a group can restore any of its historical names.
func (history *GroupAliasHistory) Names(name string) []string {
	if names, exists := history.names[name]; exists {
		return slices.Clone(names)
	}
	return []string{name}
}

// GroupIdentity keeps rate-limit counters and route cooldowns attached to the
// original group even when requests on different nodes carry different names.
func GroupIdentity(name string) string {
	if state := groupAliasState.Load(); state != nil {
		return state.Identity(name)
	}
	return name
}

// GroupNames returns equivalent names, newest introduced name first. The
// caller owns the returned slice. It never makes unrelated groups equivalent.
func GroupNames(name string) []string {
	if state := groupAliasState.Load(); state != nil {
		return state.Names(name)
	}
	return []string{name}
}

// LookupGroup reads whichever name belongs to this cache generation. Exact
// matches win, so unrelated configuration changes retain their usual behavior.
func LookupGroup[T any](name string, lookup func(string) (T, bool)) (T, bool) {
	if value, ok := lookup(name); ok {
		return value, true
	}
	for _, candidate := range GroupNames(name) {
		if candidate == name {
			continue
		}
		if value, ok := lookup(candidate); ok {
			return value, true
		}
	}
	var zero T
	return zero, false
}

func LookupGroupWithRefresh[T any](name string, lookup func(string) (T, bool)) (T, bool) {
	if value, ok := LookupGroup(name, lookup); ok {
		return value, true
	}
	if err := RefreshGroupAliases(); err != nil {
		var zero T
		return zero, false
	}
	return LookupGroup(name, lookup)
}
