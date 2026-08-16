package ratio_setting

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestPerplexityLargeSonarDefaultRatiosAreBillable(t *testing.T) {
	for _, model := range []string{
		"llama-3-sonar-large-32k-chat",
		"llama-3-sonar-large-32k-online",
	} {
		t.Run(model, func(t *testing.T) {
			assert.Equal(t, 0.5, defaultModelRatio[model])
		})
	}
}
