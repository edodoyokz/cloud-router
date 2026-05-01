package httpserver

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"router/internal/config"
	"router/internal/security"
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

func TestChatCompletionsForwardsToOpenAICompatibleProvider(t *testing.T) {
	var gotAuth string
	var gotModel string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		bodyBytes, _ := io.ReadAll(r.Body)
		if !strings.Contains(string(bodyBytes), `"model":"gpt-test-default"`) {
			t.Fatalf("expected mapped model in payload, got %s", string(bodyBytes))
		}
		gotModel = "gpt-test-default"
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"chatcmpl_x","choices":[]}`))
	}))
	defer upstream.Close()

	keyHex := "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
	ciphertext, err := security.EncryptCredential(keyHex, []byte(`{"api_key":"sk-upstream"}`))
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}

	repo := store.NewMemoryRepository()
	repo.APIKeys = []store.APIKeyRecord{{ID: "k1", WorkspaceID: "ws_1", KeyHash: "ec29b6f64e70ff4307ff0e5228e44f43258d3d8dd41a5f6c47519b4ac4f930e7"}}
	repo.Steps = []store.PresetStep{{ProviderConnectionID: "p1", ProviderType: "openai_compatible", OrderIndex: 1}}
	repo.Providers = []store.ProviderConnection{{
		ID:                  "p1",
		WorkspaceID:         "ws_1",
		ProviderType:        "openai_compatible",
		CredentialEncrypted: ciphertext,
		Metadata:            map[string]any{"base_url": upstream.URL, "default_model": "gpt-test-default"},
	}}

	cfg := config.Load()
	cfg.EncryptionKey = keyHex
	s := NewWithOptions(Options{Repo: repo, Config: cfg, Client: http.DefaultClient})

	req := httptest.NewRequest("POST", "/v1/chat/completions", strings.NewReader(`{"model":"auto","messages":[{"role":"user","content":"hi"}]}`))
	req.Header.Set("Authorization", "Bearer nnr_test_123")
	w := httptest.NewRecorder()

	s.Handler().ServeHTTP(w, req)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d body=%s", w.Code, w.Body.String())
	}
	if gotAuth != "Bearer sk-upstream" {
		t.Fatalf("unexpected auth %q", gotAuth)
	}
	if gotModel != "gpt-test-default" {
		t.Fatalf("unexpected model %q", gotModel)
	}
	if len(repo.UsageEvents) != 1 || repo.UsageEvents[0].Status != "success" {
		t.Fatalf("expected one success usage event")
	}
}

func TestChatCompletionsFallbackToSecondProvider(t *testing.T) {
	providerA := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusTooManyRequests)
		_, _ = w.Write([]byte(`{"error":"rate_limited"}`))
	}))
	defer providerA.Close()

	providerB := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"chatcmpl_b","choices":[]}`))
	}))
	defer providerB.Close()

	keyHex := "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
	credA, _ := security.EncryptCredential(keyHex, []byte(`{"api_key":"sk-a"}`))
	credB, _ := security.EncryptCredential(keyHex, []byte(`{"api_key":"sk-b"}`))

	repo := store.NewMemoryRepository()
	repo.APIKeys = []store.APIKeyRecord{{ID: "k1", WorkspaceID: "ws_1", KeyHash: "ec29b6f64e70ff4307ff0e5228e44f43258d3d8dd41a5f6c47519b4ac4f930e7"}}
	repo.Steps = []store.PresetStep{
		{ProviderConnectionID: "p1", ProviderType: "openai_compatible", OrderIndex: 1},
		{ProviderConnectionID: "p2", ProviderType: "openai_compatible", OrderIndex: 2},
	}
	repo.Providers = []store.ProviderConnection{
		{ID: "p1", WorkspaceID: "ws_1", ProviderType: "openai_compatible", CredentialEncrypted: credA, Metadata: map[string]any{"base_url": providerA.URL, "default_model": "gpt-a"}},
		{ID: "p2", WorkspaceID: "ws_1", ProviderType: "openai_compatible", CredentialEncrypted: credB, Metadata: map[string]any{"base_url": providerB.URL, "default_model": "gpt-b"}},
	}

	cfg := config.Load()
	cfg.EncryptionKey = keyHex
	cfg.MaxFallbackHops = 3
	s := NewWithOptions(Options{Repo: repo, Config: cfg, Client: http.DefaultClient})

	req := httptest.NewRequest("POST", "/v1/chat/completions", strings.NewReader(`{"model":"auto","messages":[{"role":"user","content":"hi"}]}`))
	req.Header.Set("Authorization", "Bearer nnr_test_123")
	w := httptest.NewRecorder()

	s.Handler().ServeHTTP(w, req)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d body=%s", w.Code, w.Body.String())
	}
	if len(repo.UsageEvents) != 1 || repo.UsageEvents[0].Status != "fallback" {
		t.Fatalf("expected one fallback usage event")
	}
}

func TestChatCompletionsFallbackExhausted(t *testing.T) {
	providerA := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusTooManyRequests)
		_, _ = w.Write([]byte(`{"error":"rate_limited"}`))
	}))
	defer providerA.Close()
	providerB := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
		_, _ = w.Write([]byte(`{"error":"unavailable"}`))
	}))
	defer providerB.Close()

	keyHex := "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
	credA, _ := security.EncryptCredential(keyHex, []byte(`{"api_key":"sk-a"}`))
	credB, _ := security.EncryptCredential(keyHex, []byte(`{"api_key":"sk-b"}`))
	repo := store.NewMemoryRepository()
	repo.APIKeys = []store.APIKeyRecord{{ID: "k1", WorkspaceID: "ws_1", KeyHash: "ec29b6f64e70ff4307ff0e5228e44f43258d3d8dd41a5f6c47519b4ac4f930e7"}}
	repo.Steps = []store.PresetStep{{ProviderConnectionID: "p1", ProviderType: "openai_compatible", OrderIndex: 1}, {ProviderConnectionID: "p2", ProviderType: "openai_compatible", OrderIndex: 2}}
	repo.Providers = []store.ProviderConnection{
		{ID: "p1", WorkspaceID: "ws_1", ProviderType: "openai_compatible", CredentialEncrypted: credA, Metadata: map[string]any{"base_url": providerA.URL, "default_model": "gpt-a"}},
		{ID: "p2", WorkspaceID: "ws_1", ProviderType: "openai_compatible", CredentialEncrypted: credB, Metadata: map[string]any{"base_url": providerB.URL, "default_model": "gpt-b"}},
	}
	cfg := config.Load()
	cfg.EncryptionKey = keyHex
	cfg.MaxFallbackHops = 3
	s := NewWithOptions(Options{Repo: repo, Config: cfg, Client: http.DefaultClient})

	req := httptest.NewRequest("POST", "/v1/chat/completions", strings.NewReader(`{"model":"auto","messages":[{"role":"user","content":"hi"}]}`))
	req.Header.Set("Authorization", "Bearer nnr_test_123")
	w := httptest.NewRecorder()
	s.Handler().ServeHTTP(w, req)

	if w.Code != 502 {
		t.Fatalf("expected 502, got %d body=%s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "fallback_exhausted") {
		t.Fatalf("expected fallback_exhausted, got %s", w.Body.String())
	}
}
