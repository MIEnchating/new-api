package sora

import (
	"fmt"
	"strconv"
	"strings"
)

type apimartVideoContract struct {
	aspectField         string
	dropAspectWithImage bool
	hasResolution       bool
	resolutionCase      string
	maxResolution       string
	imageKind           string
	videoKind           string
	audioKind           string
	maxImageRefs        int
}

func apimartVideoModelContract(model string) apimartVideoContract {
	contract := apimartVideoContract{
		aspectField:    "aspect_ratio",
		hasResolution:  true,
		resolutionCase: "video",
		imageKind:      "array",
	}
	switch {
	case strings.Contains(model, "doubao-seedance-2"):
		contract.aspectField = "size"
		contract.imageKind = "seedance2"
		contract.videoKind = "array"
		contract.audioKind = "array"
	case strings.Contains(model, "doubao-seedance-1-0"), strings.Contains(model, "doubao-seedance-1-5"), strings.Contains(model, "seedance-1"):
		contract.imageKind = "roles"
	case strings.Contains(model, "sora-2-pro"):
		contract.dropAspectWithImage = true
		contract.maxImageRefs = 1
	case strings.Contains(model, "sora-2"):
		contract.dropAspectWithImage = true
		contract.maxImageRefs = 1
		contract.maxResolution = "720p"
	case strings.Contains(model, "veo") && strings.Contains(model, "official"):
		contract.imageKind = "first_last"
	case model == "minimax-h3":
		contract.imageKind = "minimax_h3"
		contract.videoKind = "array"
		contract.audioKind = "array"
	case strings.Contains(model, "minimax-hailuo-2-3"):
		contract.aspectField = ""
		contract.imageKind = "first_only"
	case strings.Contains(model, "minimax"), strings.Contains(model, "hailuo"):
		contract.aspectField = ""
		contract.imageKind = "first_last"
	case strings.Contains(model, "skyreels"):
		contract.imageKind = "skyreels"
		contract.videoKind = "skyreels"
		contract.audioKind = "skyreels"
	case model == "kling-3-0-turbo":
		contract.imageKind = "first_only"
		contract.dropAspectWithImage = true
	case model == "happyhorse-1-1":
		contract.aspectField = "size"
		contract.resolutionCase = "upper"
		contract.imageKind = "happyhorse11"
	case strings.Contains(model, "happyhorse"):
		contract.aspectField = "size"
		contract.resolutionCase = "upper"
		contract.imageKind = "happyhorse"
		contract.videoKind = "single"
	case strings.Contains(model, "gemini-omni-flash-preview"):
		contract.maxResolution = "720p"
		contract.videoKind = "array"
	case strings.Contains(model, "wan2-7-r2v"):
		contract.aspectField = "size"
		contract.resolutionCase = "upper"
		contract.imageKind = "roles"
		contract.videoKind = "array"
		contract.audioKind = "wan_r2v_voice"
	case strings.Contains(model, "wan2-7-videoedit"):
		contract.aspectField = "size"
		contract.resolutionCase = "upper"
		contract.videoKind = "array"
	case strings.Contains(model, "wan2-7"):
		contract.aspectField = "size"
		contract.resolutionCase = "upper"
		contract.imageKind = "roles"
		contract.videoKind = "array"
		contract.audioKind = "single"
	case strings.Contains(model, "wan2-6-i2v-flash"):
		contract.aspectField = ""
		contract.audioKind = "single"
	case strings.Contains(model, "wan2-5"):
		contract.aspectField = "size"
		contract.dropAspectWithImage = true
		contract.audioKind = "single"
	case strings.Contains(model, "wan2-6"):
		contract.dropAspectWithImage = true
		contract.audioKind = "single"
	case strings.Contains(model, "motion-control"):
		contract.aspectField = ""
		contract.hasResolution = false
		contract.imageKind = "single"
		contract.videoKind = "single"
	case strings.Contains(model, "kling-v2-6"), strings.Contains(model, "kling-2-6"), model == "kling-v3":
		contract.hasResolution = false
		contract.imageKind = "array_frames"
	case strings.Contains(model, "kling-v3-omni"), strings.Contains(model, "kling-video-o1"):
		contract.hasResolution = false
		contract.videoKind = "kling_video_list"
	case strings.Contains(model, "kling"):
		contract.hasResolution = false
	case strings.Contains(model, "vidu"):
		contract.dropAspectWithImage = model != "viduq3" && model != "viduq3-mix"
		contract.imageKind = "array_frames"
	case strings.Contains(model, "grok-imagine"):
		contract.aspectField = "size"
		contract.resolutionCase = "quality"
	case strings.Contains(model, "pixverse"):
		contract.aspectField = "size"
		contract.imageKind = "pixverse"
	case strings.Contains(model, "omni-flash"):
		contract.videoKind = "array"
	case model == "flux-3-video":
		contract.maxImageRefs = 10
		contract.videoKind = "single"
	}
	return contract
}

func normalizeAPIMartVideoContract(payload map[string]any, model string) error {
	name := normalizeAPIMartVideoModel(model)
	contract := apimartVideoModelContract(name)
	normalizeAPIMartVideoDuration(payload, name)
	normalizeAPIMartVideoAspect(payload, contract)
	normalizeAPIMartVideoMode(payload, name)
	normalizeAPIMartVideoResolution(payload, name, contract)
	normalizeAPIMartVideoReferences(payload, name, contract)
	normalizeAPIMartKlingAdvanced(payload, name)
	normalizeAPIMartVideoAudio(payload, name)
	applyAPIMartVideoDefaults(payload, name)
	clearAPIMartVideoConflicts(payload, name)
	if contract.dropAspectWithImage && hasAPIMartVideoImageInput(payload) {
		delete(payload, "size")
		delete(payload, "ratio")
		delete(payload, "aspect_ratio")
	}
	delete(payload, "preset")
	if err := validateProviderVideoReferenceURLs(payload); err != nil {
		return err
	}
	return validateAPIMartVideoInputs(payload, name)
}

func normalizeAPIMartVideoModel(model string) string {
	value := strings.ToLower(strings.TrimSpace(model))
	value = strings.NewReplacer("_", "-", ".", "-", "/", "-").Replace(value)
	return value
}

func normalizeAPIMartVideoDuration(payload map[string]any, model string) {
	if strings.Contains(model, "motion-control") {
		delete(payload, "duration")
		delete(payload, "seconds")
		return
	}
	value := firstAPIMartVideoValue(payload, "duration", "seconds")
	if value != "" {
		duration := apimartVideoInt(value)
		switch {
		case model == "minimax-h3":
			if duration < 4 {
				duration = 4
			}
			if duration > 15 {
				duration = 15
			}
		case strings.Contains(model, "doubao-seedance-2-5"):
			if duration != -1 && duration < 4 {
				duration = 4
			}
			if duration > 30 {
				duration = 30
			}
		case model == "flux-3-video":
			if duration < 5 {
				duration = 5
			}
			if duration > 20 {
				duration = 20
			}
		}
		payload["duration"] = duration
	}
	delete(payload, "seconds")
}

func normalizeAPIMartVideoAspect(payload map[string]any, contract apimartVideoContract) {
	field := contract.aspectField
	if field == "" {
		delete(payload, "size")
		delete(payload, "ratio")
		delete(payload, "aspect_ratio")
		return
	}
	value := firstAPIMartVideoValue(payload, field, "size", "aspect_ratio", "ratio")
	if value != "" {
		payload[field] = normalizeAPIMartVideoRatio(value)
	}
	for _, key := range []string{"size", "aspect_ratio", "ratio"} {
		if key != field {
			delete(payload, key)
		}
	}
}

func normalizeAPIMartVideoMode(payload map[string]any, model string) {
	if !strings.Contains(model, "kling") || strings.Contains(model, "motion-control") || model == "kling-v3" || strings.Contains(model, "kling-v2-6") || strings.Contains(model, "kling-2-6") {
		return
	}
	mode := strings.ToLower(strings.TrimSpace(firstAPIMartVideoValue(payload, "mode")))
	if mode == "" || mode == "normal" {
		resolution := strings.ToLower(firstAPIMartVideoValue(payload, "resolution", "resolution_name"))
		if resolution == "1080" || resolution == "1080p" || resolution == "4k" {
			mode = "pro"
		} else {
			mode = "std"
		}
	}
	payload["mode"] = mode
}

func normalizeAPIMartVideoResolution(payload map[string]any, model string, contract apimartVideoContract) {
	if !contract.hasResolution {
		delete(payload, "resolution")
		delete(payload, "resolution_name")
		delete(payload, "image_resolution")
		return
	}
	value := firstAPIMartVideoValue(payload, "resolution", "resolution_name", "image_resolution")
	delete(payload, "resolution_name")
	delete(payload, "image_resolution")
	if value == "" {
		return
	}
	value = strings.ToLower(strings.TrimSpace(value))
	if value == "480" || value == "720" || value == "768" || value == "1080" {
		value += "p"
	}
	switch {
	case model == "minimax-h3":
		if value == "480p" || value == "720p" || value == "768p" {
			payload["resolution"] = "768P"
		} else {
			payload["resolution"] = "2K"
		}
	case contract.maxResolution == "720p" && (value == "1080p" || value == "2k" || value == "4k"):
		payload["resolution"] = "720p"
	case contract.resolutionCase == "upper":
		payload["resolution"] = strings.ToUpper(value)
	case strings.Contains(model, "doubao-seedance-2-5") && (value == "1080p" || value == "2k" || value == "4k"):
		payload["resolution"] = "720p"
	case model == "flux-3-video" && (value == "360p" || value == "480p"):
		payload["resolution"] = "720p"
	case contract.resolutionCase == "quality":
		payload["quality"] = value
		delete(payload, "resolution")
	default:
		payload["resolution"] = value
	}
}

func normalizeAPIMartVideoReferences(payload map[string]any, model string, contract apimartVideoContract) {
	first := firstAPIMartVideoValue(payload, "first_frame_image", "first_frame_url", "image")
	last := firstAPIMartVideoValue(payload, "last_frame_image", "last_frame_url", "image_tail")
	explicitFirst := firstAPIMartVideoValue(payload, "first_frame_image", "first_frame_url") != ""
	explicitLast := firstAPIMartVideoValue(payload, "last_frame_image", "last_frame_url", "image_tail") != ""
	images := firstAPIMartVideoStrings(payload, "image_urls", "images", "reference_image_urls", "reference_image", "input_urls", "input_reference", "input_reference[]")
	if first == "" && len(images) > 0 {
		first = images[0]
	}
	if last == "" && len(images) > 1 {
		last = images[1]
	}
	videos := firstAPIMartVideoStrings(payload, "video_urls", "reference_video_urls", "reference_video", "video_url", "video_reference", "video_reference[]")
	audios := firstAPIMartVideoStrings(payload, "audio_urls", "reference_audio_urls", "reference_voice", "audio_url", "audio_reference", "audio_reference[]")

	for _, key := range []string{"first_frame_url", "last_frame_url", "image", "image_tail", "images", "input_urls", "input_reference", "input_reference[]", "reference_image_urls", "reference_image", "reference_video_urls", "reference_video", "video_reference", "video_reference[]", "reference_audio_urls", "reference_voice", "audio_reference", "audio_reference[]"} {
		delete(payload, key)
	}
	if contract.maxImageRefs > 0 && len(images) > contract.maxImageRefs {
		images = images[:contract.maxImageRefs]
		first = images[0]
		last = ""
		if len(images) > 1 {
			last = images[1]
		}
	}

	switch contract.imageKind {
	case "seedance2":
		if !apimartVideoValueEmpty(payload["image_with_roles"]) {
			// Provider metadata may already distinguish first/last/reference
			// roles. Preserve that richer contract instead of rebuilding it
			// from the compatibility image array.
		} else if explicitFirst || explicitLast {
			roles := []map[string]string{}
			if explicitFirst && first != "" {
				roles = append(roles, map[string]string{"url": first, "role": "first_frame"})
			}
			if explicitLast && last != "" {
				roles = append(roles, map[string]string{"url": last, "role": "last_frame"})
			}
			if len(roles) > 0 {
				payload["image_with_roles"] = roles
			}
		} else if len(images) > 0 {
			payload["image_urls"] = images
		}
	case "roles":
		if apimartVideoValueEmpty(payload["image_with_roles"]) && len(images) > 0 {
			payload["image_with_roles"] = buildAPIMartVideoImageRoles(images)
		}
	case "minimax_h3":
		if explicitFirst && first != "" {
			payload["first_frame_image"] = first
		}
		if explicitLast && last != "" {
			payload["last_frame_image"] = last
		}
		if !explicitFirst && !explicitLast && len(images) > 0 {
			payload["image_urls"] = images
		}
	case "first_last":
		if first != "" {
			payload["first_frame_image"] = first
		}
		if last != "" {
			payload["last_frame_image"] = last
		}
	case "first_only":
		if first != "" {
			payload["first_frame_image"] = first
		}
		delete(payload, "last_frame_image")
	case "array_frames":
		frames := []string{}
		if first != "" {
			frames = append(frames, first)
		}
		if last != "" {
			frames = append(frames, last)
		}
		if len(frames) > 0 {
			payload["image_urls"] = frames
		}
	case "single":
		if first != "" {
			payload["image_url"] = first
		}
	case "happyhorse11":
		if explicitFirst && first != "" {
			payload["first_frame_image"] = first
		} else if len(images) > 0 {
			payload["image_urls"] = images
		}
	case "happyhorse":
		if len(images) > 1 {
			payload["image_urls"] = images
		} else if first != "" {
			payload["first_frame_image"] = first
		}
	case "pixverse":
		if explicitFirst || explicitLast {
			payload["first_frame_image"] = first
			if explicitLast && last != "" {
				payload["last_frame_image"] = last
			}
		} else if len(images) > 1 {
			payload["img_references"] = images
		} else if len(images) > 0 {
			payload["image_urls"] = images
		}
	case "skyreels":
		if explicitFirst || explicitLast {
			if first != "" {
				payload["first_frame_image"] = first
			}
			if explicitLast && last != "" {
				payload["end_frame_image"] = last
			}
		} else if len(images) > 0 {
			payload["ref_images"] = []map[string]any{{"tag": "@image1", "type": "image", "image_urls": images}}
		}
	default:
		if len(images) > 0 {
			payload["image_urls"] = images
		}
	}

	if len(videos) > 0 {
		switch contract.videoKind {
		case "single":
			payload["video_url"] = videos[0]
		case "skyreels":
			items := make([]map[string]string, 0, len(videos))
			for index, value := range videos {
				items = append(items, map[string]string{"tag": fmt.Sprintf("@video%d", index+1), "type": "reference", "video_url": value})
			}
			payload["ref_videos"] = items
		case "kling_video_list":
			items := make([]map[string]string, 0, len(videos))
			for _, value := range videos {
				items = append(items, map[string]string{"video_url": value, "refer_type": "base", "keep_original_sound": "no"})
			}
			payload["video_list"] = items
		case "array":
			payload["video_urls"] = videos
		}
	}
	if len(audios) > 0 {
		switch contract.audioKind {
		case "array":
			payload["audio_urls"] = audios
		case "single":
			payload["audio_url"] = audios[0]
		case "skyreels":
			if refs := apimartVideoMapSlice(payload["ref_images"]); len(refs) > 0 {
				refs[0]["audio_url"] = audios[0]
				payload["ref_images"] = refs
			}
		case "wan_r2v_voice":
			if roles := apimartVideoMapSlice(payload["image_with_roles"]); len(roles) > 0 {
				roles[0]["reference_voice"] = audios[0]
				payload["image_with_roles"] = roles
			}
		}
	}
	clearUnusedAPIMartVideoReferences(payload, contract)
}

func normalizeAPIMartVideoAudio(payload map[string]any, model string) {
	value, ok := payload["video_generate_audio"]
	if !ok {
		value, ok = payload["generate_audio"]
	}
	if !ok {
		value, ok = payload["sound"]
	}
	if !ok && strings.Contains(model, "kling") {
		value, ok = payload["audio"]
	}
	delete(payload, "video_generate_audio")
	delete(payload, "sound")
	if !ok {
		return
	}
	enabled := boolLike(value) || strings.EqualFold(strings.TrimSpace(fmt.Sprint(value)), "native")
	usesGenerateAudio := strings.Contains(model, "doubao-seedance-2") || strings.Contains(model, "veo") && strings.Contains(model, "official")
	if !usesGenerateAudio {
		delete(payload, "generate_audio")
	}
	switch {
	case usesGenerateAudio:
		payload["generate_audio"] = enabled
	case strings.Contains(model, "doubao-seedance-1-5"), strings.Contains(model, "seedance-1-5"):
		payload["audio"] = enabled
	case model == "wan2-6", model == "wan2-6-i2v-flash":
		payload["audio"] = enabled
	case strings.Contains(model, "kling-v3-omni"):
		if apimartVideoValueEmpty(payload["video_list"]) {
			payload["audio"] = enabled
		} else {
			delete(payload, "audio")
		}
	case strings.Contains(model, "kling-v3") && !strings.Contains(model, "omni"):
		payload["audio"] = enabled
	case strings.Contains(model, "pixverse-v6"), strings.Contains(model, "viduq3-pro"), strings.Contains(model, "vidu-q3-pro"), strings.Contains(model, "viduq3-turbo"):
		payload["audio"] = enabled
	case (strings.Contains(model, "kling-v2-6") || strings.Contains(model, "kling-2-6")) && !strings.Contains(model, "motion"):
		if enabled && !hasAPIMartVideoLastFrame(payload) {
			payload["audio"] = true
			if apimartVideoValueEmpty(payload["mode"]) {
				payload["mode"] = "pro"
			}
		} else {
			payload["audio"] = false
		}
	}
}

func applyAPIMartVideoDefaults(payload map[string]any, model string) {
	if strings.Contains(model, "wan2-5") && apimartVideoValueEmpty(payload["audio"]) {
		payload["audio"] = true
	}
	if strings.Contains(model, "kling-v2-6-motion-control") {
		if apimartVideoValueEmpty(payload["character_orientation"]) {
			payload["character_orientation"] = "video"
		}
		if apimartVideoValueEmpty(payload["mode"]) {
			payload["mode"] = "std"
		}
		delete(payload, "keep_original_sound")
		delete(payload, "watermark_info")
		return
	}
	if strings.Contains(model, "motion-control") {
		if apimartVideoValueEmpty(payload["character_orientation"]) {
			payload["character_orientation"] = "image"
		}
		if apimartVideoValueEmpty(payload["mode"]) {
			payload["mode"] = "std"
		}
		if apimartVideoValueEmpty(payload["keep_original_sound"]) {
			payload["keep_original_sound"] = "yes"
		}
	}
}

func clearAPIMartVideoConflicts(payload map[string]any, model string) {
	if model == "happyhorse-1-1" && !apimartVideoValueEmpty(payload["first_frame_image"]) {
		delete(payload, "image_urls")
	}
	if strings.Contains(model, "doubao-seedance-2") && !apimartVideoValueEmpty(payload["image_with_roles"]) {
		delete(payload, "image_urls")
		if hasAPIMartVideoFrameRole(payload) {
			delete(payload, "video_urls")
			delete(payload, "audio_urls")
		}
	}
	if strings.Contains(model, "wan2-7") && !strings.Contains(model, "r2v") && !strings.Contains(model, "videoedit") && !apimartVideoValueEmpty(payload["video_urls"]) {
		delete(payload, "audio_url")
	}
	if strings.Contains(model, "omni-flash-ext") && !apimartVideoValueEmpty(payload["video_urls"]) {
		delete(payload, "duration")
	}
}

func normalizeAPIMartKlingAdvanced(payload map[string]any, model string) {
	if model != "kling-v3" {
		return
	}
	elements := make([]map[string]any, 0, 3)
	for _, item := range apimartVideoMapSlice(payload["element_list"]) {
		urls := kieVideoStrings(item["element_input_urls"])
		if len(urls) == 0 {
			for _, reference := range apimartVideoMapSlice(item["references"]) {
				kind := strings.ToLower(strings.TrimSpace(fmt.Sprint(reference["kind"])))
				url := strings.TrimSpace(fmt.Sprint(reference["url"]))
				if url != "" && (kind == "" || kind == "image") {
					urls = append(urls, url)
				}
			}
		}
		if len(urls) == 0 {
			continue
		}
		if len(urls) > 4 {
			urls = urls[:4]
		}
		elements = append(elements, map[string]any{
			"name":               strings.TrimSpace(fmt.Sprint(item["name"])),
			"description":        strings.TrimSpace(fmt.Sprint(item["description"])),
			"element_input_urls": urls,
		})
		if len(elements) == 3 {
			break
		}
	}
	if len(elements) > 0 {
		payload["element_list"] = elements
	} else {
		delete(payload, "element_list")
	}

	if !boolLike(payload["multi_shot"]) {
		delete(payload, "multi_shot")
		delete(payload, "shot_type")
		delete(payload, "multi_prompt")
		return
	}
	payload["multi_shot"] = true
	shotType := strings.ToLower(strings.TrimSpace(fmt.Sprint(payload["shot_type"])))
	if shotType != "customize" {
		payload["shot_type"] = "intelligence"
		delete(payload, "multi_prompt")
		return
	}
	payload["shot_type"] = "customize"
	prompts := make([]map[string]any, 0)
	for index, item := range apimartVideoMapSlice(payload["multi_prompt"]) {
		duration := apimartVideoInt(fmt.Sprint(item["duration"]))
		if duration < 1 {
			duration = 1
		}
		if duration > 15 {
			duration = 15
		}
		prompts = append(prompts, map[string]any{"index": index + 1, "prompt": fmt.Sprint(item["prompt"]), "duration": duration})
	}
	if len(prompts) == 0 {
		prompts = []map[string]any{{"index": 1, "prompt": "", "duration": 1}}
	}
	payload["multi_prompt"] = prompts
}

func validateAPIMartVideoInputs(payload map[string]any, model string) error {
	need := func(fields ...string) error {
		for _, field := range fields {
			if !apimartVideoValueEmpty(payload[field]) {
				return nil
			}
		}
		return fmt.Errorf("APIMart required input missing: %s", strings.Join(fields, " or "))
	}
	switch {
	case model == "kling-3-0-turbo":
		return need("prompt", "first_frame_image")
	case model == "happyhorse-1-1":
		if len(kieVideoStrings(payload["image_urls"])) > 9 {
			return fmt.Errorf("图片数量最多9张")
		}
		return need("prompt", "first_frame_image", "image_urls")
	case strings.Contains(model, "motion-control"):
		if err := need("image_url"); err != nil {
			return err
		}
		return need("video_url")
	case strings.Contains(model, "minimax-hailuo-2-3-fast"):
		return need("first_frame_image")
	case strings.Contains(model, "wan2-7-videoedit"):
		return need("video_urls")
	case strings.Contains(model, "wan2-7-r2v"):
		return need("image_with_roles", "video_urls")
	case strings.Contains(model, "wan2-6-i2v-flash"):
		return need("image_urls")
	case model == "viduq3" || model == "viduq3-mix":
		return need("image_urls")
	}
	return nil
}

func buildAPIMartVideoImageRoles(values []string) []map[string]string {
	roles := make([]map[string]string, 0, len(values))
	for index, value := range values {
		role := "reference_image"
		if index == 0 {
			role = "first_frame"
		} else if index == 1 {
			role = "last_frame"
		}
		roles = append(roles, map[string]string{"url": value, "role": role})
	}
	return roles
}

func hasAPIMartVideoImageInput(payload map[string]any) bool {
	for _, key := range []string{"image_urls", "image_with_roles", "first_frame_image", "last_frame_image", "end_frame_image", "img_references", "ref_images"} {
		if !apimartVideoValueEmpty(payload[key]) {
			return true
		}
	}
	return false
}

func hasAPIMartVideoLastFrame(payload map[string]any) bool {
	if !apimartVideoValueEmpty(payload["last_frame_image"]) || !apimartVideoValueEmpty(payload["end_frame_image"]) {
		return true
	}
	for _, item := range apimartVideoMapSlice(payload["image_with_roles"]) {
		if strings.TrimSpace(fmt.Sprint(item["role"])) == "last_frame" {
			return true
		}
	}
	return false
}

func hasAPIMartVideoFrameRole(payload map[string]any) bool {
	for _, item := range apimartVideoMapSlice(payload["image_with_roles"]) {
		role := strings.TrimSpace(fmt.Sprint(item["role"]))
		if role == "first_frame" || role == "last_frame" {
			return true
		}
	}
	return false
}

func clearUnusedAPIMartVideoReferences(payload map[string]any, contract apimartVideoContract) {
	keep := map[string]bool{}
	switch contract.imageKind {
	case "seedance2":
		keep["image_urls"], keep["image_with_roles"] = true, true
	case "roles":
		keep["image_with_roles"] = true
	case "minimax_h3":
		keep["image_urls"], keep["first_frame_image"], keep["last_frame_image"] = true, true, true
	case "first_last":
		keep["image_urls"], keep["first_frame_image"], keep["last_frame_image"] = true, true, true
	case "first_only":
		keep["first_frame_image"] = true
	case "array", "array_frames":
		keep["image_urls"] = true
	case "single":
		keep["image_url"] = true
	case "happyhorse11", "happyhorse":
		keep["first_frame_image"], keep["image_urls"] = true, true
	case "pixverse":
		keep["first_frame_image"], keep["last_frame_image"], keep["image_urls"], keep["img_references"] = true, true, true, true
	case "skyreels":
		keep["first_frame_image"], keep["end_frame_image"], keep["ref_images"] = true, true, true
	}
	switch contract.videoKind {
	case "single":
		keep["video_url"] = true
	case "array":
		keep["video_urls"] = true
	case "skyreels":
		keep["ref_videos"] = true
	case "kling_video_list":
		keep["video_list"] = true
	}
	switch contract.audioKind {
	case "single":
		keep["audio_url"] = true
	case "array":
		keep["audio_urls"] = true
	case "skyreels":
		keep["ref_images"] = true
	case "wan_r2v_voice":
		keep["image_with_roles"] = true
	}
	for _, key := range []string{"image", "images", "image_url", "image_urls", "input_urls", "input_reference", "input_reference[]", "reference_image", "reference_image_urls", "first_frame_url", "first_frame_image", "last_frame_url", "last_frame_image", "end_frame_image", "img_references", "ref_images", "image_with_roles", "video", "videos", "video_url", "video_urls", "video_reference", "video_reference[]", "reference_video", "reference_video_urls", "ref_videos", "video_list", "audios", "audio_url", "audio_urls", "audio_reference", "audio_reference[]", "reference_audio", "reference_audio_urls"} {
		if !keep[key] {
			delete(payload, key)
		}
	}
}

func firstAPIMartVideoValue(payload map[string]any, keys ...string) string {
	for _, key := range keys {
		value := strings.TrimSpace(fmt.Sprint(payload[key]))
		if value != "" && value != "<nil>" && !strings.HasPrefix(value, "[") && !strings.HasPrefix(value, "map[") {
			return value
		}
	}
	return ""
}

func firstAPIMartVideoStrings(payload map[string]any, keys ...string) []string {
	for _, key := range keys {
		if values := kieVideoStrings(payload[key]); len(values) > 0 {
			return values
		}
	}
	return nil
}

func apimartVideoInt(value string) int {
	value = strings.TrimSuffix(strings.TrimSuffix(strings.TrimSpace(strings.ToLower(value)), "s"), "秒")
	parsed, _ := strconv.Atoi(value)
	return parsed
}

func normalizeAPIMartVideoRatio(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	switch value {
	case "landscape", "1280x720", "1920x1080", "1280*720", "1920*1080":
		return "16:9"
	case "portrait", "720x1280", "1080x1920", "720*1280", "1080*1920":
		return "9:16"
	case "square", "1024x1024", "1024*1024":
		return "1:1"
	default:
		return value
	}
}

func apimartVideoValueEmpty(value any) bool {
	if value == nil {
		return true
	}
	switch typed := value.(type) {
	case string:
		return strings.TrimSpace(typed) == ""
	case []string:
		return len(typed) == 0
	case []any:
		return len(typed) == 0
	case []map[string]string:
		return len(typed) == 0
	case []map[string]any:
		return len(typed) == 0
	default:
		return false
	}
}

func apimartVideoMapSlice(value any) []map[string]any {
	switch typed := value.(type) {
	case []map[string]any:
		return typed
	case []any:
		items := make([]map[string]any, 0, len(typed))
		for _, item := range typed {
			if record, ok := item.(map[string]any); ok {
				items = append(items, record)
			}
		}
		return items
	default:
		return nil
	}
}
