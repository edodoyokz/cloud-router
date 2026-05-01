package httpserver

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"router/internal/config"
	"router/internal/store"
)

func TestHealth(t *testing.T) {
	s := New()
	req := httptest.NewRequest("GET", "/health", nil)
	w := httptest.NewRecorder()

	s.Handler().ServeHTTP(w, req)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

func TestNewWithDefaults(t *testing.T) {
	s := New()
	if s.Handler() == nil {
		t.Fatalf("expected handler")
	}
}

func TestChatCompletionsRejectsStreaming(t *testing.T) {
	s := New()
	req := httptest.NewRequest("POST", "/v1/chat/completions", strings.NewReader(`{"model":"auto","stream":true,"messages":[]}`))
	req.Header.Set("Authorization", "Bearer test")
	w := httptest.NewRecorder()

	s.Handler().ServeHTTP(w, req)

	if w.Code != 400 {
		t.Fatalf("expected 400, got %d", w.Code)
	}
	if !strings.Contains(w.Body.String(), "unsupported_streaming") {
		t.Fatalf("expected unsupported_streaming, got %s", w.Body.String())
	}
}

func TestChatCompletionsRejectsInvalidAPIKey(t *testing.T) {
	repo := store.NewMemoryRepository()
	s := NewWithOptions(Options{Repo: repo, Config: config.Load(), Client: http.DefaultClient})

	req := httptest.NewRequest("POST", "/v1/chat/completions", strings.NewReader(`{"model":"auto","messages":[]}`))
	req.Header.Set("Authorization", "Bearer bad-key")
	w := httptest.NewRecorder()

	s.Handler().ServeHTTP(w, req)

	if w.Code != 401 {
		t.Fatalf("expected 401, got %d", w.Code)
	}
	if !strings.Contains(w.Body.String(), "invalid_api_key") {
		t.Fatalf("expected invalid_api_key, got %s", w.Body.String())
	}
}

func TestChatCompletionsNoPreset(t *testing.T) {
	repo := store.NewMemoryRepository()
	repo.APIKeys = []store.APIKeyRecord{{ID: "k1", WorkspaceID: "ws_1", KeyHash: "ec29b6f64e70ff4307ff0e5228e44f43258d3d8dd41a5f6c47519b4ac4f930e7"}}
	s := NewWithOptions(Options{Repo: repo, Config: config.Load(), Client: http.DefaultClient})

	req := httptest.NewRequest("POST", "/v1/chat/completions", strings.NewReader(`{"model":"auto","messages":[]}`))
	req.Header.Set("Authorization", "Bearer nnr_test_123")
	w := httptest.NewRecorder()

	s.Handler().ServeHTTP(w, req)

	if w.Code != 404 {
		t.Fatalf("expected 404, got %d", w.Code)
	}
	if !strings.Contains(w.Body.String(), "preset_not_found") {
		t.Fatalf("expected preset_not_found, got %s", w.Body.String())
	}
}
