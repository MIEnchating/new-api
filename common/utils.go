package common

import (
	crand "crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"log"
	"math/big"
	"math/rand"
	"net"
	"os"
	"runtime/debug"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
)

func GetIp() (ip string) {
	ips, err := net.InterfaceAddrs()
	if err != nil {
		log.Println(err)
		return ip
	}

	for _, a := range ips {
		if ipNet, ok := a.(*net.IPNet); ok && !ipNet.IP.IsLoopback() {
			if ipNet.IP.To4() != nil {
				ip = ipNet.IP.String()
				if strings.HasPrefix(ip, "10") {
					return
				}
				if strings.HasPrefix(ip, "172") {
					return
				}
				if strings.HasPrefix(ip, "192.168") {
					return
				}
				ip = ""
			}
		}
	}
	return
}

func GetNetworkIps() []string {
	var networkIps []string
	ips, err := net.InterfaceAddrs()
	if err != nil {
		log.Println(err)
		return networkIps
	}

	for _, a := range ips {
		if ipNet, ok := a.(*net.IPNet); ok && !ipNet.IP.IsLoopback() {
			if ipNet.IP.To4() != nil {
				ip := ipNet.IP.String()
				// Include common private network ranges
				if strings.HasPrefix(ip, "10.") ||
					strings.HasPrefix(ip, "172.") ||
					strings.HasPrefix(ip, "192.168.") {
					networkIps = append(networkIps, ip)
				}
			}
		}
	}
	return networkIps
}

// IsRunningInContainer detects if the application is running inside a container
func IsRunningInContainer() bool {
	// Method 1: Check for .dockerenv file (Docker containers)
	if _, err := os.Stat("/.dockerenv"); err == nil {
		return true
	}

	// Method 2: Check cgroup for container indicators
	if data, err := os.ReadFile("/proc/1/cgroup"); err == nil {
		content := string(data)
		if strings.Contains(content, "docker") ||
			strings.Contains(content, "containerd") ||
			strings.Contains(content, "kubepods") ||
			strings.Contains(content, "/lxc/") {
			return true
		}
	}

	// Method 3: Check environment variables commonly set by container runtimes
	containerEnvVars := []string{
		"KUBERNETES_SERVICE_HOST",
		"DOCKER_CONTAINER",
		"container",
	}

	for _, envVar := range containerEnvVars {
		if os.Getenv(envVar) != "" {
			return true
		}
	}

	// Method 4: Check if init process is not the traditional init
	if data, err := os.ReadFile("/proc/1/comm"); err == nil {
		comm := strings.TrimSpace(string(data))
		// In containers, process 1 is often not "init" or "systemd"
		if comm != "init" && comm != "systemd" {
			// Additional check: if it's a common container entrypoint
			if strings.Contains(comm, "docker") ||
				strings.Contains(comm, "containerd") ||
				strings.Contains(comm, "runc") {
				return true
			}
		}
	}

	return false
}

func Interface2String(inter interface{}) string {
	switch inter.(type) {
	case string:
		return inter.(string)
	case int:
		return fmt.Sprintf("%d", inter.(int))
	case float64:
		return strconv.FormatFloat(inter.(float64), 'f', -1, 64)
	case bool:
		if inter.(bool) {
			return "true"
		} else {
			return "false"
		}
	case nil:
		return ""
	}
	return fmt.Sprintf("%v", inter)
}

func GetUUID() string {
	code := uuid.New().String()
	code = strings.Replace(code, "-", "", -1)
	return code
}

const keyChars = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"

func GenerateRandomCharsKey(length int) (string, error) {
	b := make([]byte, length)
	maxI := big.NewInt(int64(len(keyChars)))

	for i := range b {
		n, err := crand.Int(crand.Reader, maxI)
		if err != nil {
			return "", err
		}
		b[i] = keyChars[n.Int64()]
	}

	return string(b), nil
}

func GenerateRandomKey(length int) (string, error) {
	bytes := make([]byte, length*3/4) // 对于48位的输出，这里应该是36
	if _, err := crand.Read(bytes); err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(bytes), nil
}

func GenerateKey() (string, error) {
	return GenerateRandomCharsKey(48)
}

func GetRandomInt(max int) int {
	return rand.Intn(max)
}

func GetTimestamp() int64 {
	return time.Now().Unix()
}

func GetTimeString() string {
	now := time.Now().UTC()
	return fmt.Sprintf("%s%09d", now.Format("20060102150405"), now.UnixNano()%1e9)
}

var requestIdPrefix = func() string {
	if bi, ok := debug.ReadBuildInfo(); ok && bi.Main.Path != "" {
		h := sha256.Sum256([]byte(bi.Main.Path))
		return hex.EncodeToString(h[:4])
	}
	return GetRandomString(8)
}()

func NewRequestId() string {
	return GetTimeString() + requestIdPrefix + GetRandomString(8)
}

func Max(a int, b int) int {
	if a >= b {
		return a
	} else {
		return b
	}
}

func MessageWithRequestId(message string, id string) string {
	return fmt.Sprintf("%s (request id: %s)", message, id)
}

func MessageWithoutRequestId(message string) string {
	cleaned := strings.TrimSpace(message)
	for {
		next := stripTrailingRequestId(cleaned)
		if next == cleaned {
			return cleaned
		}
		cleaned = next
	}
}

func stripTrailingRequestId(message string) string {
	if !strings.HasSuffix(message, ")") {
		return message
	}

	lowerMessage := strings.ToLower(message)
	markers := []string{
		" (request id:",
		" (request_id:",
		" (request-id:",
		" (requestid:",
	}
	for _, marker := range markers {
		index := strings.LastIndex(lowerMessage, marker)
		if index >= 0 {
			id := strings.TrimSpace(message[index+len(marker) : len(message)-1])
			if id != "" && !strings.ContainsAny(id, " \t\r\n") {
				return strings.TrimSpace(message[:index])
			}
		}
	}
	return message
}

func RandomSleep() {
	// Sleep for 0-3000 ms
	time.Sleep(time.Duration(rand.Intn(3000)) * time.Millisecond)
}

func GetPointer[T any](v T) *T {
	return &v
}
