package httpserver

import (
	"net/http/httptest"
	"strings"
	"testing"
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
