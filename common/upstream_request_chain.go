package common

// UpstreamRequestNode identifies one observable hop in an upstream response.
type UpstreamRequestNode struct {
	ID      string `json:"id"`
	Source  string `json:"source"`
	Service string `json:"service"`
	Role    string `json:"role"`
}

// UpstreamRequestAttempt groups response IDs by outbound transport attempt.
// Stored snapshots are immutable: writers replace the slice and changed entry.
type UpstreamRequestAttempt struct {
	Attempt     int                   `json:"attempt"`
	ChannelID   int                   `json:"channel_id"`
	ChannelType string                `json:"channel_type"`
	Nodes       []UpstreamRequestNode `json:"nodes"`
}
