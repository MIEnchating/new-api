package service

import (
	"bytes"
	"context"
	"errors"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

var invoiceRecognitionSlots = make(chan struct{}, 2)
var invoiceNumberLabel = regexp.MustCompile(`(?i)(?:发\s*票\s*号\s*码|發\s*票\s*號\s*碼|invoice\s*(?:number|no\.?))\s*[:：]?\s*([0-9][0-9 \t\r\n]{6,38}[0-9])`)

// Only a unique, explicitly labelled 8- or 20-digit number is accepted. Tax IDs,
// invoice codes and amounts must never be guessed as invoice numbers.
func invoiceNumberFromText(text string) (string, bool) {
	var number string
	found := false
	for _, match := range invoiceNumberLabel.FindAllStringSubmatch(text, -1) {
		candidate := strings.Join(strings.Fields(match[1]), "")
		if len(candidate) != 8 && len(candidate) != 20 {
			continue
		}
		if found && number != candidate {
			return "", true
		}
		number, found = candidate, true
	}
	return number, found
}

type invoiceRecognitionOutput struct{ bytes.Buffer }

func (output *invoiceRecognitionOutput) Write(data []byte) (int, error) {
	if output.Len()+len(data) > 128<<10 {
		return 0, errors.New("invoice recognition output exceeds limit")
	}
	return output.Buffer.Write(data)
}

func invoiceRecognitionCommand(ctx context.Context, name string, args ...string) ([]byte, error) {
	command := exec.CommandContext(ctx, name, args...)
	command.Env = append(os.Environ(), "OMP_THREAD_LIMIT=1")
	command.WaitDelay = time.Second
	var output invoiceRecognitionOutput
	command.Stdout, command.Stderr = &output, io.Discard
	err := command.Run()
	return output.Bytes(), err
}

// Recognition is local and best effort. Uploaded files remain available when
// tools are absent, the document is ambiguous, or the bounded job times out.
func RecognizeInvoiceNumber(ctx context.Context, reference string) string {
	select {
	case invoiceRecognitionSlots <- struct{}{}:
		defer func() { <-invoiceRecognitionSlots }()
	default:
		return ""
	}
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	file, err := ReadInvoiceFile(reference, 0)
	if err != nil {
		return ""
	}
	directory, err := os.MkdirTemp("", "invoice-recognition-")
	if err != nil {
		return ""
	}
	defer os.RemoveAll(directory)
	path := filepath.Join(directory, file.Filename)
	if err := os.WriteFile(path, file.Content, 0600); err != nil {
		return ""
	}
	if file.ContentType == "application/pdf" {
		text, err := invoiceRecognitionCommand(ctx, "pdftotext", "-f", "1", "-l", "1", "-layout", "-enc", "UTF-8", path, "-")
		if err == nil {
			if number, found := invoiceNumberFromText(string(text)); found {
				return number
			}
		}
		prefix := filepath.Join(directory, "page")
		if _, err := invoiceRecognitionCommand(ctx, "pdftoppm", "-f", "1", "-singlefile", "-scale-to", "2400", "-png", path, prefix); err != nil {
			return ""
		}
		path = prefix + ".png"
	} else {
		config, _, err := image.DecodeConfig(bytes.NewReader(file.Content))
		if err != nil || config.Width <= 0 || config.Height <= 0 || int64(config.Width)*int64(config.Height) > 40_000_000 {
			return ""
		}
	}
	text, err := invoiceRecognitionCommand(ctx, "tesseract", path, "stdout", "-l", "chi_sim+eng", "--psm", "6")
	if err != nil {
		return ""
	}
	number, _ := invoiceNumberFromText(string(text))
	return number
}
