package sora

import (
	"fmt"
	"net/netip"
	"net/url"
	"strings"
)

func validateProviderVideoReferenceURLs(input map[string]any) error {
	fields := []string{
		"image", "images", "image_url", "image_urls", "input_url", "input_urls", "image_input",
		"reference_image", "reference_images", "reference_image_url", "reference_image_urls",
		"first_frame_url", "last_frame_url", "end_image_url", "tail_image_url", "first_frame_image", "last_frame_image", "end_frame_image",
		"video", "videos", "video_url", "video_urls", "input_video_url", "input_video_urls", "first_clip_url",
		"reference_video", "reference_videos", "reference_video_url", "reference_video_urls", "video_list", "ref_videos",
		"audio", "audios", "audio_url", "audio_urls", "input_audio_url", "input_audio_urls", "driving_audio_url",
		"reference_audio", "reference_audios", "reference_audio_url", "reference_audio_urls", "reference_voice",
		"image_with_roles", "ref_images", "img_references", "element_input_urls", "kling_elements", "elements", "element_list",
	}
	for _, field := range fields {
		for _, value := range providerVideoReferenceStrings(input[field], field) {
			if err := validateProviderVideoReferenceURL(value); err != nil {
				return fmt.Errorf("%s: %w", field, err)
			}
		}
	}
	return nil
}

func providerVideoReferenceStrings(value any, field string) []string {
	result := make([]string, 0)
	var collect func(any, string)
	collect = func(current any, key string) {
		switch typed := current.(type) {
		case string:
			trimmed := strings.TrimSpace(typed)
			if trimmed != "" && providerVideoReferenceKey(key) {
				result = append(result, trimmed)
			}
		case []string:
			for _, item := range typed {
				collect(item, key)
			}
		case []any:
			for _, item := range typed {
				collect(item, key)
			}
		case []map[string]any:
			for _, item := range typed {
				collect(item, key)
			}
		case []map[string]string:
			for _, item := range typed {
				collect(item, key)
			}
		case map[string]any:
			for nestedKey, item := range typed {
				collect(item, nestedKey)
			}
		case map[string]string:
			for nestedKey, item := range typed {
				collect(item, nestedKey)
			}
		}
	}
	collect(value, field)
	return result
}

func providerVideoReferenceKey(key string) bool {
	key = strings.ToLower(strings.TrimSpace(key))
	return key == "url" || strings.Contains(key, "_url") || strings.Contains(key, "_urls") || strings.Contains(key, "image") || strings.Contains(key, "video") || strings.Contains(key, "audio") || strings.Contains(key, "reference") || key == "images" || key == "videos" || key == "audios"
}

func validateProviderVideoReferenceURL(value string) error {
	parsed, err := url.Parse(strings.TrimSpace(value))
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Hostname() == "" || parsed.User != nil {
		return fmt.Errorf("视频参考素材必须使用公网可访问的 http:// 或 https:// URL")
	}
	host := strings.ToLower(strings.TrimSuffix(parsed.Hostname(), "."))
	if host == "localhost" || strings.HasSuffix(host, ".localhost") || strings.HasSuffix(host, ".local") {
		return fmt.Errorf("视频参考素材不能使用本机或局域网地址")
	}
	if address, parseErr := netip.ParseAddr(host); parseErr == nil {
		if address.IsPrivate() || address.IsLoopback() || address.IsLinkLocalUnicast() || address.IsLinkLocalMulticast() || address.IsUnspecified() {
			return fmt.Errorf("视频参考素材不能使用本机或私网地址")
		}
	}
	return nil
}
