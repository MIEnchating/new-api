package common

import (
	"strings"
	"unicode"

	"github.com/tidwall/gjson"
)

const maxActualResponseModelRunes = 100

var actualResponseModelPaths = [...]string{
	"response.model",
	"model",
	"item.model",
	"session.model",
}

// ExtractActualResponseModel returns a bounded model identifier from an
// upstream OpenAI-compatible JSON message. It does not retain the payload.
func ExtractActualResponseModel(data []byte) string {
	if len(data) == 0 || !gjson.ValidBytes(data) {
		return ""
	}
	for _, path := range actualResponseModelPaths {
		value := gjson.GetBytes(data, path)
		if value.Type != gjson.String {
			continue
		}
		model := strings.TrimSpace(value.String())
		if model == "" {
			continue
		}
		runes := []rune(model)
		if len(runes) > maxActualResponseModelRunes {
			continue
		}
		valid := true
		for _, r := range runes {
			if unicode.IsControl(r) {
				valid = false
				break
			}
		}
		if valid {
			return model
		}
	}
	return ""
}
