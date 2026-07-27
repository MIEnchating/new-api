package service

import (
	"fmt"

	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/gin-gonic/gin"
)

const ginKeyRequestErrorRoutingDecision = "request_error_routing_decision"

type requestErrorRoutingDecision struct {
	err         *types.NewAPIError
	fingerprint requestErrorRoutingFingerprint
	actions     operation_setting.RequestErrorRoutingActions
	matched     bool
}

type requestErrorRoutingFingerprint struct {
	statusCode   int
	errorCode    types.ErrorCode
	errorType    types.ErrorType
	message      string
	internal     string
	relayKind    string
	relayType    string
	relayCode    string
	relayMessage string
}

func newRequestErrorRoutingFingerprint(err *types.NewAPIError) requestErrorRoutingFingerprint {
	if err == nil {
		return requestErrorRoutingFingerprint{}
	}
	fingerprint := requestErrorRoutingFingerprint{
		statusCode: err.StatusCode,
		errorCode:  err.GetErrorCode(),
		errorType:  err.GetErrorType(),
		message:    err.Error(),
	}
	if internalErr := err.InternalError(); internalErr != nil {
		fingerprint.internal = internalErr.Error()
	}
	switch relayErr := err.RelayError.(type) {
	case types.OpenAIError:
		fingerprint.relayKind = "openai"
		fingerprint.relayType = relayErr.Type
		fingerprint.relayCode = fmt.Sprint(relayErr.Code)
		fingerprint.relayMessage = relayErr.Message
	case *types.OpenAIError:
		fingerprint.relayKind = "openai_ptr"
		if relayErr != nil {
			fingerprint.relayType = relayErr.Type
			fingerprint.relayCode = fmt.Sprint(relayErr.Code)
			fingerprint.relayMessage = relayErr.Message
		}
	case types.ClaudeError:
		fingerprint.relayKind = "claude"
		fingerprint.relayType = relayErr.Type
		fingerprint.relayMessage = relayErr.Message
	case *types.ClaudeError:
		fingerprint.relayKind = "claude_ptr"
		if relayErr != nil {
			fingerprint.relayType = relayErr.Type
			fingerprint.relayMessage = relayErr.Message
		}
	default:
		fingerprint.relayKind = fmt.Sprintf("%T", relayErr)
		fingerprint.relayMessage = fmt.Sprint(relayErr)
	}
	return fingerprint
}

// ResolveRequestErrorRoutingForContext evaluates routing rules once for each
// failure object. Retry, failover, cooldown and auto-disable checks for the same
// failed attempt then reuse the decision stored on the request context.
func ResolveRequestErrorRoutingForContext(c *gin.Context, err *types.NewAPIError) (operation_setting.RequestErrorRoutingActions, bool) {
	if c == nil {
		return operation_setting.ResolveRequestErrorRouting(err)
	}
	fingerprint := newRequestErrorRoutingFingerprint(err)
	if cached, exists := c.Get(ginKeyRequestErrorRoutingDecision); exists {
		if decision, ok := cached.(requestErrorRoutingDecision); ok &&
			decision.err == err && decision.fingerprint == fingerprint {
			return decision.actions, decision.matched
		}
	}

	actions, matched := operation_setting.ResolveRequestErrorRouting(err)
	c.Set(ginKeyRequestErrorRoutingDecision, requestErrorRoutingDecision{
		err:         err,
		fingerprint: fingerprint,
		actions:     actions,
		matched:     matched,
	})
	return actions, matched
}
