package qqbot

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
)

const (
	groupAtMessageCreate = "GROUP_AT_MESSAGE_CREATE"
	groupAddRobot        = "GROUP_ADD_ROBOT"
	privateMessageCreate = "C2C_MESSAGE_CREATE"
)

var challengeToken = regexp.MustCompile(`^[A-Za-z0-9_=-]{1,128}$`)

type groupMessage struct {
	ID      string `json:"id"`
	GroupID string `json:"group_openid"`
	Content string `json:"content"`
	Private bool   `json:"-"`
	Author  struct {
		OpenID     string `json:"member_openid"`
		UserOpenID string `json:"user_openid"`
		Bot        bool   `json:"bot"`
	} `json:"author"`
}

func (b *Bot) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("X-Bot-Appid") != b.appID {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 64<<10))
	if err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			w.WriteHeader(http.StatusRequestEntityTooLarge)
		} else {
			w.WriteHeader(http.StatusBadRequest)
		}
		return
	}
	var payload struct {
		Op   *int              `json:"op"`
		Type string            `json:"t"`
		Data common.RawMessage `json:"d"`
	}
	if err = common.DecodeJsonBody(bytes.NewReader(raw), &payload); err != nil || payload.Op == nil {
		w.WriteHeader(http.StatusBadRequest)
		return
	}

	now := b.now()
	if *payload.Op == 13 {
		var challenge struct {
			Token     string `json:"plain_token"`
			Timestamp string `json:"event_ts"`
		}
		// QQ uses the same signing key for challenges and events. Restrict
		// unsigned challenges to opaque tokens so they cannot sign event JSON.
		if common.Unmarshal(payload.Data, &challenge) != nil ||
			!challengeToken.MatchString(challenge.Token) || !freshTimestamp(challenge.Timestamp, now) {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		sig := ed25519.Sign(b.signingKey, []byte(challenge.Timestamp+challenge.Token))
		data, _ := common.Marshal(map[string]string{"plain_token": challenge.Token, "signature": hex.EncodeToString(sig)})
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		_, _ = w.Write(data)
		return
	}

	timestamp := r.Header.Get("X-Signature-Timestamp")
	signature := r.Header.Get("X-Signature-Ed25519")
	if len(signature) != ed25519.SignatureSize*2 || !freshTimestamp(timestamp, now) {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	sig, err := hex.DecodeString(signature)
	if err != nil || !ed25519.Verify(b.signingKey.Public().(ed25519.PublicKey), append([]byte(timestamp), raw...), sig) {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}

	if *payload.Op == 0 && payload.Type == privateMessageCreate {
		var event groupMessage
		if common.Unmarshal(payload.Data, &event) != nil || event.ID == "" || len(event.ID) > 512 ||
			!groupOpenID.MatchString(event.Author.UserOpenID) {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		if !event.Author.Bot {
			event.Private = true
			event.GroupID = ""
			ctx, cancel := context.WithTimeout(r.Context(), time.Second)
			defer cancel()
			if err = b.accept(ctx, event); err != nil {
				w.WriteHeader(http.StatusServiceUnavailable)
				return
			}
		}
	}
	if *payload.Op == 0 && (payload.Type == groupAtMessageCreate || payload.Type == groupAddRobot) {
		var event groupMessage
		if common.Unmarshal(payload.Data, &event) != nil || !groupOpenID.MatchString(event.GroupID) {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		if !event.Author.Bot {
			if payload.Type == groupAtMessageCreate &&
				(event.ID == "" || len(event.ID) > 512 || !groupOpenID.MatchString(event.Author.OpenID)) {
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			ctx, cancel := context.WithTimeout(r.Context(), time.Second)
			defer cancel()
			_, allowed := b.groups[event.GroupID]
			switch {
			case !allowed:
				if err := b.discoverGroup(ctx, event.GroupID, now); err != nil {
					w.WriteHeader(http.StatusServiceUnavailable)
					return
				}
				if payload.Type == groupAddRobot || len(b.groups) == 0 {
					first, err := b.claim(ctx, "group:"+event.GroupID, time.Hour)
					if err != nil {
						w.WriteHeader(http.StatusServiceUnavailable)
						return
					}
					if first {
						logger.LogInfo(ctx, common.LogText("QQ bot discovered group OpenID %s", event.GroupID))
					}
				}
			case payload.Type == groupAtMessageCreate:
				if err = b.accept(ctx, event); err != nil {
					w.WriteHeader(http.StatusServiceUnavailable)
					return
				}
			}
		}
	}
	w.Header().Set("Content-Type", "application/json")
	_, _ = io.WriteString(w, `{"op":12}`)
}

func freshTimestamp(value string, now time.Time) bool {
	seconds, err := strconv.ParseInt(value, 10, 64)
	if err != nil || strconv.FormatInt(seconds, 10) != value {
		return false
	}
	signedAt := time.Unix(seconds, 0)
	return !signedAt.Before(now.Add(-5*time.Minute)) && !signedAt.After(now.Add(time.Minute))
}

func (b *Bot) accept(ctx context.Context, event groupMessage) error {
	select {
	case b.slots <- struct{}{}:
	default:
		return errors.New("QQ bot is busy")
	}
	// Use the message ID, since QQ can deliver the same message with a
	// different callback event ID.
	messageScope := event.GroupID
	if event.Private {
		messageScope = "user:" + event.Author.UserOpenID
	}
	first, err := b.claim(ctx, "message:"+messageScope+":"+event.ID, 10*time.Minute)
	if err != nil || !first {
		<-b.slots
		return err
	}
	b.jobsMu.Lock()
	defer b.jobsMu.Unlock()
	if err := b.ctx.Err(); err != nil {
		<-b.slots
		return err
	}
	b.jobs.Go(func() {
		defer func() { <-b.slots }()
		jobCtx, cancel := context.WithTimeout(b.ctx, 45*time.Second)
		defer cancel()
		b.respond(jobCtx, event)
	})
	return nil
}
