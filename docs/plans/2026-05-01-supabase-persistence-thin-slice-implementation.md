# Supabase Persistence Thin Slice Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Wire the NusaNexus Router thin slice to Supabase so control-plane API routes persist provider/API-key config and the Go router reads routing config and writes usage events from/to Supabase.

**Architecture:** Keep the existing in-memory repository and tests, then add a Supabase-backed implementation selected at router startup when Supabase env vars are present. On the web side, use server-only helpers for Supabase REST access, encryption, API-key generation, and a dev-friendly workspace resolver based on `DEV_WORKSPACE_ID` until full Supabase Auth UI/session handling is implemented.

**Tech Stack:** Next.js 16 route handlers, Node Web Crypto / `crypto`, Supabase PostgREST over `fetch`, Go 1.22, Go `net/http`, `httptest`, PostgreSQL/Supabase schema already in `docs/schema.sql`.

---

## Current Repository Context

Important existing files:

- Approved design: `docs/plans/2026-05-01-supabase-persistence-thin-slice-design.md`
- Existing router repository interface: `services/router/internal/store/store.go`
- Existing memory repository: `services/router/internal/store/memory.go`
- Existing router config: `services/router/internal/config/config.go`
- Existing router server: `services/router/internal/httpserver/server.go`
- Existing web provider API skeleton: `apps/web/app/api/providers/route.js`
- Existing web provider validation: `apps/web/lib/provider-validation.js`
- Existing docs: `docs/API_CONTRACT.md`, `docs/ENV_CONFIG.md`, `docs/SETUP.md`
- Existing schema: `docs/schema.sql`

Important constraints:

- Do not expose `SUPABASE_SERVICE_ROLE_KEY` or provider API keys to client-side code.
- Keep memory repo tests passing.
- Preserve non-streaming-only router behavior.
- Do not build full auth UI in this plan.
- Use `DEV_WORKSPACE_ID` only as local/dev fallback.

---

## Task 1: Document Supabase thin-slice environment and local workflow

**Files:**
- Modify: `docs/ENV_CONFIG.md`
- Modify: `docs/SETUP.md`
- Modify: `README.md`

**Step 1: Update env docs**

In `docs/ENV_CONFIG.md`, add `DEV_WORKSPACE_ID` to web app variables:

```md
| `DEV_WORKSPACE_ID` | local only | — | Workspace UUID used by API routes before full Supabase Auth workspace resolution is implemented. Do not rely on this in production. |
```

Ensure `ENCRYPTION_KEY` is listed for web/control-plane too because provider API keys are encrypted before insertion.

**Step 2: Add local Supabase workflow**

In `docs/SETUP.md`, add a section:

```md
## Thin Slice Supabase Persistence

1. Apply `docs/schema.sql` to Supabase.
2. Create or identify a workspace row.
3. Set `DEV_WORKSPACE_ID=<workspace uuid>` in local env for web API routes.
4. Set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `ENCRYPTION_KEY` for both web API routes and router service.
5. Create provider via `POST /api/providers`.
6. Create API key via `POST /api/endpoint/keys`.
7. Use returned raw key against router `/v1/chat/completions`.
```

**Step 3: Update README quickstart**

Add a short note that Supabase-backed mode is enabled by env vars, otherwise router tests use in-memory repository.

**Step 4: Commit**

```bash
git add docs/ENV_CONFIG.md docs/SETUP.md README.md
git commit -m "docs: document supabase persistence env"
```

---

## Task 2: Add web server-only crypto helper

**Files:**
- Create: `apps/web/lib/crypto.js`
- Test manually with Node command

**Step 1: Create crypto helper**

Create `apps/web/lib/crypto.js`:

```js
import crypto from 'node:crypto';

export function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function generateApiKey() {
  const body = crypto.randomBytes(24).toString('base64url');
  return `nnr_${body}`;
}

export function apiKeyPrefix(rawKey) {
  return rawKey.length <= 10 ? rawKey : rawKey.slice(0, 10);
}

export function encryptCredential(keyHex, plaintext) {
  const key = Buffer.from(keyHex, 'hex');
  if (key.length !== 32) throw new Error('ENCRYPTION_KEY must be 32 bytes hex');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, encrypted, tag]).toString('base64');
}
```

Note: This format is `iv || ciphertext || tag`. The Go decrypt helper currently expects `nonce || ciphertext+tag`, which is compatible with Go GCM sealed data when the tag is appended to ciphertext.

**Step 2: Verify helper manually**

Run:

```bash
node -e "import('./apps/web/lib/crypto.js').then(m => { const k='0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'; const c=m.encryptCredential(k, JSON.stringify({api_key:'sk-test'})); console.log(m.sha256Hex('nnr_test').length, m.apiKeyPrefix('nnr_abcdef123'), c.length > 0) })"
```

Expected: logs `64 nnr_abcdef true` or equivalent truthy output.

**Step 3: Commit**

```bash
git add apps/web/lib/crypto.js
git commit -m "feat: add web crypto helpers for keys and credentials"
```

---

## Task 3: Add web Supabase REST admin helper

**Files:**
- Create: `apps/web/lib/supabase-admin.js`

**Step 1: Create server-only Supabase REST helper**

Create `apps/web/lib/supabase-admin.js`:

```js
const jsonHeaders = (serviceKey) => ({
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
  'Content-Type': 'application/json',
  Prefer: 'return=representation'
});

export function getSupabaseAdminConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL is required');
  if (!serviceKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required');
  return { url: url.replace(/\/+$/, ''), serviceKey };
}

export async function supabaseSelect(table, query = '') {
  const { url, serviceKey } = getSupabaseAdminConfig();
  const response = await fetch(`${url}/rest/v1/${table}${query}`, {
    method: 'GET',
    headers: jsonHeaders(serviceKey),
    cache: 'no-store'
  });
  return parseSupabaseResponse(response);
}

export async function supabaseInsert(table, rows) {
  const { url, serviceKey } = getSupabaseAdminConfig();
  const response = await fetch(`${url}/rest/v1/${table}`, {
    method: 'POST',
    headers: jsonHeaders(serviceKey),
    body: JSON.stringify(rows)
  });
  return parseSupabaseResponse(response);
}

export async function supabasePatch(table, query, patch) {
  const { url, serviceKey } = getSupabaseAdminConfig();
  const response = await fetch(`${url}/rest/v1/${table}${query}`, {
    method: 'PATCH',
    headers: jsonHeaders(serviceKey),
    body: JSON.stringify(patch)
  });
  return parseSupabaseResponse(response);
}

async function parseSupabaseResponse(response) {
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const message = data?.message || data?.error || `Supabase request failed with ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}
```

**Step 2: Build web app**

```bash
npm run build:web
```

Expected: PASS.

**Step 3: Commit**

```bash
git add apps/web/lib/supabase-admin.js
git commit -m "feat: add web supabase admin rest helper"
```

---

## Task 4: Add dev-friendly workspace resolver

**Files:**
- Create: `apps/web/lib/workspace.js`

**Step 1: Create workspace resolver**

Create `apps/web/lib/workspace.js`:

```js
export function resolveWorkspaceId() {
  const workspaceId = process.env.DEV_WORKSPACE_ID;
  if (!workspaceId) {
    const error = new Error('workspace could not be resolved');
    error.code = 'workspace_not_resolved';
    error.status = 401;
    throw error;
  }
  return workspaceId;
}
```

**Step 2: Commit**

```bash
git add apps/web/lib/workspace.js
git commit -m "feat: add dev workspace resolver"
```

---

## Task 5: Persist provider creation to Supabase and ensure default preset

**Files:**
- Modify: `apps/web/app/api/providers/route.js`
- Possibly Modify: `apps/web/lib/provider-validation.js`

**Step 1: Update route imports**

Update `apps/web/app/api/providers/route.js` imports:

```js
import { NextResponse } from 'next/server';
import { normalizeProviderInput } from '../../../lib/provider-validation.js';
import { encryptCredential } from '../../../lib/crypto.js';
import { supabaseInsert, supabasePatch, supabaseSelect } from '../../../lib/supabase-admin.js';
import { resolveWorkspaceId } from '../../../lib/workspace.js';
```

**Step 2: Implement route behavior**

Replace skeleton TODO with real persistence:

```js
const workspaceId = resolveWorkspaceId();
const encryptionKey = process.env.ENCRYPTION_KEY;
if (!encryptionKey) throw Object.assign(new Error('ENCRYPTION_KEY is required'), { status: 500, code: 'configuration_error' });

const credential_encrypted = encryptCredential(encryptionKey, JSON.stringify({ api_key: input.api_key }));
const [provider] = await supabaseInsert('provider_connections', [{
  workspace_id: workspaceId,
  provider_type: input.provider_type,
  display_name: input.display_name,
  auth_method: input.auth_method,
  provider_family: 'openai_compatible',
  capabilities: { chat_completions: true, model_selection: true, fallback: true },
  metadata: { base_url: input.base_url, default_model: input.default_model },
  credential_encrypted,
  status: 'active',
  quota_state: {}
}]);

const preset = await ensureDefaultPreset(workspaceId);
await appendPresetStep(preset.id, provider.id);

return NextResponse.json({
  id: provider.id,
  provider_type: provider.provider_type,
  display_name: provider.display_name,
  auth_method: provider.auth_method,
  status: provider.status,
  metadata: provider.metadata,
  created_at: provider.created_at
}, { status: 201 });
```

**Step 3: Add helper functions in same route file**

```js
async function ensureDefaultPreset(workspaceId) {
  const existing = await supabaseSelect('routing_presets', `?workspace_id=eq.${encodeURIComponent(workspaceId)}&is_default=eq.true&select=*`);
  if (existing.length > 0) return existing[0];
  const [created] = await supabaseInsert('routing_presets', [{
    workspace_id: workspaceId,
    name: 'Default',
    description: 'Default routing preset',
    is_default: true
  }]);
  return created;
}

async function appendPresetStep(presetId, providerConnectionId) {
  const existing = await supabaseSelect('routing_preset_steps', `?preset_id=eq.${encodeURIComponent(presetId)}&select=order_index&order=order_index.desc&limit=1`);
  const nextOrder = existing.length > 0 ? Number(existing[0].order_index || 0) + 1 : 1;
  const [step] = await supabaseInsert('routing_preset_steps', [{
    preset_id: presetId,
    order_index: nextOrder,
    provider_connection_id: providerConnectionId,
    fallback_mode: 'failover'
  }]);
  return step;
}
```

**Step 4: Improve error mapping**

Catch block should map known errors:

```js
const status = error.status || 400;
const code = error.code || (status >= 500 ? 'persistence_error' : 'validation_error');
return NextResponse.json({ error: { code, message: error.message } }, { status });
```

**Step 5: Run verification**

```bash
npm run build:web
npm run lint:web
```

Expected: PASS.

**Step 6: Commit**

```bash
git add apps/web/app/api/providers/route.js apps/web/lib/provider-validation.js
git commit -m "feat: persist provider creation to supabase"
```

---

## Task 6: Add API key generation route backed by Supabase

**Files:**
- Create: `apps/web/app/api/endpoint/keys/route.js`

**Step 1: Create route file**

Create `apps/web/app/api/endpoint/keys/route.js`:

```js
import { NextResponse } from 'next/server';
import { apiKeyPrefix, generateApiKey, sha256Hex } from '../../../../lib/crypto.js';
import { supabaseInsert } from '../../../../lib/supabase-admin.js';
import { resolveWorkspaceId } from '../../../../lib/workspace.js';

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const name = String(body?.name || 'Default key').trim();
    if (!name) throw new Error('name is required');

    const workspaceId = resolveWorkspaceId();
    const rawKey = generateApiKey();
    const [record] = await supabaseInsert('api_keys', [{
      workspace_id: workspaceId,
      name,
      key_hash: sha256Hex(rawKey),
      prefix: apiKeyPrefix(rawKey)
    }]);

    return NextResponse.json({
      id: record.id,
      name: record.name,
      prefix: record.prefix,
      raw_key: rawKey,
      created_at: record.created_at
    }, { status: 201 });
  } catch (error) {
    const status = error.status || 400;
    const code = error.code || (status >= 500 ? 'persistence_error' : 'validation_error');
    return NextResponse.json({ error: { code, message: error.message } }, { status });
  }
}
```

**Step 2: Run verification**

```bash
npm run build:web
npm run lint:web
```

Expected: PASS and route `/api/endpoint/keys` appears in build output.

**Step 3: Commit**

```bash
git add apps/web/app/api/endpoint/keys/route.js
git commit -m "feat: add supabase backed api key generation route"
```

---

## Task 7: Add Supabase repository implementation for Go router

**Files:**
- Create: `services/router/internal/store/supabase.go`
- Test: `services/router/internal/store/supabase_test.go`

**Step 1: Write failing test for API key lookup**

Create `services/router/internal/store/supabase_test.go` with an `httptest.Server` that asserts headers and returns API key rows.

Test skeleton:

```go
package store

import (
	"context"
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
```

**Step 2: Run test and verify failure**

```bash
cd services/router && go test ./internal/store
```

Expected: FAIL because `NewSupabaseRepository` does not exist.

**Step 3: Implement repository structure and HTTP helper**

Create `services/router/internal/store/supabase.go`:

```go
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
		if err != nil { return nil, err }
		reader = bytes.NewReader(payload)
	}
	req, err := http.NewRequestWithContext(ctx, method, r.baseURL+path, reader)
	if err != nil { return nil, err }
	req.Header.Set("apikey", r.serviceKey)
	req.Header.Set("Authorization", "Bearer "+r.serviceKey)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Prefer", "return=representation")
	resp, err := r.client.Do(req)
	if err != nil { return nil, err }
	defer resp.Body.Close()
	data, err := io.ReadAll(resp.Body)
	if err != nil { return nil, err }
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("supabase %s %s failed: status=%d body=%s", method, path, resp.StatusCode, string(data))
	}
	return data, nil
}
```

**Step 4: Implement FindAPIKeyByHash**

```go
func (r *SupabaseRepository) FindAPIKeyByHash(ctx context.Context, hash string) (APIKeyRecord, bool, error) {
	query := "/rest/v1/api_keys?key_hash=eq." + url.QueryEscape(hash) + "&revoked_at=is.null&select=*"
	data, err := r.do(ctx, http.MethodGet, query, nil)
	if err != nil { return APIKeyRecord{}, false, err }
	var rows []struct {
		ID string `json:"id"`
		WorkspaceID string `json:"workspace_id"`
		KeyHash string `json:"key_hash"`
		RevokedAt *string `json:"revoked_at"`
	}
	if err := json.Unmarshal(data, &rows); err != nil { return APIKeyRecord{}, false, err }
	if len(rows) == 0 { return APIKeyRecord{}, false, nil }
	row := rows[0]
	_, _ = r.do(ctx, http.MethodPatch, "/rest/v1/api_keys?id=eq."+url.QueryEscape(row.ID), map[string]any{"last_used_at": time.Now().UTC().Format(time.RFC3339)})
	return APIKeyRecord{ID: row.ID, WorkspaceID: row.WorkspaceID, KeyHash: row.KeyHash, Revoked: row.RevokedAt != nil}, true, nil
}
```

**Step 5: Run tests**

```bash
cd services/router && go test ./internal/store
```

Expected: PASS for this package.

**Step 6: Commit**

```bash
git add services/router/internal/store/supabase.go services/router/internal/store/supabase_test.go
git commit -m "feat: add supabase api key repository lookup"
```

---

## Task 8: Implement Supabase preset/provider/usage repository methods

**Files:**
- Modify: `services/router/internal/store/supabase.go`
- Modify: `services/router/internal/store/supabase_test.go`

**Step 1: Add tests for preset step ordering**

Add a test where server returns:

1. default preset row
2. routing step rows in order

Assert `DefaultPresetSteps(ctx, "ws_1")` returns expected provider connection IDs.

**Step 2: Add tests for provider connection decoding**

Server returns provider row with:

```json
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
```

Assert decoded fields.

**Step 3: Add test for usage event POST**

Assert request path `/rest/v1/usage_events`, method `POST`, and body contains `workspace_id` and `status`.

**Step 4: Implement DefaultPresetSteps**

```go
func (r *SupabaseRepository) DefaultPresetSteps(ctx context.Context, workspaceID string) ([]PresetStep, error) {
	presetQuery := "/rest/v1/routing_presets?workspace_id=eq." + url.QueryEscape(workspaceID) + "&is_default=eq.true&select=id&limit=1"
	data, err := r.do(ctx, http.MethodGet, presetQuery, nil)
	if err != nil { return nil, err }
	var presets []struct{ ID string `json:"id"` }
	if err := json.Unmarshal(data, &presets); err != nil { return nil, err }
	if len(presets) == 0 { return nil, nil }

	stepsQuery := "/rest/v1/routing_preset_steps?preset_id=eq." + url.QueryEscape(presets[0].ID) + "&select=*&order=order_index.asc"
	data, err = r.do(ctx, http.MethodGet, stepsQuery, nil)
	if err != nil { return nil, err }
	var rows []struct {
		ProviderConnectionID string `json:"provider_connection_id"`
		ModelAlias string `json:"model_alias"`
		FallbackMode string `json:"fallback_mode"`
		OrderIndex int `json:"order_index"`
	}
	if err := json.Unmarshal(data, &rows); err != nil { return nil, err }
	steps := make([]PresetStep, 0, len(rows))
	for _, row := range rows {
		steps = append(steps, PresetStep{ProviderConnectionID: row.ProviderConnectionID, ModelAlias: row.ModelAlias, FallbackMode: row.FallbackMode, OrderIndex: row.OrderIndex})
	}
	return steps, nil
}
```

**Step 5: Implement ProviderConnection**

```go
func (r *SupabaseRepository) ProviderConnection(ctx context.Context, workspaceID, providerConnectionID string) (ProviderConnection, bool, error) {
	query := "/rest/v1/provider_connections?id=eq." + url.QueryEscape(providerConnectionID) + "&workspace_id=eq." + url.QueryEscape(workspaceID) + "&select=*"
	data, err := r.do(ctx, http.MethodGet, query, nil)
	if err != nil { return ProviderConnection{}, false, err }
	var rows []ProviderConnection
	if err := json.Unmarshal(data, &rows); err != nil { return ProviderConnection{}, false, err }
	if len(rows) == 0 { return ProviderConnection{}, false, nil }
	return rows[0], true, nil
}
```

If JSON field tags are missing in `store.ProviderConnection`, add them to `store.go`.

**Step 6: Implement RecordUsage**

```go
func (r *SupabaseRepository) RecordUsage(ctx context.Context, event UsageEvent) error {
	payload := map[string]any{
		"workspace_id": event.WorkspaceID,
		"provider_connection_id": event.ProviderConnectionID,
		"api_key_id": event.APIKeyID,
		"request_id": event.RequestID,
		"model_requested": event.ModelRequested,
		"model_resolved": event.ModelResolved,
		"status": event.Status,
		"error_code": event.ErrorCode,
		"total_tokens": event.TotalTokens,
	}
	_, err := r.do(ctx, http.MethodPost, "/rest/v1/usage_events", []map[string]any{payload})
	return err
}
```

**Step 7: Run tests**

```bash
cd services/router && go test ./internal/store
cd services/router && go test ./...
```

Expected: PASS.

**Step 8: Commit**

```bash
git add services/router/internal/store/supabase.go services/router/internal/store/supabase_test.go services/router/internal/store/store.go
git commit -m "feat: add supabase routing config repository methods"
```

---

## Task 9: Wire Supabase repository into router startup

**Files:**
- Modify: `services/router/main.go`

**Step 1: Update main imports**

Import:

```go
"router/internal/store"
```

**Step 2: Select repository based on env**

In `main`:

```go
cfg := config.Load()
var repo store.Repository
if cfg.SupabaseURL != "" && cfg.SupabaseServiceKey != "" {
	repo = store.NewSupabaseRepository(cfg.SupabaseURL, cfg.SupabaseServiceKey, http.DefaultClient)
	log.Println("router using supabase repository")
} else {
	repo = store.NewMemoryRepository()
	log.Println("router using memory repository")
}
server := httpserver.NewWithOptions(httpserver.Options{Config: cfg, Repo: repo, Client: http.DefaultClient})
```

**Step 3: Run Go tests**

```bash
cd services/router && go test ./...
```

Expected: PASS.

**Step 4: Commit**

```bash
git add services/router/main.go
git commit -m "feat: use supabase repository when configured"
```

---

## Task 10: Update API contract for implemented thin-slice behavior

**Files:**
- Modify: `docs/API_CONTRACT.md`
- Modify: `docs/AUTH_FLOW.md`

**Step 1: Update provider response**

In `docs/API_CONTRACT.md`, change `POST /api/providers` response to `openai_compatible` example and include metadata, no credential.

**Step 2: Document default preset side effect**

Add note:

```md
For the thin slice, provider creation ensures a default routing preset exists and appends the provider as a `failover` step.
```

**Step 3: Update API key route behavior**

Ensure `POST /api/endpoint/keys` says raw key uses `nnr_` and is returned once.

**Step 4: Update auth flow dev fallback note**

In `docs/AUTH_FLOW.md`, mention `DEV_WORKSPACE_ID` is a local-only bridge until full Supabase Auth workspace resolution is wired.

**Step 5: Commit**

```bash
git add docs/API_CONTRACT.md docs/AUTH_FLOW.md
git commit -m "docs: update api contract for supabase thin slice"
```

---

## Task 11: Final verification

**Files:**
- No code changes expected unless fixing failures.

**Step 1: Run Go tests**

```bash
cd services/router && go test ./...
```

Expected: PASS.

**Step 2: Run web build**

```bash
npm run build:web
```

Expected: PASS.

**Step 3: Run web lint**

```bash
npm run lint:web
```

Expected: PASS.

**Step 4: Check old branding/key prefix only appears in intentional places**

```bash
rg "9router|9r_" README.md docs apps/web packages services
```

Expected: only historical/internal path references if any.

**Step 5: Check git status**

```bash
git status --short
```

Expected: clean except local `.pi/` if present.

**Step 6: Commit fixes if needed**

If any verification fixes were needed:

```bash
git add <files>
git commit -m "chore: finalize supabase persistence thin slice"
```

---

## Deferred Work

Do not implement these in this plan:

- Full Supabase Auth browser/session resolver.
- Login/signup UI.
- Dashboard provider management UI.
- API key listing/revocation UI.
- Supabase RLS policy migration.
- Streaming router support.
- Embeddings router support.
- Provider health checks.
- Request ID generation overhaul unless needed by tests.
- Failed usage event logging beyond what is already implemented.

---

## Execution Handoff

Implement in a separate worktree or parallel session using `superpowers:executing-plans`.

Recommended prompt:

```text
Use superpowers:executing-plans to implement this plan task-by-task:

docs/plans/2026-05-01-supabase-persistence-thin-slice-implementation.md

Follow the plan exactly, use TDD where specified, make the commits described in each task, and stop for review if any task fails or requires product/design clarification.
```
