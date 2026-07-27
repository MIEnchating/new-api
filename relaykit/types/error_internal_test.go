package types

import (
	"errors"
	"fmt"
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestHideErrorMessagePreservesInternalError(t *testing.T) {
	original := errors.New("dial tcp: connection reset by peer")
	inner := NewError(original, ErrorCodeDoRequestFailed, ErrOptionWithHideErrMsg("upstream error: do request failed"))
	err := NewOpenAIError(fmt.Errorf("do request failed: %w", inner), ErrorCodeDoRequestFailed, http.StatusInternalServerError)

	require.EqualError(t, err, "upstream error: do request failed")
	require.ErrorIs(t, err.InternalError(), original)

	err.ExposeOriginalErrorForResponse()
	require.EqualError(t, err, original.Error())
	require.Equal(t, original.Error(), err.ToOpenAIError().Message)
}
