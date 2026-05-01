package store

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestSupabaseRepositoryFindAPIKeyByHash(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("apikey") != "service-key" {
			t.Fatalf("missing apikey header")
		}
		if strings.HasPrefix(r.URL.Path, "/rest/v1/api_keys") && r.Method == http.MethodGet {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`[{"id":"key_1","workspace_id":"ws_1","key_hash":"hash","revoked_at":null}]`))
			return
		}
		if strings.HasPrefix(r.URL.Path, "/rest/v1/api_keys") && r.Method == http.MethodPatch {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`[]`))
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer server.Close()

	repo := NewSupabaseRepository(server.URL, "service-key", http.DefaultClient)
	record, ok, err := repo.FindAPIKeyByHash(context.Background(), "hash")
	if err != nil || !ok {
		t.Fatalf("expected key, ok=%v err=%v", ok, err)
	}
	if record.WorkspaceID != "ws_1" {
		t.Fatalf("unexpected workspace %q", record.WorkspaceID)
	}
}

func TestSupabaseRepositoryDefaultPresetSteps(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/rest/v1/routing_presets") && r.Method == http.MethodGet {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`[{"id":"preset_1"}]`))
			return
		}
		if strings.HasPrefix(r.URL.Path, "/rest/v1/routing_preset_steps") && r.Method == http.MethodGet {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`[
				{"provider_connection_id":"pc_1","model_alias":"","fallback_mode":"failover","order_index":1},
				{"provider_connection_id":"pc_2","model_alias":"gpt-4.1","fallback_mode":"failover","order_index":2}
			]`))
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer server.Close()

	repo := NewSupabaseRepository(server.URL, "service-key", http.DefaultClient)
	steps, err := repo.DefaultPresetSteps(context.Background(), "ws_1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(steps) != 2 {
		t.Fatalf("expected 2 steps, got %d", len(steps))
	}
	if steps[0].ProviderConnectionID != "pc_1" || steps[1].ProviderConnectionID != "pc_2" {
		t.Fatalf("unexpected provider connection order: %#v", steps)
	}
}

func TestSupabaseRepositoryProviderConnection(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/rest/v1/provider_connections") && r.Method == http.MethodGet {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`[
				{
					"id":"p1",
					"workspace_id":"ws_1",
					"provider_type":"openai_compatible",
					"display_name":"Test Provider",
					"auth_method":"api_key",
					"provider_family":"openai_compatible",
					"credential_encrypted":"ciphertext",
					"metadata":{"base_url":"https://api.example.com","default_model":"gpt-test"},
					"status":"active"
				}
			]`))
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer server.Close()

	repo := NewSupabaseRepository(server.URL, "service-key", http.DefaultClient)
	provider, ok, err := repo.ProviderConnection(context.Background(), "ws_1", "p1")
	if err != nil || !ok {
		t.Fatalf("expected provider, ok=%v err=%v", ok, err)
	}
	if provider.ID != "p1" || provider.WorkspaceID != "ws_1" || provider.DisplayName != "Test Provider" {
		t.Fatalf("unexpected provider fields: %#v", provider)
	}
	if provider.Metadata["base_url"] != "https://api.example.com" {
		t.Fatalf("unexpected metadata: %#v", provider.Metadata)
	}
}

func TestSupabaseRepositoryRecordUsage(t *testing.T) {
	var captured []map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/rest/v1/usage_events") && r.Method == http.MethodPost {
			defer r.Body.Close()
			if err := json.NewDecoder(r.Body).Decode(&captured); err != nil {
				t.Fatalf("failed decoding body: %v", err)
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`[]`))
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer server.Close()

	repo := NewSupabaseRepository(server.URL, "service-key", http.DefaultClient)
	err := repo.RecordUsage(context.Background(), UsageEvent{WorkspaceID: "ws_1", ProviderConnectionID: "pc_1", APIKeyID: "key_1", RequestID: "req_1", Status: "success", TotalTokens: 42})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(captured) != 1 {
		t.Fatalf("expected 1 usage event payload, got %d", len(captured))
	}
	if captured[0]["workspace_id"] != "ws_1" || captured[0]["status"] != "success" {
		t.Fatalf("unexpected usage payload: %#v", captured[0])
	}
}
