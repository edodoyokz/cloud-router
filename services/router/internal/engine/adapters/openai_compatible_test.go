package adapters

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"router/internal/engine"
)

func TestOpenAICompatibleAdapterForwardsChatCompletion(t *testing.T) {
	var gotAuth string
	var gotModel string

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		if r.URL.Path != "/v1/chat/completions" {
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode: %v", err)
		}
		gotModel, _ = body["model"].(string)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"chatcmpl_test","choices":[]}`))
	}))
	defer upstream.Close()

	adapter := NewOpenAICompatibleAdapter(upstream.URL, "sk-test", http.DefaultClient)
	resp, err := adapter.Send(context.Background(), engine.ProviderRequest{
		RequestID:    "req_1",
		ProviderType: "openai_compatible",
		Model:        "gpt-test",
		Payload:      []byte(`{"model":"gpt-test","messages":[{"role":"user","content":"hi"}]}`),
	})
	if err != nil {
		t.Fatalf("send: %v", err)
	}
	if resp.StatusCode != 200 {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
	if gotAuth != "Bearer sk-test" {
		t.Fatalf("unexpected auth %q", gotAuth)
	}
	if gotModel != "gpt-test" {
		t.Fatalf("unexpected model %q", gotModel)
	}
}
