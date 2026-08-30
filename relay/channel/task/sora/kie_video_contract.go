package sora

import (
	"fmt"
	"strconv"
	"strings"
)

// kieVideoContract mirrors the input contract used by the reference KIE
// integration.  Keeping this table here prevents the compatibility envelope
// from leaking unsupported fields to individual model endpoints.
type kieVideoContract struct {
	aspect, duration, resolution, image, video, audio string
	imageArray, videoArray, audioArray                bool
	min, max                                          int
}

func kieVideoModelContract(model string) kieVideoContract {
	m := strings.ToLower(strings.TrimSpace(model))
	contracts := map[string]kieVideoContract{
		"bytedance/seedance-1.5-pro":           {aspect: "aspect_ratio", duration: "number", resolution: "resolution", image: "input_urls"},
		"bytedance/seedance-2":                 {aspect: "aspect_ratio", duration: "number", resolution: "resolution", image: "reference_image_urls", video: "reference_video_urls", audio: "reference_audio_urls"},
		"bytedance/seedance-2-fast":            {aspect: "aspect_ratio", duration: "number", resolution: "resolution", image: "reference_image_urls", video: "reference_video_urls", audio: "reference_audio_urls"},
		"bytedance/seedance-2-mini":            {aspect: "aspect_ratio", duration: "number", resolution: "resolution", image: "reference_image_urls", video: "reference_video_urls", audio: "reference_audio_urls"},
		"bytedance/seedance-2-5":               {aspect: "aspect_ratio", duration: "number", resolution: "resolution", image: "reference_image_urls", video: "reference_video_urls", audio: "reference_audio_urls", min: 4, max: 30},
		"bytedance/v1-lite-image-to-video":     {duration: "string", resolution: "resolution", image: "image_url"},
		"bytedance/v1-lite-text-to-video":      {aspect: "aspect_ratio", duration: "string", resolution: "resolution"},
		"bytedance/v1-pro-fast-image-to-video": {duration: "string", resolution: "resolution", image: "image_url"},
		"bytedance/v1-pro-image-to-video":      {duration: "string", resolution: "resolution", image: "image_url"},
		"bytedance/v1-pro-text-to-video":       {aspect: "aspect_ratio", duration: "string", resolution: "resolution"},
		"gemini-omni-video":                    {aspect: "aspect_ratio", duration: "string", resolution: "resolution", image: "image_urls", video: "video_list", audio: "audio_ids"},
		"grok-imagine/image-to-video":          {aspect: "aspect_ratio", duration: "string", resolution: "resolution", image: "image_urls", min: 6, max: 30},
		"grok-imagine/text-to-video":           {aspect: "aspect_ratio", duration: "string", resolution: "resolution", min: 6, max: 30},
		"grok-imagine-video-1-5-preview":       {aspect: "aspect_ratio", duration: "number", resolution: "resolution", image: "image_urls"},
		"happyhorse/image-to-video":            {duration: "number", resolution: "resolution", image: "image_urls"},
		"happyhorse/reference-to-video":        {aspect: "aspect_ratio", duration: "number", resolution: "resolution", image: "reference_image", imageArray: true},
		"happyhorse/text-to-video":             {aspect: "aspect_ratio", duration: "number", resolution: "resolution"},
		"happyhorse/video-edit":                {resolution: "resolution", image: "reference_image", imageArray: true, video: "video_url"},
		"happyhorse-1-1/text-to-video":         {aspect: "aspect_ratio", duration: "number", resolution: "resolution"},
		"happyhorse-1-1/image-to-video":        {duration: "number", resolution: "resolution", image: "image_urls"},
		"happyhorse-1-1/reference-to-video":    {aspect: "aspect_ratio", duration: "number", resolution: "resolution", image: "reference_image", imageArray: true},
		"minimax-h3/text-to-video":             {aspect: "aspect_ratio", duration: "number", resolution: "resolution", min: 4, max: 15},
		"minimax-h3/image-to-video":            {duration: "number", resolution: "resolution", image: "first_frame_url", min: 4, max: 15},
		"minimax-h3/reference-to-video":        {aspect: "aspect_ratio", duration: "number", resolution: "resolution", image: "reference_image_urls", video: "reference_video_urls", audio: "reference_audio_urls", min: 4, max: 15},
		"hailuo/02-image-to-video-standard":    {duration: "string", resolution: "resolution", image: "image_url"},
		"hailuo/02-image-to-video-pro":         {duration: "string", resolution: "resolution", image: "image_url"},
		"hailuo/2-3-image-to-video-pro":        {duration: "string", resolution: "resolution", image: "image_url"},
		"hailuo/2-3-image-to-video-standard":   {duration: "string", resolution: "resolution", image: "image_url"},
		"hailuo/02-text-to-video-standard":     {duration: "string"},
		"hailuo/02-text-to-video-pro":          {duration: "string"},
		"kling-2.6/image-to-video":             {duration: "string", image: "image_urls"},
		"kling-2.6/text-to-video":              {aspect: "aspect_ratio", duration: "string"},
		"kling-2.6/motion-control":             {duration: "string", image: "input_urls", video: "video_urls"},
		"kling-3.0/motion-control":             {duration: "string", image: "input_urls", video: "video_urls"},
		"kling-3.0/video":                      {aspect: "aspect_ratio", duration: "string", image: "image_urls"},
		"kling-3.0-omni/text-to-video":         {aspect: "aspect_ratio", duration: "number", resolution: "resolution", min: 3, max: 15},
		"kling-3.0-omni/image-to-video":        {aspect: "aspect_ratio", duration: "number", resolution: "resolution", image: "image_urls", min: 3, max: 15},
		"kling-3.0-omni/reference-to-video":    {aspect: "aspect_ratio", duration: "number", resolution: "resolution", image: "image_urls", video: "video_urls", min: 3, max: 15},
		"kling-3.0-omni/transformation":        {aspect: "aspect_ratio", duration: "number", resolution: "resolution", image: "image_urls", video: "video_urls", min: 3, max: 15},
		"kling/v3-turbo-text-to-video":         {aspect: "aspect_ratio", duration: "string", resolution: "resolution"},
		"kling/v3-turbo-image-to-video":        {duration: "string", resolution: "resolution", image: "image_urls"},
		"kling/ai-avatar-standard":             {image: "image_url", audio: "audio_url"},
		"kling/ai-avatar-pro":                  {image: "image_url", audio: "audio_url"},
		"kling/v2-1-master-image-to-video":     {duration: "string", image: "image_url"},
		"kling/v2-1-master-text-to-video":      {aspect: "aspect_ratio", duration: "string"},
		"kling/v2-1-pro":                       {duration: "string", image: "image_url"},
		"kling/v2-1-standard":                  {duration: "string", image: "image_url"},
		"kling/v2-5-turbo-image-to-video-pro":  {duration: "string", image: "image_url"},
		"kling/v2-5-turbo-text-to-video-pro":   {aspect: "aspect_ratio", duration: "string"},
		"wan/2-2-a14b-image-to-video-turbo":    {resolution: "resolution", image: "image_url"},
		"wan/2-2-a14b-speech-to-video-turbo":   {resolution: "resolution", image: "image_url", audio: "audio_url"},
		"wan/2-2-a14b-text-to-video-turbo":     {aspect: "aspect_ratio", resolution: "resolution"},
		"wan/2-2-animate-move":                 {resolution: "resolution", image: "image_url", video: "video_url"},
		"wan/2-2-animate-replace":              {resolution: "resolution", image: "image_url", video: "video_url"},
		"wan/2-5-image-to-video":               {duration: "string", resolution: "resolution", image: "image_url"},
		"wan/2-5-text-to-video":                {aspect: "aspect_ratio", duration: "string", resolution: "resolution"},
		"wan/2-6-flash-image-to-video":         {duration: "string", resolution: "resolution", image: "image_urls"},
		"wan/2-6-flash-video-to-video":         {duration: "string", resolution: "resolution", video: "video_urls"},
		"wan/2-6-image-to-video":               {duration: "string", resolution: "resolution", image: "image_urls"},
		"wan/2-6-text-to-video":                {duration: "string", resolution: "resolution"},
		"wan/2-6-video-to-video":               {duration: "string", resolution: "resolution", video: "video_urls"},
		"wan/2-7-image-to-video":               {duration: "number", resolution: "resolution", image: "first_frame_url", video: "first_clip_url", audio: "driving_audio_url"},
		"wan/2-7-r2v":                          {aspect: "aspect_ratio", duration: "number", resolution: "resolution", image: "reference_image", imageArray: true, video: "reference_video", videoArray: true, audio: "reference_voice"},
		"wan/2-7-text-to-video":                {aspect: "ratio", duration: "number", resolution: "resolution", audio: "audio_url"},
		"wan/2-7-videoedit":                    {aspect: "aspect_ratio", duration: "number", resolution: "resolution", image: "reference_image", video: "video_url"},
		"topaz/video-upscale":                  {video: "video_url"},
		"infinitalk/from-audio":                {resolution: "resolution", image: "image_url", audio: "audio_url"},
	}
	if c, ok := contracts[m]; ok {
		return c
	}
	// Keep duration for newly added KIE models until their official schema is
	// added to the table; unsupported shape/resolution aliases are still removed.
	return kieVideoContract{duration: "string"}
}

func normalizeKIEVideoContract(model string, payload, input map[string]any) error {
	m := strings.ToLower(strings.TrimSpace(model))
	c := kieVideoModelContract(m)
	// Metadata is flattened into input before this function runs. Keep a
	// snapshot so aliases from either the envelope or metadata are handled.
	source := make(map[string]any, len(input)+len(payload))
	for key, value := range payload {
		source[key] = value
	}
	// Provider metadata is authoritative over compatibility aliases.
	for key, value := range input {
		source[key] = value
	}
	if c.aspect != "" {
		value := firstKIEValue(input, "aspect_ratio", "ratio", "size")
		if value != "" {
			input[c.aspect] = normalizeKIEVideoAspect(value, m)
		}
		for _, key := range []string{"aspect_ratio", "ratio", "size"} {
			if key != c.aspect {
				delete(input, key)
			}
		}
	} else {
		delete(input, "aspect_ratio")
		delete(input, "ratio")
		delete(input, "size")
	}
	if c.resolution == "" {
		delete(input, "resolution")
		delete(input, "image_resolution")
		delete(input, "quality")
	} else if value := firstKIEValue(input, "resolution", "image_resolution", "quality"); value != "" {
		input[c.resolution] = normalizeKIEVideoResolution(value, m)
		delete(input, "image_resolution")
		delete(input, "quality")
	}
	if strings.Contains(m, "motion-control") {
		delete(input, "mode")
	}
	if c.duration == "" {
		delete(input, "duration")
		delete(input, "seconds")
	} else if strings.Contains(m, "motion-control") {
		// Motion-control derives duration from the driving clip.
		delete(input, "duration")
		delete(input, "seconds")
	} else if value := firstKIEValue(input, "duration", "seconds"); value != "" {
		n := normalizeKIEDurationNumber(value)
		if c.min > 0 && n < c.min {
			n = c.min
		}
		if c.max > 0 && n > c.max {
			n = c.max
		}
		if c.duration == "number" {
			input["duration"] = n
		} else {
			input["duration"] = strconv.Itoa(n)
		}
		delete(input, "seconds")
	}
	for _, key := range kieVideoReferenceAliases {
		delete(input, key)
	}
	for _, key := range kieVideoReferenceAliases {
		if value, ok := source[key]; ok {
			if err := setKIEVideoReference(input, m, c, key, value); err != nil {
				return err
			}
		}
	}
	for _, key := range []string{"generation_mode", "reference_mode", "output_format", "watermark", "negative_prompt"} {
		delete(input, key)
	}
	if value, ok := input["preset"]; ok {
		if strings.HasPrefix(m, "grok-imagine/") || m == "kling-3.0/video" {
			input["mode"] = strings.TrimSpace(fmt.Sprint(value))
		}
		delete(input, "preset")
	}
	if strings.HasPrefix(m, "grok-imagine/") {
		mode := strings.ToLower(strings.TrimSpace(fmt.Sprint(input["mode"])))
		if mode != "fun" && mode != "spicy" {
			mode = "normal"
		}
		input["mode"] = mode
	}
	if value, ok := input["video_generate_audio"]; ok {
		delete(input, "video_generate_audio")
		applyKIEVideoAudio(input, m, value)
	} else if value, ok := payload["video_generate_audio"]; ok {
		applyKIEVideoAudio(input, m, value)
	}
	if value, ok := input["generate_audio"]; ok {
		delete(input, "generate_audio")
		applyKIEVideoAudio(input, m, value)
	}
	normalizeKIEKlingV3VideoInput(input, m)
	normalizeKIEKlingOmniVideoInput(input, m)
	applyKIEModelDefaults(input, m)
	if err := validateProviderVideoReferenceURLs(input); err != nil {
		return err
	}
	if err := validateKIERequiredInputs(input, m); err != nil {
		return err
	}
	return nil
}

func resolveKIEVideoModelAlias(model string, payload map[string]any) string {
	m := strings.TrimSpace(model)
	aliases := map[string]string{
		"kling/text-to-video":                   "kling-2.6/text-to-video",
		"kling/image-to-video":                  "kling-2.6/image-to-video",
		"kling/motion-control":                  "kling-2.6/motion-control",
		"kling/motion-control-v3":               "kling-3.0/motion-control",
		"kling/kling-3-0":                       "kling-3.0/video",
		"kling/v25-turbo-image-to-video-pro":    "kling/v2-5-turbo-image-to-video-pro",
		"kling/v25-turbo-text-to-video-pro":     "kling/v2-5-turbo-text-to-video-pro",
		"bytedance/seedance-1-5-pro":            "bytedance/seedance-1.5-pro",
		"grok-imagine/1-5-preview":              "grok-imagine-video-1-5-preview",
		"grok-imagine/grok-imagine-1.5-preview": "grok-imagine-video-1-5-preview",
		"grok-imagine-1.5-video":                "grok-imagine-video-1-5-preview",
		"grok-imagine-1.5-preview":              "grok-imagine-video-1-5-preview",
	}
	if resolved, ok := aliases[strings.ToLower(m)]; ok {
		return resolved
	}
	if strings.EqualFold(m, "grok-imagine") || strings.EqualFold(m, "grok-imagine-video") {
		for _, key := range []string{"image", "images", "image_url", "image_urls", "first_frame_url", "last_frame_url", "first_frame_image", "last_frame_image"} {
			if value, ok := payload[key]; ok && len(kieVideoStrings(value)) > 0 {
				return "grok-imagine/image-to-video"
			}
			if nested, ok := payload["input"].(map[string]any); ok {
				if value, ok := nested[key]; ok && len(kieVideoStrings(value)) > 0 {
					return "grok-imagine/image-to-video"
				}
			}
		}
		return "grok-imagine/text-to-video"
	}
	return m
}

var kieVideoReferenceAliases = []string{"image", "images", "image_url", "image_urls", "input_url", "input_urls", "input_reference", "input_reference[]", "image_input", "reference_image", "reference_images", "reference_image_url", "reference_image_urls", "first_frame_url", "last_frame_url", "end_image_url", "tail_image_url", "video", "videos", "video_url", "video_urls", "input_video_url", "input_video_urls", "video_reference", "video_reference[]", "first_clip_url", "reference_video", "reference_videos", "reference_video_url", "reference_video_urls", "audio", "audios", "audio_url", "audio_urls", "input_audio_url", "input_audio_urls", "reference_audio", "reference_audios", "reference_audio_url", "reference_audio_urls", "audio_reference", "audio_reference[]", "driving_audio_url", "reference_voice", "audio_ids"}

func setKIEVideoReference(input map[string]any, model string, c kieVideoContract, key string, raw any) error {
	values := kieVideoStrings(raw)
	if len(values) == 0 {
		return nil
	}
	field := ""
	switch {
	case strings.Contains(key, "audio") || key == "audios" || key == "driving_audio_url" || key == "reference_voice":
		field = c.audio
	case strings.Contains(key, "video") || key == "videos" || key == "first_clip_url":
		field = c.video
	case (key == "input_reference" || key == "input_reference[]") && kieValuesLookLikeAudio(values) && c.audio != "":
		field = c.audio
	case (key == "input_reference" || key == "input_reference[]") && kieValuesLookLikeVideo(values) && c.video != "":
		field = c.video
	default:
		field = c.image
	}
	if field == "" {
		return nil
	}
	if field == "audio_ids" {
		ids := make([]string, 0, len(values))
		for _, v := range values {
			if strings.HasPrefix(v, "audio_") {
				ids = append(ids, v)
			}
		}
		if len(ids) == 0 {
			return fmt.Errorf("Gemini Omni audio_ids 必须是 audio_ 开头的已上传音频 ID")
		}
		input[field] = ids
		return nil
	}
	if field == "video_list" {
		list := make([]map[string]any, 0, len(values))
		for _, v := range values {
			list = append(list, map[string]any{"url": v, "start": 0, "ends": 10})
		}
		input[field] = list
		return nil
	}
	if isKIEFrameReferenceKey(key) {
		field = kieFrameReferenceField(model, c, key)
		if field == "" {
			return nil
		}
	} else if direct := kieDirectReferenceField(key); direct != "" && kieReferenceFieldMatchesKind(direct, field) && !preferKIEConfiguredImageField(c, key, direct) {
		field = direct
	}
	if model == "happyhorse-1-1/image-to-video" && field == "image_urls" {
		input[field] = []string{values[0]}
		return nil
	}
	if strings.HasSuffix(field, "_urls") || field == "input_urls" || field == "image_urls" || field == "video_urls" || (field == "reference_image" && c.imageArray) || (field == "reference_video" && c.videoArray) || (field == "reference_audio" && c.audioArray) || field == "reference_audio_urls" {
		input[field] = mergeKIEVideoStrings(input[field], values)
		return nil
	}
	input[field] = values[0]
	if field == "image_url" && len(values) > 1 {
		input[kieTailFrameField(model)] = values[1]
	}
	if field == "first_frame_url" && len(values) > 1 {
		input["last_frame_url"] = values[1]
	}
	return nil
}

func kieValuesLookLikeVideo(values []string) bool {
	for _, value := range values {
		lowered := strings.ToLower(strings.TrimSpace(strings.SplitN(value, "?", 2)[0]))
		if strings.HasPrefix(lowered, "data:video/") || strings.HasSuffix(lowered, ".mp4") || strings.HasSuffix(lowered, ".mov") || strings.HasSuffix(lowered, ".webm") {
			return true
		}
	}
	return false
}

func kieValuesLookLikeAudio(values []string) bool {
	for _, value := range values {
		lowered := strings.ToLower(strings.TrimSpace(strings.SplitN(value, "?", 2)[0]))
		if strings.HasPrefix(lowered, "data:audio/") || strings.HasSuffix(lowered, ".mp3") || strings.HasSuffix(lowered, ".wav") || strings.HasSuffix(lowered, ".m4a") {
			return true
		}
	}
	return false
}

func preferKIEConfiguredImageField(c kieVideoContract, key, direct string) bool {
	if c.image == "" || c.image == direct {
		return false
	}
	switch key {
	case "image", "images", "image_url", "image_urls", "input_url", "input_reference", "input_reference[]", "reference_image", "reference_image_url":
		return true
	default:
		return false
	}
}

func isKIEFrameReferenceKey(key string) bool {
	switch key {
	case "first_frame_url", "last_frame_url", "end_image_url", "tail_image_url":
		return true
	default:
		return false
	}
}

func kieFrameReferenceField(model string, c kieVideoContract, key string) string {
	m := strings.ToLower(strings.TrimSpace(model))
	last := key == "last_frame_url" || key == "end_image_url" || key == "tail_image_url"
	if isKIENamedFrameModel(m) || c.image == "first_frame_url" {
		if last {
			return "last_frame_url"
		}
		return "first_frame_url"
	}
	if isKIETailFrameModel(m) && c.image == "image_url" {
		if last {
			return kieTailFrameField(m)
		}
		return "image_url"
	}
	return ""
}

func isKIENamedFrameModel(model string) bool {
	switch strings.ToLower(strings.TrimSpace(model)) {
	case "bytedance/seedance-2", "bytedance/seedance-2-fast", "bytedance/seedance-2-mini", "bytedance/seedance-2-5", "wan/2-7-image-to-video":
		return true
	default:
		return false
	}
}

func isKIETailFrameModel(model string) bool {
	switch strings.ToLower(strings.TrimSpace(model)) {
	case "bytedance/v1-lite-image-to-video", "hailuo/02-image-to-video-standard", "hailuo/02-image-to-video-pro", "kling/v2-1-pro", "kling/v2-5-turbo-image-to-video-pro":
		return true
	default:
		return false
	}
}

func kieTailFrameField(model string) string {
	if strings.HasPrefix(strings.ToLower(strings.TrimSpace(model)), "kling/") {
		return "tail_image_url"
	}
	return "end_image_url"
}

func kieDirectReferenceField(key string) string {
	switch key {
	case "image_url", "image_urls", "input_urls", "image_input", "reference_image", "reference_image_urls",
		"video_url", "video_urls", "input_video_urls", "first_clip_url", "reference_video", "reference_video_urls",
		"audio_url", "audio_urls", "input_audio_urls", "driving_audio_url", "reference_voice", "reference_audio", "reference_audio_urls", "audio_ids":
		return key
	default:
		return ""
	}
}

func kieReferenceFieldMatchesKind(direct, configured string) bool {
	kind := func(field string) string {
		switch {
		case strings.Contains(field, "audio") || field == "driving_audio_url" || field == "reference_voice":
			return "audio"
		case strings.Contains(field, "video") || field == "first_clip_url":
			return "video"
		default:
			return "image"
		}
	}
	return kind(direct) == kind(configured)
}

func mergeKIEVideoStrings(existing any, values []string) []string {
	seen := map[string]bool{}
	merged := make([]string, 0, len(kieVideoStrings(existing))+len(values))
	for _, value := range append(kieVideoStrings(existing), values...) {
		value = strings.TrimSpace(value)
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		merged = append(merged, value)
	}
	return merged
}

func kieVideoStrings(value any) []string {
	switch v := value.(type) {
	case string:
		if strings.TrimSpace(v) != "" {
			return []string{strings.TrimSpace(v)}
		}
	case []string:
		return v
	case []any:
		out := make([]string, 0, len(v))
		for _, x := range v {
			if s := strings.TrimSpace(fmt.Sprint(x)); s != "" {
				out = append(out, s)
			}
		}
		return out
	}
	return nil
}

func firstKIEValue(input map[string]any, keys ...string) string {
	for _, key := range keys {
		if value := strings.TrimSpace(fmt.Sprint(input[key])); value != "" && value != "<nil>" {
			return value
		}
	}
	return ""
}
func normalizeKIEDurationNumber(value string) int {
	value = strings.TrimSuffix(strings.TrimSuffix(strings.TrimSpace(strings.ToLower(value)), "s"), "秒")
	n, _ := strconv.Atoi(value)
	return n
}
func normalizeKIEVideoAspect(value, model string) string {
	value = strings.ReplaceAll(strings.TrimSpace(strings.ToLower(value)), " ", "")
	if value == "adaptive" && strings.HasPrefix(model, "minimax-h3/") {
		return "auto"
	}
	switch value {
	case "landscape":
		return "16:9"
	case "portrait":
		return "9:16"
	case "square":
		return "1:1"
	case "1280x720", "1920x1080":
		return "16:9"
	case "720x1280", "1080x1920":
		return "9:16"
	default:
		return value
	}
}
func normalizeKIEVideoResolution(value, model string) string {
	value = strings.TrimSpace(strings.ToLower(value))
	switch {
	case strings.HasPrefix(model, "hailuo/"):
		if value == "480p" || value == "480" {
			return "512P"
		}
		if value == "720p" || value == "720" {
			return "768P"
		}
	case strings.HasPrefix(model, "minimax-h3/"):
		if value == "480p" || value == "720p" || value == "768p" {
			return "768P"
		}
		if value == "1080p" || value == "2k" {
			return "2K"
		}
	}
	if value == "480" || value == "720" || value == "1080" {
		return value + "p"
	}
	if strings.HasPrefix(model, "wan/2-7-text-to-video") && (value == "720p" || value == "1080p") {
		return strings.ToUpper(value)
	}
	return value
}
func applyKIEVideoAudio(input map[string]any, model string, value any) {
	enabled := strings.EqualFold(fmt.Sprint(value), "true") || fmt.Sprint(value) == "1"
	switch {
	case strings.HasPrefix(model, "kling-2.6/") || model == "kling-3.0/video":
		input["sound"] = enabled
	case strings.HasPrefix(model, "kling-3.0-omni/"):
		input["audio"] = enabled
	case strings.Contains(model, "seedance"):
		input["generate_audio"] = enabled
	case strings.Contains(model, "wan/2-6-"):
		input["audio"] = enabled
	}
}

func boolLike(value any) bool {
	switch v := value.(type) {
	case bool:
		return v
	case float64:
		return v != 0
	case int:
		return v != 0
	case string:
		switch strings.ToLower(strings.TrimSpace(v)) {
		case "1", "true", "yes", "on":
			return true
		}
	}
	return false
}

func normalizeKIEKlingV3VideoInput(input map[string]any, model string) {
	if strings.ToLower(strings.TrimSpace(model)) != "kling-3.0/video" {
		return
	}
	if value, ok := input["preset"]; ok && strings.TrimSpace(fmt.Sprint(value)) != "" {
		input["mode"] = normalizeKIEKlingV3Mode(value)
	}
	delete(input, "preset")
	delete(input, "negative_prompt")
	delete(input, "shot_type")
	if value, ok := input["mode"]; ok {
		input["mode"] = normalizeKIEKlingV3Mode(value)
	}
	if value, ok := input["multi_shot"]; ok {
		input["multi_shots"] = boolLike(value)
		delete(input, "multi_shot")
	}
	if value, ok := input["multi_shots"]; ok {
		input["multi_shots"] = boolLike(value)
	}
	if value, ok := input["multi_prompt"]; ok {
		if prompts := normalizeKIEKlingMultiPrompt(value, 12); len(prompts) > 0 {
			input["multi_prompt"] = prompts
		} else {
			delete(input, "multi_prompt")
		}
	}
	if value, ok := input["element_list"]; ok {
		if elements := normalizeKIEKlingElements(value); len(elements) > 0 {
			input["kling_elements"] = elements
		}
		delete(input, "element_list")
	}
	if value, ok := input["kling_elements"]; ok {
		if elements := normalizeKIEKlingElements(value); len(elements) > 0 {
			input["kling_elements"] = elements
		} else {
			delete(input, "kling_elements")
		}
	}
}

func normalizeKIEKlingOmniVideoInput(input map[string]any, model string) {
	prefix := "kling-3.0-omni/"
	m := strings.ToLower(strings.TrimSpace(model))
	if !strings.HasPrefix(m, prefix) {
		return
	}
	variant := strings.TrimPrefix(m, prefix)
	if variant != "text-to-video" && variant != "image-to-video" && variant != "reference-to-video" && variant != "transformation" {
		return
	}
	delete(input, "negative_prompt")
	if value, ok := input["mode"]; ok {
		input["resolution"] = normalizeKIEKlingOmniResolution(value)
		delete(input, "mode")
	}
	if value, ok := input["resolution"]; ok {
		input["resolution"] = normalizeKIEKlingOmniResolution(value)
	}
	if value, ok := input["element_list"]; ok {
		input["elements"] = normalizeKIEKlingElements(value)
		delete(input, "element_list")
	}
	if value, ok := input["kling_elements"]; ok {
		input["elements"] = normalizeKIEKlingElements(value)
		delete(input, "kling_elements")
	}
	multiShot, hasMultiShot := input["multi_shot"]
	if !hasMultiShot {
		multiShot, hasMultiShot = input["multi_shots"]
	}
	delete(input, "multi_shot")
	delete(input, "multi_shots")
	shotType := strings.ToLower(strings.TrimSpace(fmt.Sprint(input["shot_type"])))
	delete(input, "shot_type")
	switch variant {
	case "text-to-video", "image-to-video":
		custom := boolLike(input["customize_multi_shots"])
		smart := boolLike(input["prefer_multi_shots"])
		if hasMultiShot {
			custom = boolLike(multiShot) && shotType == "customize"
			smart = boolLike(multiShot) && !custom
		}
		if custom {
			smart = false
		}
		input["customize_multi_shots"] = custom
		input["prefer_multi_shots"] = smart
		if !custom {
			delete(input, "multi_prompt")
		}
	case "reference-to-video":
		custom := boolLike(input["customize_multi_shots"])
		if hasMultiShot {
			custom = boolLike(multiShot)
		}
		input["customize_multi_shots"] = custom
		delete(input, "prefer_multi_shots")
		if !custom {
			delete(input, "multi_prompt")
		}
	case "transformation":
		delete(input, "customize_multi_shots")
		delete(input, "prefer_multi_shots")
		delete(input, "multi_prompt")
		delete(input, "elements")
	}
	if value, ok := input["multi_prompt"]; ok {
		if prompts := normalizeKIEKlingMultiPrompt(value, 15); len(prompts) > 0 {
			if len(prompts) > 6 {
				prompts = prompts[:6]
			}
			input["multi_prompt"] = prompts
		} else {
			delete(input, "multi_prompt")
		}
	}
	images := kieVideoStrings(input["image_urls"])
	videos := kieVideoStrings(input["video_urls"])
	switch variant {
	case "text-to-video":
		for _, key := range kieVideoReferenceAliases {
			delete(input, key)
		}
	case "image-to-video":
		if len(images) > 1 {
			input["aspect_ratio"] = "auto"
		}
	case "reference-to-video":
		if len(videos) > 0 {
			input["aspect_ratio"] = "auto"
			input["audio"] = false
			if len(images) == 0 && !kieValuePresent(input["elements"]) {
				delete(input, "duration")
				input["customize_multi_shots"] = false
				delete(input, "multi_prompt")
			}
		}
	case "transformation":
		if len(videos) > 0 && len(images) == 0 {
			input["aspect_ratio"] = "auto"
			delete(input, "duration")
		}
	}
}

func kieValuePresent(value any) bool {
	if len(kieVideoStrings(value)) > 0 {
		return true
	}
	switch typed := value.(type) {
	case []any:
		return len(typed) > 0
	case []map[string]any:
		return len(typed) > 0
	case map[string]any:
		return len(typed) > 0
	default:
		return strings.TrimSpace(fmt.Sprint(value)) != "" && fmt.Sprint(value) != "<nil>"
	}
}

func normalizeKIEKlingOmniResolution(value any) string {
	switch strings.ToLower(strings.TrimSpace(fmt.Sprint(value))) {
	case "4k":
		return "4k"
	case "pro", "1080", "1080p":
		return "1080p"
	default:
		return "720p"
	}
}

func normalizeKIEKlingV3Mode(value any) string {
	switch strings.ToLower(strings.TrimSpace(fmt.Sprint(value))) {
	case "4k":
		return "4K"
	case "pro":
		return "pro"
	default:
		return "std"
	}
}

func normalizeKIEKlingMultiPrompt(value any, maxDuration int) []map[string]any {
	items, ok := value.([]any)
	if !ok {
		return nil
	}
	result := make([]map[string]any, 0, len(items))
	for _, item := range items {
		record, ok := item.(map[string]any)
		if !ok {
			continue
		}
		duration := normalizeKIEDurationNumber(fmt.Sprint(record["duration"]))
		if duration < 1 {
			duration = 1
		}
		if duration > maxDuration {
			duration = maxDuration
		}
		result = append(result, map[string]any{"prompt": strings.TrimSpace(fmt.Sprint(record["prompt"])), "duration": duration})
	}
	return result
}

func normalizeKIEKlingElements(value any) []map[string]any {
	var items []any
	switch typed := value.(type) {
	case []any:
		items = typed
	case []map[string]any:
		items = make([]any, len(typed))
		for index := range typed {
			items[index] = typed[index]
		}
	default:
		return nil
	}
	result := make([]map[string]any, 0, len(items))
	for _, item := range items {
		record, ok := item.(map[string]any)
		if !ok {
			continue
		}
		inputs := kieVideoStrings(record["element_input_urls"])
		audios := kieVideoStrings(record["element_input_audio_urls"])
		if refs, ok := record["references"].([]any); ok {
			for _, ref := range refs {
				r, ok := ref.(map[string]any)
				if !ok {
					continue
				}
				url := strings.TrimSpace(fmt.Sprint(r["url"]))
				if url == "" {
					continue
				}
				if strings.EqualFold(strings.TrimSpace(fmt.Sprint(r["kind"])), "audio") {
					audios = append(audios, url)
				} else {
					inputs = append(inputs, url)
				}
			}
		}
		if len(inputs) == 0 && len(audios) == 0 {
			continue
		}
		next := map[string]any{"name": strings.TrimSpace(fmt.Sprint(record["name"])), "description": strings.TrimSpace(fmt.Sprint(record["description"]))}
		if len(inputs) > 0 {
			next["element_input_urls"] = inputs
		}
		if len(audios) > 0 {
			next["element_input_audio_urls"] = audios
		}
		result = append(result, next)
	}
	return result
}

func applyKIEModelDefaults(input map[string]any, model string) {
	switch strings.ToLower(strings.TrimSpace(model)) {
	case "minimax-h3/text-to-video":
		if _, ok := input["aspect_ratio"]; !ok {
			input["aspect_ratio"] = "16:9"
		}
	case "kling-2.6/text-to-video", "kling-2.6/image-to-video":
		if _, ok := input["sound"]; !ok {
			input["sound"] = false
		}
	case "bytedance/seedance-2", "bytedance/seedance-2-fast":
		if _, ok := input["return_last_frame"]; !ok {
			input["return_last_frame"] = false
		}
	case "wan/2-6-flash-image-to-video", "wan/2-6-flash-video-to-video":
		if _, ok := input["audio"]; !ok {
			input["audio"] = false
		}
		if _, ok := input["multi_shots"]; !ok {
			input["multi_shots"] = false
		}
	}
}

func validateKIERequiredInputs(input map[string]any, model string) error {
	m := strings.ToLower(strings.TrimSpace(model))
	need := func(fields ...string) error {
		for _, field := range fields {
			value := input[field]
			if len(kieVideoStrings(value)) > 0 {
				return nil
			}
			switch value.(type) {
			case []any, []map[string]any, map[string]any:
				if fmt.Sprint(value) != "[]" && fmt.Sprint(value) != "map[]" {
					return nil
				}
			default:
				if strings.TrimSpace(fmt.Sprint(value)) != "" && fmt.Sprint(value) != "<nil>" {
					return nil
				}
			}
		}
		return fmt.Errorf("KIE required input missing: %s", strings.Join(fields, " or "))
	}
	switch m {
	case "kling-3.0-omni/text-to-video", "kling/v3-turbo-text-to-video", "bytedance/seedance-2-mini", "happyhorse-1-1/text-to-video":
		return need("prompt")
	case "kling-3.0-omni/image-to-video", "kling/v3-turbo-image-to-video", "happyhorse-1-1/image-to-video":
		return need("image_urls")
	case "kling-3.0-omni/reference-to-video":
		return need("image_urls", "video_urls", "elements")
	case "kling-3.0-omni/transformation":
		return need("video_urls")
	case "kling-2.6/motion-control", "kling-3.0/motion-control":
		if err := need("input_urls"); err != nil {
			return err
		}
		return need("video_urls")
	case "happyhorse/reference-to-video":
		return need("reference_image")
	case "wan/2-7-videoedit":
		return need("video_url")
	case "wan/2-7-r2v":
		return need("reference_image", "reference_video")
	case "topaz/video-upscale":
		return need("video_url")
	case "infinitalk/from-audio":
		if err := need("image_url"); err != nil {
			return err
		}
		return need("audio_url")
	case "kling/ai-avatar-standard", "kling/ai-avatar-pro":
		if err := need("image_url"); err != nil {
			return err
		}
		return need("audio_url")
	case "kling/v2-1-master-image-to-video", "kling/v2-1-pro", "kling/v2-1-standard", "kling/v2-5-turbo-image-to-video-pro":
		return need("image_url")
	case "wan/2-2-a14b-speech-to-video-turbo":
		if err := need("image_url"); err != nil {
			return err
		}
		return need("audio_url")
	}
	if strings.Contains(m, "image-to-video") || strings.Contains(m, "image_to_video") {
		return need("image_url", "image_urls", "input_urls", "first_frame_url", "image_input")
	}
	if strings.Contains(m, "video-to-video") || strings.Contains(m, "video_to_video") || strings.Contains(m, "videoedit") || strings.Contains(m, "video-edit") || strings.Contains(m, "motion-control") {
		return need("video_url", "video_urls", "input_video_urls", "first_clip_url", "reference_video", "reference_video_urls")
	}
	return nil
}
