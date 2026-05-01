package store

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type SupabaseRepository struct {
	baseURL    string
	serviceKey string
	client     *http.Client
}

func NewSupabaseRepository(baseURL, serviceKey string, client *http.Client) *SupabaseRepository {
	if client == nil {
		client = http.DefaultClient
	}
	return &SupabaseRepository{baseURL: strings.TrimRight(baseURL, "/"), serviceKey: serviceKey, client: client}
}

func (r *SupabaseRepository) do(ctx context.Context, method, path string, body any) ([]byte, error) {
	var reader io.Reader
	if body != nil {
		payload, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		reader = bytes.NewReader(payload)
	}

	req, err := http.NewRequestWithContext(ctx, method, r.baseURL+path, reader)
	if err != nil {
		return nil, err
	}
	req.Header.Set("apikey", r.serviceKey)
	req.Header.Set("Authorization", "Bearer "+r.serviceKey)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Prefer", "return=representation")

	resp, err := r.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("supabase %s %s failed: status=%d body=%s", method, path, resp.StatusCode, string(data))
	}
	return data, nil
}

func (r *SupabaseRepository) FindAPIKeyByHash(ctx context.Context, hash string) (APIKeyRecord, bool, error) {
	query := "/rest/v1/api_keys?key_hash=eq." + url.QueryEscape(hash) + "&revoked_at=is.null&select=*"
	data, err := r.do(ctx, http.MethodGet, query, nil)
	if err != nil {
		return APIKeyRecord{}, false, err
	}

	var rows []struct {
		ID          string  `json:"id"`
		WorkspaceID string  `json:"workspace_id"`
		KeyHash     string  `json:"key_hash"`
		RevokedAt   *string `json:"revoked_at"`
	}
	if err := json.Unmarshal(data, &rows); err != nil {
		return APIKeyRecord{}, false, err
	}
	if len(rows) == 0 {
		return APIKeyRecord{}, false, nil
	}

	row := rows[0]
	_, _ = r.do(ctx, http.MethodPatch, "/rest/v1/api_keys?id=eq."+url.QueryEscape(row.ID), map[string]any{"last_used_at": time.Now().UTC().Format(time.RFC3339)})

	return APIKeyRecord{ID: row.ID, WorkspaceID: row.WorkspaceID, KeyHash: row.KeyHash, Revoked: row.RevokedAt != nil}, true, nil
}

func (r *SupabaseRepository) DefaultPresetSteps(ctx context.Context, workspaceID string) ([]PresetStep, error) {
	presetQuery := "/rest/v1/routing_presets?workspace_id=eq." + url.QueryEscape(workspaceID) + "&is_default=eq.true&select=id&limit=1"
	data, err := r.do(ctx, http.MethodGet, presetQuery, nil)
	if err != nil {
		return nil, err
	}

	var presets []struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(data, &presets); err != nil {
		return nil, err
	}
	if len(presets) == 0 {
		return nil, nil
	}

	stepsQuery := "/rest/v1/routing_preset_steps?preset_id=eq." + url.QueryEscape(presets[0].ID) + "&select=*&order=order_index.asc"
	data, err = r.do(ctx, http.MethodGet, stepsQuery, nil)
	if err != nil {
		return nil, err
	}

	var rows []struct {
		ProviderConnectionID string `json:"provider_connection_id"`
		ProviderType         string `json:"provider_type"`
		ModelAlias           string `json:"model_alias"`
		FallbackMode         string `json:"fallback_mode"`
		OrderIndex           int    `json:"order_index"`
	}
	if err := json.Unmarshal(data, &rows); err != nil {
		return nil, err
	}

	steps := make([]PresetStep, 0, len(rows))
	for _, row := range rows {
		steps = append(steps, PresetStep{
			ProviderConnectionID: row.ProviderConnectionID,
			ProviderType:         row.ProviderType,
			ModelAlias:           row.ModelAlias,
			FallbackMode:         row.FallbackMode,
			OrderIndex:           row.OrderIndex,
		})
	}
	return steps, nil
}

func (r *SupabaseRepository) ProviderConnection(ctx context.Context, workspaceID, providerConnectionID string) (ProviderConnection, bool, error) {
	query := "/rest/v1/provider_connections?id=eq." + url.QueryEscape(providerConnectionID) + "&workspace_id=eq." + url.QueryEscape(workspaceID) + "&status=eq.active&select=*"
	data, err := r.do(ctx, http.MethodGet, query, nil)
	if err != nil {
		return ProviderConnection{}, false, err
	}

	var rows []ProviderConnection
	if err := json.Unmarshal(data, &rows); err != nil {
		return ProviderConnection{}, false, err
	}
	if len(rows) == 0 {
		return ProviderConnection{}, false, nil
	}
	return rows[0], true, nil
}

func (r *SupabaseRepository) RecordUsage(ctx context.Context, event UsageEvent) error {
	payload := map[string]any{
		"workspace_id":            event.WorkspaceID,
		"provider_connection_id":  event.ProviderConnectionID,
		"api_key_id":              event.APIKeyID,
		"request_id":              event.RequestID,
		"model_requested":         event.ModelRequested,
		"model_resolved":          event.ModelResolved,
		"status":                  event.Status,
		"error_code":              event.ErrorCode,
		"prompt_tokens":           event.PromptTokens,
		"completion_tokens":       event.CompletionTokens,
		"total_tokens":            event.TotalTokens,
	}
	_, err := r.do(ctx, http.MethodPost, "/rest/v1/usage_events", []map[string]any{payload})
	return err
}
