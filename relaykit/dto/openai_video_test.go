package dto

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestOpenAIVideoSetProgressStr(t *testing.T) {
	for _, tc := range []struct {
		input string
		want  int
	}{
		{"0%", 0},
		{"22%", 22},
		{"22.7%", 23},
		{"22.3%", 22},
		{" 22.7% ", 23},
		{"100%", 100},
		{"-1%", 0},
		{"101%", 100},
		{"", 0},
		{"invalid", 0},
		{"NaN", 0},
		{"+Inf", 0},
	} {
		t.Run(tc.input, func(t *testing.T) {
			video := &OpenAIVideo{Progress: 42}
			video.SetProgressStr(tc.input)
			assert.Equal(t, tc.want, video.Progress)
		})
	}
}
