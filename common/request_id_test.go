package common

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestMessageWithoutRequestId(t *testing.T) {
	assert.Equal(
		t,
		"upstream overloaded",
		MessageWithoutRequestId("upstream overloaded (request id: 20260709120000abcdef)"),
	)
	assert.Equal(
		t,
		"upstream overloaded",
		MessageWithoutRequestId("upstream overloaded (request_id: 20260709120000abcdef)"),
	)
	assert.Equal(
		t,
		"upstream overloaded",
		MessageWithoutRequestId("upstream overloaded (requestid: 20260709120000abcdef)"),
	)
	assert.Equal(
		t,
		"upstream overloaded",
		MessageWithoutRequestId("upstream overloaded (request id: upstream) (request id: proxy)"),
	)
	assert.Equal(
		t,
		"missing field (request id: is required)",
		MessageWithoutRequestId("missing field (request id: is required)"),
	)
	assert.Equal(t, "upstream overloaded", MessageWithoutRequestId(" upstream overloaded "))
}
