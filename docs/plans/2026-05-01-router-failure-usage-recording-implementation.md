# Router Failure Usage Recording Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Record authenticated router failures as structured `usage_events` so dashboard error explanations have data for failed requests.

**Architecture:** Add a small failure-recording helper to the Go router HTTP server and call it only after router API key resolution succeeds. Keep response behavior unchanged, record only structured metadata and zero token counts, and update documentation.

**Tech Stack:** Go HTTP server, existing `store.Repository` interface, Supabase-backed `usage_events`, Node/Next.js dashboard docs unchanged at API level.

---

## Pre-flight

Run from repo root:

```bash
git status --short
cd services/router && go test ./...
cd ../..
npm run lint:web
npm run build:web
node --test apps/web/lib/error-explanations.test.js
node --test apps/web/lib/provider-routing-suggestions.test.js
```

Expected: all pass. Existing untracked `.pi/` may remain.

---

### Task 1: Add failing router tests for failure usage events

**Files:**
- Modify: `services/router/internal/httpserver/server_test.go`

**Step 1: Add assertions to existing invalid API key test**

In `TestChatCompletionsRejectsInvalidAPIKey`, after the response assertions, add:

```go
	if len(repo.UsageEvents) != 0 {
		t.Fatalf("expected invalid api key not to record usage events, got %+v", repo.UsageEvents)
	}
```

**Step 2: Add usage assertion to no-preset test**

In `TestChatCompletionsNoPreset`, after the response assertions, add:

```go
	if len(repo.UsageEvents) != 1 {
		t.Fatalf("expected one failed usage event, got %d", len(repo.UsageEvents))
	}
	if repo.UsageEvents[0].Status != "failed" || repo.UsageEvents[0].ErrorCode != "preset_not_found" {
		t.Fatalf("expected failed preset_not_found usage event, got %+v", repo.UsageEvents[0])
	}
	if repo.UsageEvents[0].WorkspaceID != "ws_1" || repo.UsageEvents[0].APIKeyID != "k1" {
		t.Fatalf("expected workspace and api key on usage event, got %+v", repo.UsageEvents[0])
	}
```

**Step 3: Add usage assertion to fallback exhausted test**

In `TestChatCompletionsFallbackExhausted`, after the response assertions, add:

```go
	if len(repo.UsageEvents) != 1 {
		t.Fatalf("expected one failed usage event, got %d", len(repo.UsageEvents))
	}
	if repo.UsageEvents[0].Status != "failed" || repo.UsageEvents[0].ErrorCode != "fallback_exhausted" {
		t.Fatalf("expected failed fallback_exhausted usage event, got %+v", repo.UsageEvents[0])
	}
	if repo.UsageEvents[0].ProviderConnectionID != "p2" {
		t.Fatalf("expected final attempted provider p2, got %+v", repo.UsageEvents[0])
	}
	if repo.UsageEvents[0].PromptTokens != 0 || repo.UsageEvents[0].CompletionTokens != 0 || repo.UsageEvents[0].TotalTokens != 0 {
		t.Fatalf("expected zero tokens for failed event, got %+v", repo.UsageEvents[0])
	}
```

**Step 4: Add new non-retryable provider error test**

Append this test to `server_test.go`:

```go
func TestChatCompletionsRecordsNonRetryableProviderFailure(t *testing.T) {
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":{"message":"bad request"}}`))
	}))
	defer provider.Close()

	keyHex := "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
	cred, _ := security.EncryptCredential(keyHex, []byte(`{"api_key":"sk-provider"}`))
	repo := store.NewMemoryRepository()
	repo.APIKeys = []store.APIKeyRecord{{ID: "k1", WorkspaceID: "ws_1", KeyHash: "ec29b6f64e70ff4307ff0e5228e44f43258d3d8dd41a5f6c47519b4ac4f930e7"}}
	repo.Steps = []store.PresetStep{{ProviderConnectionID: "p1", ProviderType: "openai_compatible", OrderIndex: 1}}
	repo.Providers = []store.ProviderConnection{{
		ID:                  "p1",
		WorkspaceID:         "ws_1",
		ProviderType:        "openai_compatible",
		CredentialEncrypted: cred,
		Metadata:            map[string]any{"base_url": provider.URL, "default_model": "gpt-test-default"},
	}}
	cfg := config.Load()
	cfg.EncryptionKey = keyHex
	s := NewWithOptions(Options{Repo: repo, Config: cfg, Client: http.DefaultClient})

	req := httptest.NewRequest("POST", "/v1/chat/completions", strings.NewReader(`{"model":"auto","messages":[{"role":"user","content":"hi"}]}`))
	req.Header.Set("Authorization", "Bearer nnr_test_123")
	w := httptest.NewRecorder()
	s.Handler().ServeHTTP(w, req)

	if w.Code != 400 {
		t.Fatalf("expected provider status 400, got %d body=%s", w.Code, w.Body.String())
	}
	if len(repo.UsageEvents) != 1 {
		t.Fatalf("expected one failed usage event, got %d", len(repo.UsageEvents))
	}
	event := repo.UsageEvents[0]
	if event.Status != "failed" || event.ErrorCode != "provider_request_failed" {
		t.Fatalf("expected failed provider_request_failed event, got %+v", event)
	}
	if event.ProviderConnectionID != "p1" || event.ModelResolved != "gpt-test-default" {
		t.Fatalf("expected provider and resolved model on event, got %+v", event)
	}
}
```

**Step 5: Run tests and verify failure**

Run:

```bash
cd services/router && go test ./internal/httpserver
```

Expected: FAIL because failure usage events are not recorded yet.

**Step 6: Commit failing tests?**

Do not commit failing tests separately. Continue to Task 2 and commit tests with implementation.

---

### Task 2: Implement minimal failure usage recording

**Files:**
- Modify: `services/router/internal/httpserver/server.go`
- Modify: `services/router/internal/httpserver/server_test.go`

**Step 1: Add helper below `handleChatCompletions`**

In `server.go`, add:

```go
func (s *Server) recordFailureUsage(r *http.Request, apiKey store.APIKeyRecord, event store.UsageEvent) {
	event.WorkspaceID = apiKey.WorkspaceID
	event.APIKeyID = apiKey.ID
	event.Status = "failed"
	event.PromptTokens = 0
	event.CompletionTokens = 0
	event.TotalTokens = 0
	_ = s.repo.RecordUsage(r.Context(), event)
}
```

**Step 2: Capture requested model after JSON decode**

After the unsupported streaming check and before API key resolution, add:

```go
	modelRequested := req.Model
```

If `contracts.ChatCompletionRequest` does not expose `Model`, inspect `services/router/internal/contracts/openai.go` and use the existing field name. Do not parse/store messages.

**Step 3: Record preset-not-found failures**

Before returning `preset_not_found`, change the block to:

```go
	if err != nil || len(steps) == 0 {
		s.recordFailureUsage(r, apiKey, store.UsageEvent{
			RequestID:      "req_1",
			ModelRequested: modelRequested,
			ErrorCode:      contracts.ErrorPresetNotFound,
		})
		writeError(w, http.StatusNotFound, contracts.ErrorPresetNotFound, "default preset not found")
		return
	}
```

**Step 4: Track last attempted failure context**

Before the fallback loop, add:

```go
	lastFailureEvent := store.UsageEvent{
		RequestID:      "req_1",
		ModelRequested: modelRequested,
		ErrorCode:      contracts.ErrorFallbackExhausted,
	}
```

At the top of each loop attempt, after `step := steps[attempt]`, add:

```go
		lastFailureEvent.ProviderConnectionID = step.ProviderConnectionID
```

**Step 5: Record provider lookup failure**

Before returning `provider_not_found`, add:

```go
			s.recordFailureUsage(r, apiKey, store.UsageEvent{
				ProviderConnectionID: step.ProviderConnectionID,
				RequestID:            "req_1",
				ModelRequested:       modelRequested,
				ErrorCode:            contracts.ErrorProviderNotFound,
			})
```

**Step 6: Record unsupported provider type**

Before returning `provider_request_failed` for unsupported provider type, add:

```go
			s.recordFailureUsage(r, apiKey, store.UsageEvent{
				ProviderConnectionID: provider.ID,
				RequestID:            "req_1",
				ModelRequested:       modelRequested,
				ErrorCode:            contracts.ErrorProviderRequestFailed,
			})
```

**Step 7: Record invalid provider metadata**

Before returning `provider metadata invalid`, add:

```go
			s.recordFailureUsage(r, apiKey, store.UsageEvent{
				ProviderConnectionID: provider.ID,
				RequestID:            "req_1",
				ModelRequested:       modelRequested,
				ErrorCode:            contracts.ErrorProviderRequestFailed,
			})
```

**Step 8: Record credential failures**

Before each credential failure return, add a failure event with:

```go
store.UsageEvent{
	ProviderConnectionID: provider.ID,
	RequestID:            "req_1",
	ModelRequested:       modelRequested,
	ErrorCode:            contracts.ErrorProviderCredentialMissing,
}
```

There are three returns to update:

- decrypt error
- credential JSON parse error
- empty provider API key

**Step 9: Update resolved model in failure context**

After:

```go
		resolvedModel, _ := body["model"].(string)
```

add:

```go
		lastFailureEvent.ProviderConnectionID = provider.ID
		lastFailureEvent.ModelRequested = requestedModel
		lastFailureEvent.ModelResolved = resolvedModel
```

**Step 10: Record invalid request payload after auth**

Before returning `invalid request payload`, add:

```go
			s.recordFailureUsage(r, apiKey, store.UsageEvent{
				ProviderConnectionID: provider.ID,
				RequestID:            "req_1",
				ModelRequested:       requestedModel,
				ModelResolved:        resolvedModel,
				ErrorCode:            contracts.ErrorInvalidRequest,
			})
```

**Step 11: Record fallback exhausted on final transport error**

Before returning fallback exhausted in the adapter error final-attempt block, add:

```go
			s.recordFailureUsage(r, apiKey, lastFailureEvent)
```

**Step 12: Record non-retryable provider HTTP failures**

Before forwarding a non-retryable provider status/body, add:

```go
		s.recordFailureUsage(r, apiKey, store.UsageEvent{
			ProviderConnectionID: provider.ID,
			RequestID:            "req_1",
			ModelRequested:       requestedModel,
			ModelResolved:        resolvedModel,
			ErrorCode:            contracts.ErrorProviderRequestFailed,
		})
```

**Step 13: Record fallback exhausted after loop**

Before the final `writeError` after the loop, add:

```go
	s.recordFailureUsage(r, apiKey, lastFailureEvent)
```

**Step 14: Run router tests**

Run:

```bash
cd services/router && go test ./internal/httpserver
```

Expected: PASS.

**Step 15: Run all Go tests**

Run:

```bash
cd services/router && go test ./...
```

Expected: PASS.

**Step 16: Commit**

```bash
git add services/router/internal/httpserver/server.go services/router/internal/httpserver/server_test.go
git commit -m "feat: record authenticated router failures"
```

---

### Task 3: Update docs for failure usage semantics

**Files:**
- Modify: `README.md`
- Modify: `docs/API_CONTRACT.md`
- Modify: `docs/DB_SCHEMA.md`
- Modify: `docs/BACKLOG.md`
- Modify: `docs/SETUP.md`

**Step 1: README**

Add a feature bullet near usage/error explanation text:

```md
- Authenticated router failures are recorded as zero-token usage events for dashboard explanations
```

**Step 2: API contract**

In router `/v1/chat/completions` or usage section, add:

```md
Authenticated router failures after API-key resolution are recorded in `usage_events` with `status = "failed"`, a structured `error_code`, and zero token counts. Missing or invalid router API keys are not recorded as usage events because no workspace can be safely resolved.
```

**Step 3: DB schema**

In the `usage_events` section, document:

```md
Failure events use the same table with `status = "failed"`, `error_code` set, and token fields set to `0`. Failure events never store prompts, completions, provider response bodies, or credential material.
```

**Step 4: Backlog**

Mark router failure usage recording as complete or add it under completed/current capabilities.

**Step 5: Setup**

Add a manual verification step:

```md
With a valid router API key, trigger a missing-preset or fallback-exhausted request and confirm `/api/usage` shows a `failed` event with a structured `error_code` and zero token counts.
```

**Step 6: Verify docs do not mention old branding**

Run:

```bash
rg -n "9router|cloud-router" README.md docs || true
```

Expected: no product-facing old branding introduced by this task. Existing repo/path references, if any, should be reviewed before changing.

**Step 7: Commit**

```bash
git add README.md docs/API_CONTRACT.md docs/DB_SCHEMA.md docs/BACKLOG.md docs/SETUP.md
git commit -m "docs: document router failure usage recording"
```

---

### Task 4: Final verification

Run from repo root:

```bash
cd services/router && go test ./...
cd ../..
node --test apps/web/lib/error-explanations.test.js
node --test apps/web/lib/provider-routing-suggestions.test.js
npm run lint:web
npm run build:web
```

Expected:

- Go router tests pass.
- Error explanation helper tests pass.
- Provider routing suggestion tests pass.
- Web lint passes.
- Web production build passes.

Inspect:

```bash
git status --short
git log --oneline -8
```

Expected: clean except local untracked `.pi/` if present.

Report commits and verification results.
