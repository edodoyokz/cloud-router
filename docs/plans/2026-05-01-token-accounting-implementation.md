# Token Accounting Thin Slice Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extract token usage from successful OpenAI-compatible chat completion responses, persist prompt/completion/total token counts, and show token split in the usage dashboard.

**Architecture:** Extend the Go `UsageEvent` store contract with prompt/completion tokens. Add best-effort response usage parsing in the HTTP server before recording usage. Update Supabase/memory repositories. Update web usage API selection, usage summary helper, dashboard rendering, and docs.

**Tech Stack:** Go router service, Next.js 16 App Router, React 19 dashboard, Supabase usage_events table.

---

## Current Repository Context

Approved design:

```text
docs/plans/2026-05-01-token-accounting-design.md
```

Relevant files:

```text
services/router/internal/store/store.go
services/router/internal/store/supabase.go
services/router/internal/store/memory.go
services/router/internal/httpserver/server.go
services/router/internal/httpserver/server_test.go
apps/web/app/api/usage/route.js
apps/web/lib/usage-summary.js
apps/web/app/dashboard/dashboard-client.jsx
README.md
docs/API_CONTRACT.md
docs/SETUP.md
docs/BACKLOG.md
```

Current behavior:

- Router records successful usage events with only `TotalTokens` defaulting to `0`.
- Supabase repository writes `total_tokens` but not `prompt_tokens` / `completion_tokens`.
- Usage API returns `total_tokens` only.
- Dashboard shows total tokens only.

Constraints:

- Do not implement pricing/cost in this slice.
- Do not store prompt/response text.
- Do not alter provider response body returned to clients.
- Non-streaming chat completions only.
- Keep behavior safe if provider omits `usage` or returns non-JSON body.

---

## Task 1: Extend usage event store contract

**Files:**
- Modify: `services/router/internal/store/store.go`
- Modify: `services/router/internal/store/supabase.go`

**Step 1: Update `UsageEvent`**

In `services/router/internal/store/store.go`, replace:

```go
TotalTokens          int
```

with:

```go
PromptTokens         int
CompletionTokens     int
TotalTokens          int
```

**Step 2: Update Supabase payload**

In `services/router/internal/store/supabase.go`, update `RecordUsage` payload from:

```go
"total_tokens":            event.TotalTokens,
```

to:

```go
"prompt_tokens":           event.PromptTokens,
"completion_tokens":       event.CompletionTokens,
"total_tokens":            event.TotalTokens,
```

**Step 3: Run Go tests**

```bash
cd services/router && go test ./...
```

Expected: PASS. Existing code will compile because zero-value fields are available.

**Step 4: Commit**

```bash
git add services/router/internal/store/store.go services/router/internal/store/supabase.go
git commit -m "feat: add usage token fields to store"
```

---

## Task 2: Add router response usage parsing

**Files:**
- Modify: `services/router/internal/httpserver/server.go`
- Modify: `services/router/internal/httpserver/server_test.go`

**Step 1: Add usage parsing helper**

In `server.go`, add near `retryableStatus`:

```go
type responseUsage struct {
	PromptTokens     int `json:"prompt_tokens"`
	CompletionTokens int `json:"completion_tokens"`
	TotalTokens      int `json:"total_tokens"`
}

func extractTokenUsage(body []byte) responseUsage {
	var payload struct {
		Usage responseUsage `json:"usage"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return responseUsage{}
	}
	usage := payload.Usage
	if usage.TotalTokens == 0 && (usage.PromptTokens > 0 || usage.CompletionTokens > 0) {
		usage.TotalTokens = usage.PromptTokens + usage.CompletionTokens
	}
	return usage
}
```

**Important:** This helper uses `json` already imported by `server.go`.

**Step 2: Record parsed tokens**

In successful response branch, before `RecordUsage`, add:

```go
usage := extractTokenUsage(resp.Body)
```

Then replace current usage record:

```go
_ = s.repo.RecordUsage(r.Context(), store.UsageEvent{WorkspaceID: apiKey.WorkspaceID, ProviderConnectionID: provider.ID, APIKeyID: apiKey.ID, RequestID: "req_1", ModelRequested: requestedModel, ModelResolved: resolvedModel, Status: status})
```

with formatted multi-line struct:

```go
_ = s.repo.RecordUsage(r.Context(), store.UsageEvent{
	WorkspaceID:          apiKey.WorkspaceID,
	ProviderConnectionID: provider.ID,
	APIKeyID:             apiKey.ID,
	RequestID:            "req_1",
	ModelRequested:       requestedModel,
	ModelResolved:        resolvedModel,
	Status:               status,
	PromptTokens:         usage.PromptTokens,
	CompletionTokens:     usage.CompletionTokens,
	TotalTokens:          usage.TotalTokens,
})
```

**Step 3: Add tests**

Update `TestChatCompletionsForwardsToOpenAICompatibleProvider` upstream response from:

```go
_, _ = w.Write([]byte(`{"id":"chatcmpl_x","choices":[]}`))
```

to:

```go
_, _ = w.Write([]byte(`{"id":"chatcmpl_x","choices":[],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}`))
```

After existing usage event status assertion, add:

```go
if repo.UsageEvents[0].PromptTokens != 10 || repo.UsageEvents[0].CompletionTokens != 5 || repo.UsageEvents[0].TotalTokens != 15 {
	t.Fatalf("unexpected token usage: %+v", repo.UsageEvents[0])
}
```

Add a new test near the forwarding test:

```go
func TestChatCompletionsRecordsZeroTokensWhenUsageMissing(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
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
	if len(repo.UsageEvents) != 1 {
		t.Fatalf("expected one usage event")
	}
	if repo.UsageEvents[0].PromptTokens != 0 || repo.UsageEvents[0].CompletionTokens != 0 || repo.UsageEvents[0].TotalTokens != 0 {
		t.Fatalf("expected zero token usage, got %+v", repo.UsageEvents[0])
	}
}
```

Add a direct helper test:

```go
func TestExtractTokenUsageComputesTotalWhenMissing(t *testing.T) {
	usage := extractTokenUsage([]byte(`{"usage":{"prompt_tokens":7,"completion_tokens":3}}`))
	if usage.PromptTokens != 7 || usage.CompletionTokens != 3 || usage.TotalTokens != 10 {
		t.Fatalf("unexpected usage: %+v", usage)
	}
}
```

**Step 4: Run Go tests**

```bash
cd services/router && go test ./...
```

Expected: PASS.

**Step 5: Commit**

```bash
git add services/router/internal/httpserver/server.go services/router/internal/httpserver/server_test.go
git commit -m "feat: record provider token usage"
```

---

## Task 3: Update usage API and summary helper

**Files:**
- Modify: `apps/web/app/api/usage/route.js`
- Modify: `apps/web/lib/usage-summary.js`

**Step 1: Select token split fields**

In `apps/web/app/api/usage/route.js`, update select from:

```js
select=id,provider_connection_id,api_key_id,request_id,model_requested,model_resolved,total_tokens,status,error_code,created_at
```

to:

```js
select=id,provider_connection_id,api_key_id,request_id,model_requested,model_resolved,prompt_tokens,completion_tokens,total_tokens,status,error_code,created_at
```

**Step 2: Summarize token split**

In `apps/web/lib/usage-summary.js`, change:

```js
const totalTokens = safeEvents.reduce((sum, event) => sum + Number(event.total_tokens || 0), 0);
```

to:

```js
const promptTokens = safeEvents.reduce((sum, event) => sum + Number(event.prompt_tokens || 0), 0);
const completionTokens = safeEvents.reduce((sum, event) => sum + Number(event.completion_tokens || 0), 0);
const totalTokens = safeEvents.reduce((sum, event) => sum + Number(event.total_tokens || 0), 0);
```

Then return:

```js
prompt_tokens: promptTokens,
completion_tokens: completionTokens,
total_tokens: totalTokens,
```

so the return object becomes:

```js
return {
  total_requests: totalRequests,
  prompt_tokens: promptTokens,
  completion_tokens: completionTokens,
  total_tokens: totalTokens,
  success_rate: successRate,
  fallback_count: fallbackCount,
  failed_count: failedCount,
  estimated_cost_usd: 0
};
```

**Step 3: Run lint/build**

```bash
npm run lint:web
npm run build:web
```

Expected: PASS.

**Step 4: Commit**

```bash
git add apps/web/app/api/usage/route.js apps/web/lib/usage-summary.js
git commit -m "feat: return usage token breakdown"
```

---

## Task 4: Update dashboard usage display

**Files:**
- Modify: `apps/web/app/dashboard/dashboard-client.jsx`

**Step 1: Add summary cards**

In Usage section stat cards, current cards include:

```jsx
<StatCard label="Requests" value={formatNumber(usage?.summary?.total_requests)} />
<StatCard label="Tokens" value={formatNumber(usage?.summary?.total_tokens)} />
<StatCard label="Success rate" value={formatPercent(usage?.summary?.success_rate)} />
<StatCard label="Fallbacks" value={formatNumber(usage?.summary?.fallback_count)} />
<StatCard label="Failures" value={formatNumber(usage?.summary?.failed_count)} />
```

Change to include prompt/completion split:

```jsx
<StatCard label="Requests" value={formatNumber(usage?.summary?.total_requests)} />
<StatCard label="Total tokens" value={formatNumber(usage?.summary?.total_tokens)} />
<StatCard label="Prompt tokens" value={formatNumber(usage?.summary?.prompt_tokens)} />
<StatCard label="Completion tokens" value={formatNumber(usage?.summary?.completion_tokens)} />
<StatCard label="Success rate" value={formatPercent(usage?.summary?.success_rate)} />
<StatCard label="Fallbacks" value={formatNumber(usage?.summary?.fallback_count)} />
<StatCard label="Failures" value={formatNumber(usage?.summary?.failed_count)} />
```

Optional but recommended: include estimated cost placeholder if already present in summary:

```jsx
<StatCard label="Estimated cost" value={`$${Number(usage?.summary?.estimated_cost_usd || 0).toFixed(4)}`} />
```

Only add if layout remains clean.

**Step 2: Update recent event token line**

Replace:

```jsx
<span>Tokens: {formatNumber(event.total_tokens)}</span>
```

with:

```jsx
<span>Tokens: {formatNumber(event.total_tokens)} total / {formatNumber(event.prompt_tokens)} prompt / {formatNumber(event.completion_tokens)} completion</span>
```

**Step 3: Run lint/build**

```bash
npm run lint:web
npm run build:web
```

Expected: PASS.

**Step 4: Commit**

```bash
git add apps/web/app/dashboard/dashboard-client.jsx
git commit -m "feat: show usage token breakdown"
```

---

## Task 5: Update docs

**Files:**
- Modify: `README.md`
- Modify: `docs/API_CONTRACT.md`
- Modify: `docs/SETUP.md`
- Modify: `docs/BACKLOG.md`

**Step 1: README**

Update Current Thin Slice bullet:

```md
- Dashboard displays usage summary, token breakdown, and recent router events
```

Update Next Build Steps by moving token/cost improvements down or clarifying pricing:

```md
## Next Build Steps
1. Add provider reconnect flow
2. Add pricing/cost estimation configuration
3. Add richer onboarding snippets for Claude Code / Codex / OpenClaw / Cursor
4. Add production SSR/cookie auth hardening
```

**Step 2: API contract**

In `GET /api/usage`, update event response sample to include:

```json
"prompt_tokens": 10,
"completion_tokens": 5,
"total_tokens": 15
```

Update summary sample to include:

```json
"prompt_tokens": 100,
"completion_tokens": 50,
"total_tokens": 150
```

Add note:

```md
Token fields are parsed from successful OpenAI-compatible provider responses when available. Missing provider usage is recorded as zero.
```

**Step 3: SETUP**

Add smoke step:

```md
Send a router request to a provider that returns OpenAI-compatible `usage`; confirm `/dashboard` Usage shows prompt/completion/total token counts.
```

**Step 4: BACKLOG**

Add note:

```md
- Token accounting thin slice is implemented for successful non-streaming chat completions.
```

If backlog has usage dashboard item still unchecked, mark it done:

```md
- [x] Basic usage dashboard
```

**Step 5: Commit**

```bash
git add README.md docs/API_CONTRACT.md docs/SETUP.md docs/BACKLOG.md
git commit -m "docs: document token accounting"
```

---

## Task 6: Final verification

**Files:**
- No code changes expected unless fixing failures.

**Step 1: Run web lint**

```bash
npm run lint:web
```

Expected: PASS.

**Step 2: Run web build**

```bash
npm run build:web
```

Expected: PASS.

**Step 3: Run Go tests**

```bash
cd services/router && go test ./...
```

Expected: PASS, including new token usage tests.

**Step 4: Check worktree**

```bash
git status --short
```

Expected: clean except `.pi/` if present.

**Step 5: Commit final fixes if any**

If any fixes were needed:

```bash
git add <files>
git commit -m "chore: finalize token accounting slice"
```

---

## Manual Smoke Test

With Supabase env configured and a provider that returns OpenAI-compatible usage:

1. Start web:
   ```bash
   npm run dev:web
   ```
2. Start router:
   ```bash
   npm run dev:router
   ```
3. Send a non-streaming router request:
   ```bash
   curl "$NEXT_PUBLIC_ROUTER_BASE_URL/v1/chat/completions" \
     -H "Authorization: Bearer $NUSANEXUS_ROUTER_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{"model":"auto","messages":[{"role":"user","content":"Say hi"}]}'
   ```
4. Confirm provider response includes `usage`.
5. Open `/dashboard` Usage section.
6. Confirm summary cards show non-zero prompt/completion/total tokens.
7. Confirm recent event token line shows:
   ```text
   Tokens: <total> total / <prompt> prompt / <completion> completion
   ```

---

## Deferred Work

Do not implement these in this plan:

- Pricing/cost estimation.
- Per-provider/model pricing config.
- Usage charts.
- Daily aggregation tables.
- Failed-attempt usage accounting.
- Streaming token accounting.

---

## Execution Handoff

Plan complete and saved to:

```text
docs/plans/2026-05-01-token-accounting-implementation.md
```

Recommended prompt for a parallel session:

```text
Use superpowers:executing-plans to implement this plan task-by-task:

docs/plans/2026-05-01-token-accounting-implementation.md

Follow the plan exactly, use TDD where specified, make the commits described in each task, and stop for review if any task fails or requires product/design clarification.
```
