# NusaNexus Router OpenAI-Compatible Provider Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rebrand product-facing references to NusaNexus Router and implement the first vertical slice: a generic OpenAI-compatible API-key provider with non-streaming chat completion forwarding.

**Architecture:** Keep the MVP small and vertical. The web/control plane stores provider metadata and encrypted API keys in Supabase/Postgres, while the Go router validates NusaNexus API keys, resolves the default preset, decrypts provider credentials, forwards non-streaming `/v1/chat/completions`, and writes basic usage logs. Start with testable local abstractions and mock OpenAI-compatible servers before wiring real deployment details.

**Tech Stack:** Next.js 16 / React 19 for web, Go 1.22 router service, PostgreSQL/Supabase schema, npm workspaces, Go `net/http`, Go table-driven tests.

---

## Current Repository Context

Important existing files:

- Root README: `README.md`
- Docs index: `docs/README.md`
- Design doc: `docs/plans/2026-05-01-nusanexus-router-openai-compatible-design.md`
- Web app: `apps/web/app/page.jsx`, `apps/web/app/layout.jsx`, `apps/web/package.json`
- Shared provider registry: `packages/shared/providers.js`, `packages/shared/provider-types.js`
- Router entrypoint: `services/router/main.go`
- Router server: `services/router/internal/httpserver/server.go`
- Router tests: `services/router/internal/httpserver/server_test.go`
- Router engine: `services/router/internal/engine/*.go`
- Existing schema: `docs/schema.sql`, `docs/DB_SCHEMA.md`

Current important gaps:

- Product-facing docs and UI still use old product name.
- `/v1/chat/completions` returns `501 Not Implemented`.
- Provider adapters are stubbed.
- `provider_connections` schema lacks `provider_family`, `capabilities`, and `metadata` columns required by the approved design.
- No API-key hashing/validation implementation exists yet.
- No provider credential encryption implementation exists yet.

---

## Task 1: Rebrand product-facing documentation and landing copy

**Files:**
- Modify: `README.md`
- Modify: `docs/README.md`
- Modify: `docs/PRODUCT_OVERVIEW.md`
- Modify: `docs/MVP_SPEC.md`
- Modify: `docs/FINAL_ARCHITECTURE.md`
- Modify: `docs/API_CONTRACT.md`
- Modify: `docs/ENV_CONFIG.md`
- Modify: `docs/BUILD_ORDER.md`
- Modify: `docs/BACKLOG.md`
- Modify: `apps/web/app/page.jsx`

**Step 1: Find product-facing old-name references**

Run:

```bash
rg "9router|9r_" README.md docs apps/web packages services
```

Expected: references appear in docs and landing page.

**Step 2: Replace product-facing old name with NusaNexus Router**

Rules:

- Replace product name references with `NusaNexus Router`.
- Replace short endpoint/API-key examples that use old branding with neutral or NusaNexus examples.
- Do not rename directories or module names in this task.
- Do not change generated commit history.
- Keep file paths stable.

Example replacements:

```md
# NusaNexus Router Cloud Impl
```

```jsx
export default function HomePage() {
  return (
    <main style={{ fontFamily: 'sans-serif', padding: 32 }}>
      <h1>NusaNexus Router</h1>
      <p>Hosted AI router untuk coding tools, zero-setup.</p>
    </main>
  );
}
```

**Step 3: Verify no obvious product-facing old-name references remain**

Run:

```bash
rg "9router|9r_" README.md docs apps/web packages services
```

Expected: either no matches, or only explicitly archived/internal references with a clear reason. If matches remain, review and update them.

**Step 4: Run web build/lint smoke check if dependencies are installed**

Run:

```bash
npm run build:web
```

Expected: PASS. If dependencies are missing, run `npm install` first or document the blocker.

**Step 5: Commit**

```bash
git add README.md docs apps/web/app/page.jsx
git commit -m "docs: rebrand product to NusaNexus Router"
```

---

## Task 2: Align database schema and docs for generic OpenAI-compatible providers

**Files:**
- Modify: `docs/schema.sql`
- Modify: `docs/DB_SCHEMA.md`
- Modify: `docs/API_CONTRACT.md`
- Modify: `docs/ENV_CONFIG.md`

**Step 1: Update schema docs first**

In `docs/DB_SCHEMA.md`, update `provider_connections` columns to include:

```text
provider_family text
capabilities jsonb
metadata jsonb
```

Document:

```json
{
  "base_url": "https://api.example.com",
  "default_model": "gpt-4o-mini"
}
```

and explain that `credential_encrypted` stores the encrypted provider API key payload.

**Step 2: Update SQL schema**

Modify `docs/schema.sql` table `provider_connections` to include:

```sql
  provider_family text not null default 'openai_compatible',
  capabilities jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
```

Place these after `auth_method text not null,` and before `credential_encrypted text not null,`.

**Step 3: Add provider metadata validation notes to API contract**

In `docs/API_CONTRACT.md`, update `POST /api/providers` request body to include:

```json
{
  "provider_type": "openai_compatible",
  "display_name": "My Provider",
  "auth_method": "api_key",
  "base_url": "https://api.example.com",
  "api_key": "sk-xxxxxxxxxxxx",
  "default_model": "gpt-4o-mini"
}
```

Document that the API key is encrypted and never returned.

**Step 4: Add provider env note**

In `docs/ENV_CONFIG.md`, state that generic OpenAI-compatible provider API keys are stored encrypted in DB, not in env vars.

**Step 5: Verify SQL parses enough for obvious syntax errors**

Run if `psql` and `DATABASE_URL` are available:

```bash
psql "$DATABASE_URL" -f docs/schema.sql
```

Expected: migration applies successfully.

If no database is available, run:

```bash
rg "provider_family|capabilities|metadata" docs/schema.sql docs/DB_SCHEMA.md docs/API_CONTRACT.md
```

Expected: all three names appear in schema and docs.

**Step 6: Commit**

```bash
git add docs/schema.sql docs/DB_SCHEMA.md docs/API_CONTRACT.md docs/ENV_CONFIG.md
git commit -m "docs: align provider schema for openai compatible connections"
```

---

## Task 3: Add shared provider registry constants for OpenAI-compatible provider

**Files:**
- Modify: `packages/shared/providers.js`
- Modify: `packages/shared/provider-types.js`
- Test manually with Node import if possible

**Step 1: Add provider family/status constants**

In `packages/shared/provider-types.js`, add:

```js
export const ProviderTypes = {
  OPENAI_COMPATIBLE: 'openai_compatible'
};

export const AuthMethods = {
  API_KEY: 'api_key'
};
```

Keep existing exports.

**Step 2: Add OpenAI-compatible registry entry**

In `packages/shared/providers.js`, add provider family:

```js
OPENAI_COMPATIBLE: 'openai_compatible'
```

Add capability if missing:

```js
CHAT_COMPLETIONS: 'chat_completions'
```

Add registry entry:

```js
openai_compatible: {
  slug: 'openai_compatible',
  displayName: 'OpenAI-Compatible API',
  family: ProviderFamilies.OPENAI_COMPATIBLE,
  authMethod: 'api_key',
  capabilities: [
    ProviderCapabilities.CHAT_COMPLETIONS,
    ProviderCapabilities.MODEL_SELECTION,
    ProviderCapabilities.FALLBACK
  ]
}
```

**Step 3: Verify shared package imports**

Run:

```bash
node -e "import('./packages/shared/providers.js').then(m => console.log(m.getProviderConfig('openai_compatible')))"
```

Expected: logs provider config with slug `openai_compatible`.

**Step 4: Commit**

```bash
git add packages/shared/providers.js packages/shared/provider-types.js
git commit -m "feat: add openai compatible provider registry entry"
```

---

## Task 4: Add Go contracts for chat completions and router errors

**Files:**
- Modify: `services/router/internal/contracts/openai.go`
- Create: `services/router/internal/contracts/errors.go`
- Test: `services/router/internal/contracts` via `go test ./...`

**Step 1: Inspect existing contract file**

Run:

```bash
sed -n '1,220p' services/router/internal/contracts/openai.go
```

Use `read` if working inside pi.

**Step 2: Add minimal chat completion request struct**

In `services/router/internal/contracts/openai.go`, define or extend:

```go
type ChatCompletionRequest struct {
	Model    string `json:"model"`
	Messages []struct {
		Role    string `json:"role"`
		Content string `json:"content"`
	} `json:"messages"`
	Stream bool `json:"stream,omitempty"`
}
```

If preserving arbitrary provider fields is required, use raw JSON map handling in router task instead of relying only on this struct.

**Step 3: Add error code constants**

Create `services/router/internal/contracts/errors.go`:

```go
package contracts

const (
	ErrorInvalidAPIKey              = "invalid_api_key"
	ErrorWorkspaceNotFound          = "workspace_not_found"
	ErrorPresetNotFound             = "preset_not_found"
	ErrorProviderNotFound           = "provider_not_found"
	ErrorProviderCredentialMissing  = "provider_credential_missing"
	ErrorProviderRequestFailed      = "provider_request_failed"
	ErrorProviderTimeout            = "provider_timeout"
	ErrorFallbackExhausted          = "fallback_exhausted"
	ErrorUnsupportedStreaming       = "unsupported_streaming"
	ErrorInvalidRequest             = "invalid_request"
)
```

**Step 4: Run tests**

```bash
cd services/router && go test ./...
```

Expected: PASS.

**Step 5: Commit**

```bash
git add services/router/internal/contracts/openai.go services/router/internal/contracts/errors.go
git commit -m "feat: add router chat contracts and error codes"
```

---

## Task 5: Add router configuration and environment handling

**Files:**
- Create: `services/router/internal/config/config.go`
- Modify: `services/router/main.go`
- Test: `services/router/internal/config/config_test.go`

**Step 1: Write failing tests for defaults**

Create `services/router/internal/config/config_test.go`:

```go
package config

import "testing"

func TestLoadDefaults(t *testing.T) {
	t.Setenv("ROUTER_PORT", "")
	t.Setenv("REQUEST_TIMEOUT_MS", "")
	t.Setenv("MAX_FALLBACK_HOPS", "")

	cfg := Load()
	if cfg.Port != "8080" {
		t.Fatalf("expected default port 8080, got %q", cfg.Port)
	}
	if cfg.RequestTimeoutMS != 30000 {
		t.Fatalf("expected default timeout 30000, got %d", cfg.RequestTimeoutMS)
	}
	if cfg.MaxFallbackHops != 3 {
		t.Fatalf("expected default fallback hops 3, got %d", cfg.MaxFallbackHops)
	}
}
```

**Step 2: Run test and verify failure**

```bash
cd services/router && go test ./internal/config
```

Expected: FAIL because package does not exist.

**Step 3: Implement config loader**

Create `services/router/internal/config/config.go`:

```go
package config

import (
	"os"
	"strconv"
)

type Config struct {
	Port             string
	RequestTimeoutMS int
	MaxFallbackHops  int
	SupabaseURL      string
	SupabaseServiceKey string
	EncryptionKey    string
}

func Load() Config {
	return Config{
		Port:               getString("ROUTER_PORT", "8080"),
		RequestTimeoutMS:   getInt("REQUEST_TIMEOUT_MS", 30000),
		MaxFallbackHops:    getInt("MAX_FALLBACK_HOPS", 3),
		SupabaseURL:        os.Getenv("SUPABASE_URL"),
		SupabaseServiceKey: os.Getenv("SUPABASE_SERVICE_ROLE_KEY"),
		EncryptionKey:      os.Getenv("ENCRYPTION_KEY"),
	}
}

func getString(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func getInt(key string, fallback int) int {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return fallback
	}
	return parsed
}
```

**Step 4: Update main to use configured port**

In `services/router/main.go`, replace hardcoded `:8080` with config:

```go
cfg := config.Load()
addr := ":" + cfg.Port
log.Printf("router listening on %s", addr)
if err := http.ListenAndServe(addr, server.Handler()); err != nil {
	log.Fatal(err)
}
```

**Step 5: Run tests**

```bash
cd services/router && go test ./...
```

Expected: PASS.

**Step 6: Commit**

```bash
git add services/router/internal/config services/router/main.go
git commit -m "feat: add router configuration loader"
```

---

## Task 6: Add API key hashing utilities

**Files:**
- Create: `services/router/internal/security/apikey.go`
- Test: `services/router/internal/security/apikey_test.go`

**Step 1: Write failing tests**

Create `services/router/internal/security/apikey_test.go`:

```go
package security

import "testing"

func TestHashAndVerifyAPIKey(t *testing.T) {
	key := "nnr_test_123456"
	hash := HashAPIKey(key)
	if hash == "" || hash == key {
		t.Fatalf("expected non-empty hash different from key")
	}
	if !VerifyAPIKey(key, hash) {
		t.Fatalf("expected key to verify")
	}
	if VerifyAPIKey("wrong", hash) {
		t.Fatalf("expected wrong key to fail")
	}
}

func TestAPIKeyPrefix(t *testing.T) {
	prefix := APIKeyPrefix("nnr_abcdef123456")
	if prefix != "nnr_abcdef" {
		t.Fatalf("unexpected prefix %q", prefix)
	}
}
```

**Step 2: Run test and verify failure**

```bash
cd services/router && go test ./internal/security
```

Expected: FAIL because package does not exist.

**Step 3: Implement utility**

Create `services/router/internal/security/apikey.go`:

```go
package security

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
)

func HashAPIKey(key string) string {
	sum := sha256.Sum256([]byte(key))
	return hex.EncodeToString(sum[:])
}

func VerifyAPIKey(key, expectedHash string) bool {
	actual := HashAPIKey(key)
	return subtle.ConstantTimeCompare([]byte(actual), []byte(expectedHash)) == 1
}

func APIKeyPrefix(key string) string {
	if len(key) <= 10 {
		return key
	}
	return key[:10]
}
```

**Step 4: Run tests**

```bash
cd services/router && go test ./...
```

Expected: PASS.

**Step 5: Commit**

```bash
git add services/router/internal/security
git commit -m "feat: add api key hashing utilities"
```

---

## Task 7: Add credential encryption utilities

**Files:**
- Create: `services/router/internal/security/credentials.go`
- Test: `services/router/internal/security/credentials_test.go`

**Step 1: Write failing tests**

Create `services/router/internal/security/credentials_test.go`:

```go
package security

import "testing"

func TestEncryptDecryptCredential(t *testing.T) {
	keyHex := "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
	plaintext := []byte(`{"api_key":"sk-test"}`)

	ciphertext, err := EncryptCredential(keyHex, plaintext)
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}
	if ciphertext == string(plaintext) || ciphertext == "" {
		t.Fatalf("ciphertext should not equal plaintext")
	}

	decrypted, err := DecryptCredential(keyHex, ciphertext)
	if err != nil {
		t.Fatalf("decrypt: %v", err)
	}
	if string(decrypted) != string(plaintext) {
		t.Fatalf("expected %s, got %s", plaintext, decrypted)
	}
}

func TestEncryptCredentialRejectsInvalidKey(t *testing.T) {
	_, err := EncryptCredential("bad", []byte("secret"))
	if err == nil {
		t.Fatalf("expected invalid key error")
	}
}
```

**Step 2: Run test and verify failure**

```bash
cd services/router && go test ./internal/security
```

Expected: FAIL because functions do not exist.

**Step 3: Implement AES-256-GCM encryption**

Create `services/router/internal/security/credentials.go`:

```go
package security

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"io"
)

func EncryptCredential(keyHex string, plaintext []byte) (string, error) {
	key, err := decodeKey(keyHex)
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	sealed := gcm.Seal(nonce, nonce, plaintext, nil)
	return base64.StdEncoding.EncodeToString(sealed), nil
}

func DecryptCredential(keyHex, encoded string) ([]byte, error) {
	key, err := decodeKey(keyHex)
	if err != nil {
		return nil, err
	}
	data, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	if len(data) < gcm.NonceSize() {
		return nil, errors.New("ciphertext too short")
	}
	nonce := data[:gcm.NonceSize()]
	ciphertext := data[gcm.NonceSize():]
	return gcm.Open(nil, nonce, ciphertext, nil)
}

func decodeKey(keyHex string) ([]byte, error) {
	key, err := hex.DecodeString(keyHex)
	if err != nil {
		return nil, err
	}
	if len(key) != 32 {
		return nil, errors.New("encryption key must be 32 bytes")
	}
	return key, nil
}
```

**Step 4: Run tests**

```bash
cd services/router && go test ./...
```

Expected: PASS.

**Step 5: Commit**

```bash
git add services/router/internal/security/credentials.go services/router/internal/security/credentials_test.go
git commit -m "feat: add credential encryption utilities"
```

---

## Task 8: Introduce router repository interfaces and in-memory test repository

**Files:**
- Create: `services/router/internal/store/store.go`
- Create: `services/router/internal/store/memory.go`
- Test: `services/router/internal/store/memory_test.go`

**Step 1: Write repository model interfaces**

Create `services/router/internal/store/store.go`:

```go
package store

import "context"

type APIKeyRecord struct {
	ID          string
	WorkspaceID string
	KeyHash     string
	Revoked     bool
}

type ProviderConnection struct {
	ID                  string
	WorkspaceID         string
	ProviderType        string
	DisplayName         string
	AuthMethod          string
	ProviderFamily      string
	CredentialEncrypted string
	Metadata            map[string]any
	Status              string
}

type PresetStep struct {
	ProviderConnectionID string
	ProviderType         string
	ModelAlias           string
	FallbackMode         string
	OrderIndex           int
}

type UsageEvent struct {
	WorkspaceID          string
	ProviderConnectionID string
	APIKeyID             string
	RequestID            string
	ModelRequested       string
	ModelResolved        string
	Status               string
	ErrorCode            string
	TotalTokens          int
}

type Repository interface {
	FindAPIKeyByHash(ctx context.Context, hash string) (APIKeyRecord, bool, error)
	DefaultPresetSteps(ctx context.Context, workspaceID string) ([]PresetStep, error)
	ProviderConnection(ctx context.Context, workspaceID, providerConnectionID string) (ProviderConnection, bool, error)
	RecordUsage(ctx context.Context, event UsageEvent) error
}
```

**Step 2: Write failing memory repository test**

Create `services/router/internal/store/memory_test.go`:

```go
package store

import (
	"context"
	"testing"
)

func TestMemoryRepositoryFindAPIKey(t *testing.T) {
	repo := NewMemoryRepository()
	repo.APIKeys = []APIKeyRecord{{ID: "key_1", WorkspaceID: "ws_1", KeyHash: "hash"}}

	record, ok, err := repo.FindAPIKeyByHash(context.Background(), "hash")
	if err != nil || !ok {
		t.Fatalf("expected key, ok=%v err=%v", ok, err)
	}
	if record.WorkspaceID != "ws_1" {
		t.Fatalf("unexpected workspace %q", record.WorkspaceID)
	}
}

func TestMemoryRepositoryRecordsUsage(t *testing.T) {
	repo := NewMemoryRepository()
	err := repo.RecordUsage(context.Background(), UsageEvent{WorkspaceID: "ws_1", Status: "success"})
	if err != nil {
		t.Fatalf("record usage: %v", err)
	}
	if len(repo.UsageEvents) != 1 {
		t.Fatalf("expected one usage event")
	}
}
```

**Step 3: Run test and verify failure**

```bash
cd services/router && go test ./internal/store
```

Expected: FAIL because `NewMemoryRepository` is missing.

**Step 4: Implement memory repository**

Create `services/router/internal/store/memory.go`:

```go
package store

import "context"

type MemoryRepository struct {
	APIKeys     []APIKeyRecord
	Steps       []PresetStep
	Providers   []ProviderConnection
	UsageEvents []UsageEvent
}

func NewMemoryRepository() *MemoryRepository {
	return &MemoryRepository{}
}

func (m *MemoryRepository) FindAPIKeyByHash(ctx context.Context, hash string) (APIKeyRecord, bool, error) {
	for _, key := range m.APIKeys {
		if key.KeyHash == hash && !key.Revoked {
			return key, true, nil
		}
	}
	return APIKeyRecord{}, false, nil
}

func (m *MemoryRepository) DefaultPresetSteps(ctx context.Context, workspaceID string) ([]PresetStep, error) {
	var result []PresetStep
	for _, step := range m.Steps {
		result = append(result, step)
	}
	return result, nil
}

func (m *MemoryRepository) ProviderConnection(ctx context.Context, workspaceID, providerConnectionID string) (ProviderConnection, bool, error) {
	for _, provider := range m.Providers {
		if provider.WorkspaceID == workspaceID && provider.ID == providerConnectionID {
			return provider, true, nil
		}
	}
	return ProviderConnection{}, false, nil
}

func (m *MemoryRepository) RecordUsage(ctx context.Context, event UsageEvent) error {
	m.UsageEvents = append(m.UsageEvents, event)
	return nil
}
```

**Step 5: Run tests**

```bash
cd services/router && go test ./...
```

Expected: PASS.

**Step 6: Commit**

```bash
git add services/router/internal/store
git commit -m "feat: add router repository interfaces"
```

---

## Task 9: Implement OpenAI-compatible provider adapter

**Files:**
- Create: `services/router/internal/engine/adapters/openai_compatible.go`
- Test: `services/router/internal/engine/adapters/openai_compatible_test.go`

**Step 1: Write failing adapter test with mock server**

Create `services/router/internal/engine/adapters/openai_compatible_test.go`:

```go
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
```

**Step 2: Run test and verify failure**

```bash
cd services/router && go test ./internal/engine/adapters
```

Expected: FAIL because adapter is missing.

**Step 3: Implement adapter**

Create `services/router/internal/engine/adapters/openai_compatible.go`:

```go
package adapters

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"strings"

	"router/internal/engine"
)

type OpenAICompatibleAdapter struct {
	baseURL string
	apiKey  string
	client  *http.Client
}

func NewOpenAICompatibleAdapter(baseURL, apiKey string, client *http.Client) *OpenAICompatibleAdapter {
	if client == nil {
		client = http.DefaultClient
	}
	return &OpenAICompatibleAdapter{
		baseURL: strings.TrimRight(baseURL, "/"),
		apiKey:  apiKey,
		client:  client,
	}
}

func (a *OpenAICompatibleAdapter) Type() string { return "openai_compatible" }

func (a *OpenAICompatibleAdapter) Capabilities() []string {
	return []string{"chat_completions", "model_selection", "fallback"}
}

func (a *OpenAICompatibleAdapter) SupportsModel(model string) bool { return true }

func (a *OpenAICompatibleAdapter) Send(ctx context.Context, req engine.ProviderRequest) (engine.ProviderResponse, error) {
	url := a.baseURL + "/v1/chat/completions"
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(req.Payload))
	if err != nil {
		return engine.ProviderResponse{}, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+a.apiKey)

	resp, err := a.client.Do(httpReq)
	if err != nil {
		return engine.ProviderResponse{}, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return engine.ProviderResponse{}, err
	}

	return engine.ProviderResponse{
		ProviderType: a.Type(),
		Body:         body,
		StatusCode:   resp.StatusCode,
	}, nil
}
```

**Step 4: Run tests**

```bash
cd services/router && go test ./...
```

Expected: PASS.

**Step 5: Commit**

```bash
git add services/router/internal/engine/adapters/openai_compatible.go services/router/internal/engine/adapters/openai_compatible_test.go
git commit -m "feat: add openai compatible provider adapter"
```

---

## Task 10: Refactor HTTP server to accept dependencies

**Files:**
- Modify: `services/router/internal/httpserver/server.go`
- Modify: `services/router/main.go`
- Test: `services/router/internal/httpserver/server_test.go`

**Step 1: Add server options test**

In `server_test.go`, add a test that `New` still works with defaults:

```go
func TestNewWithDefaults(t *testing.T) {
	s := New()
	if s.Handler() == nil {
		t.Fatalf("expected handler")
	}
}
```

**Step 2: Update server struct dependencies**

Add fields to `Server`:

```go
repo store.Repository
cfg config.Config
client *http.Client
```

Add an `Options` type:

```go
type Options struct {
	Repo   store.Repository
	Config config.Config
	Client *http.Client
}
```

Add constructor:

```go
func NewWithOptions(opts Options) *Server
```

Keep `New()` as a wrapper for tests/dev defaults.

**Step 3: Use memory repo in default constructor**

`New()` should call `NewWithOptions(Options{Repo: store.NewMemoryRepository(), Config: config.Load(), Client: http.DefaultClient})`.

**Step 4: Update `main.go`**

Use:

```go
cfg := config.Load()
server := httpserver.NewWithOptions(httpserver.Options{Config: cfg})
```

If `Repo` is nil, the server can use memory repo for now. Later Supabase repository can be added without changing handlers.

**Step 5: Run tests**

```bash
cd services/router && go test ./...
```

Expected: PASS.

**Step 6: Commit**

```bash
git add services/router/internal/httpserver/server.go services/router/internal/httpserver/server_test.go services/router/main.go
git commit -m "refactor: inject router server dependencies"
```

---

## Task 11: Implement streaming rejection and request validation

**Files:**
- Modify: `services/router/internal/httpserver/server.go`
- Test: `services/router/internal/httpserver/server_test.go`

**Step 1: Write failing test for `stream: true`**

Add to `server_test.go`:

```go
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
```

Add imports `strings` if needed.

**Step 2: Run test and verify failure**

```bash
cd services/router && go test ./internal/httpserver
```

Expected: FAIL because endpoint currently returns 501.

**Step 3: Implement JSON decode and streaming check**

In `handleChatCompletions`:

- only allow `POST`
- read request body
- decode minimal JSON into struct with `Stream bool`
- if stream true, return `400` error response with `unsupported_streaming`
- preserve raw body bytes for later forwarding

Helper:

```go
func writeError(w http.ResponseWriter, status int, code, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(contracts.ErrorResponse{Error: contracts.ErrorPayload{Code: code, Message: message}})
}
```

**Step 4: Run tests**

```bash
cd services/router && go test ./...
```

Expected: PASS.

**Step 5: Commit**

```bash
git add services/router/internal/httpserver/server.go services/router/internal/httpserver/server_test.go
git commit -m "feat: reject unsupported streaming requests"
```

---

## Task 12: Implement API key auth and preset/provider resolution in handler

**Files:**
- Modify: `services/router/internal/httpserver/server.go`
- Test: `services/router/internal/httpserver/server_test.go`

**Step 1: Write failing invalid API key test**

Add:

```go
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
```

**Step 2: Write failing no preset test**

Create a repo with a valid API key but no preset steps. Expected `404 preset_not_found`.

**Step 3: Run tests and verify failure**

```bash
cd services/router && go test ./internal/httpserver
```

Expected: FAIL.

**Step 4: Implement auth and resolution**

Handler logic:

```go
rawKey := bearerToken(r.Header.Get("Authorization"))
if rawKey == "" { write invalid_api_key }
hash := security.HashAPIKey(rawKey)
apiKey, ok, err := s.repo.FindAPIKeyByHash(r.Context(), hash)
if err != nil or !ok { write invalid_api_key }
steps, err := s.repo.DefaultPresetSteps(r.Context(), apiKey.WorkspaceID)
if err != nil or len(steps)==0 { write preset_not_found }
```

Add helper:

```go
func bearerToken(header string) string {
	const prefix = "Bearer "
	if !strings.HasPrefix(header, prefix) { return "" }
	return strings.TrimSpace(strings.TrimPrefix(header, prefix))
}
```

**Step 5: Run tests**

```bash
cd services/router && go test ./...
```

Expected: PASS.

**Step 6: Commit**

```bash
git add services/router/internal/httpserver/server.go services/router/internal/httpserver/server_test.go
git commit -m "feat: validate router api keys and presets"
```

---

## Task 13: Implement model auto-mapping and OpenAI-compatible forwarding

**Files:**
- Modify: `services/router/internal/httpserver/server.go`
- Test: `services/router/internal/httpserver/server_test.go`

**Step 1: Write failing forwarding test**

Add a test that:

- creates mock upstream server
- creates encrypted provider credential with `api_key`
- inserts valid API key hash into memory repo
- inserts one preset step
- inserts provider metadata with `base_url` and `default_model`
- sends request with `model: auto`
- asserts upstream receives `model: gpt-test-default`
- asserts router returns upstream response

Test skeleton:

```go
func TestChatCompletionsForwardsToOpenAICompatibleProvider(t *testing.T) {
	// setup mock upstream and capture model/auth
	// setup repo with API key, step, provider
	// call handler
	// assert 200, upstream auth, model mapping, response body
}
```

Use encryption key:

```go
keyHex := "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
```

Provider credential plaintext:

```json
{"api_key":"sk-upstream"}
```

**Step 2: Run test and verify failure**

```bash
cd services/router && go test ./internal/httpserver
```

Expected: FAIL because forwarding is not implemented.

**Step 3: Implement provider loading and credential decrypt**

For the first step:

```go
provider, ok, err := s.repo.ProviderConnection(ctx, apiKey.WorkspaceID, step.ProviderConnectionID)
```

Validate:

- provider exists
- provider type is `openai_compatible`
- metadata has string `base_url`
- metadata has string `default_model`
- decrypted credential JSON has `api_key`

**Step 4: Implement model mapping**

Decode body into `map[string]any`.

If `model` is empty or `auto`, set:

```go
body["model"] = defaultModel
```

Marshal body back to JSON for forwarding.

**Step 5: Forward with adapter**

Create adapter:

```go
adapter := adapters.NewOpenAICompatibleAdapter(baseURL, providerAPIKey, s.client)
resp, err := adapter.Send(ctx, engine.ProviderRequest{...})
```

Return upstream status and body. Preserve `Content-Type: application/json`.

**Step 6: Record success usage**

After a 2xx response, call `RecordUsage` with:

- workspace ID
- provider connection ID
- API key ID
- request ID
- model requested
- model resolved
- status `success`

**Step 7: Run tests**

```bash
cd services/router && go test ./...
```

Expected: PASS.

**Step 8: Commit**

```bash
git add services/router/internal/httpserver/server.go services/router/internal/httpserver/server_test.go
git commit -m "feat: forward chat completions to openai compatible provider"
```

---

## Task 14: Add minimal fallback behavior

**Files:**
- Modify: `services/router/internal/httpserver/server.go`
- Test: `services/router/internal/httpserver/server_test.go`

**Step 1: Write failing fallback test**

Test setup:

- provider A upstream returns `429`
- provider B upstream returns `200`
- preset has two steps in order
- request succeeds with provider B
- usage event status is `fallback`

Expected response: `200` with provider B response.

**Step 2: Define retryable status helper**

Add:

```go
func retryableStatus(status int) bool {
	switch status {
	case 429, 500, 502, 503, 504:
		return true
	default:
		return false
	}
}
```

**Step 3: Implement step loop**

Loop through preset steps up to `MaxFallbackHops + 1` attempts.

For each step:

- load provider
- decrypt credential
- forward request
- if 2xx return success/fallback
- if retryable, continue
- if not retryable, return provider error

If all retryable attempts fail, return `502 fallback_exhausted`.

**Step 4: Run tests**

```bash
cd services/router && go test ./...
```

Expected: PASS.

**Step 5: Commit**

```bash
git add services/router/internal/httpserver/server.go services/router/internal/httpserver/server_test.go
git commit -m "feat: add minimal provider fallback"
```

---

## Task 15: Add control-plane route skeletons for provider creation docs-aligned behavior

**Files:**
- Create: `apps/web/app/api/providers/route.js`
- Create: `apps/web/lib/provider-validation.js`
- Test manually with Node if no test framework exists

**Step 1: Add provider validation helper**

Create `apps/web/lib/provider-validation.js`:

```js
export function normalizeProviderInput(input) {
  const provider_type = input?.provider_type || 'openai_compatible';
  const auth_method = input?.auth_method || 'api_key';
  const display_name = String(input?.display_name || '').trim();
  const base_url = String(input?.base_url || '').trim().replace(/\/+$/, '');
  const api_key = String(input?.api_key || '').trim();
  const default_model = String(input?.default_model || '').trim();

  if (provider_type !== 'openai_compatible') throw new Error('unsupported provider_type');
  if (auth_method !== 'api_key') throw new Error('unsupported auth_method');
  if (!display_name) throw new Error('display_name is required');
  if (!base_url || !/^https?:\/\//.test(base_url)) throw new Error('valid base_url is required');
  if (!api_key) throw new Error('api_key is required');
  if (!default_model) throw new Error('default_model is required');

  return { provider_type, auth_method, display_name, base_url, api_key, default_model };
}
```

**Step 2: Add API route skeleton**

Create `apps/web/app/api/providers/route.js`:

```js
import { NextResponse } from 'next/server';
import { normalizeProviderInput } from '../../../lib/provider-validation.js';

export async function POST(request) {
  try {
    const body = await request.json();
    const input = normalizeProviderInput(body);

    // TODO: wire Supabase auth, workspace resolution, encryption, and insert.
    return NextResponse.json({
      provider_type: input.provider_type,
      display_name: input.display_name,
      auth_method: input.auth_method,
      status: 'pending_persistence'
    }, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: { code: 'validation_error', message: error.message } }, { status: 400 });
  }
}
```

**Step 3: Build web app**

```bash
npm run build:web
```

Expected: PASS.

**Step 4: Commit**

```bash
git add apps/web/app/api/providers/route.js apps/web/lib/provider-validation.js
git commit -m "feat: add provider creation validation skeleton"
```

---

## Task 16: Add README quickstart updates and final verification

**Files:**
- Modify: `README.md`
- Modify: `docs/SETUP.md`
- Modify: `docs/BUILD_ORDER.md`

**Step 1: Update quickstart with current verification commands**

Add commands:

```bash
npm install
npm run build:web
cd services/router && go test ./...
cd ../..
npm run dev:router
curl http://localhost:8080/health
```

Document that full DB-backed operation requires Supabase wiring, while router unit tests use in-memory repository.

**Step 2: Run full available verification**

Run:

```bash
npm run build:web
cd services/router && go test ./...
```

Expected: both PASS.

If `npm run build:web` fails because dependencies are missing, run:

```bash
npm install
npm run build:web
```

**Step 3: Check git status**

```bash
git status --short
```

Expected: only intentional files changed.

**Step 4: Commit**

```bash
git add README.md docs/SETUP.md docs/BUILD_ORDER.md
git commit -m "docs: update nusanexus router quickstart"
```

---

## Task 17: Post-plan review checklist

**Files:**
- No new files unless fixes are required

**Step 1: Search for old branding**

```bash
rg "9router|9r_" README.md docs apps/web packages services
```

Expected: no unintended product-facing references remain.

**Step 2: Run Go tests**

```bash
cd services/router && go test ./...
```

Expected: PASS.

**Step 3: Run web build**

```bash
npm run build:web
```

Expected: PASS.

**Step 4: Review docs/design consistency**

Read:

- `docs/plans/2026-05-01-nusanexus-router-openai-compatible-design.md`
- `docs/API_CONTRACT.md`
- `docs/DB_SCHEMA.md`
- `docs/schema.sql`

Verify they all describe:

- `openai_compatible`
- base URL
- default model
- encrypted API key
- non-streaming chat completions first

**Step 5: Commit any final fixes**

```bash
git add <changed-files>
git commit -m "chore: finalize nusanexus router openai compatible slice"
```

---

## Deferred Work

Do not implement these in this plan:

- Streaming SSE proxying.
- Embeddings.
- OAuth providers.
- Supabase production repository implementation, unless explicitly prioritized next.
- Full dashboard forms beyond the validation skeleton.
- Provider preset registry.
- Billing or teams.
- Broad filesystem/package renames.

---

## Execution Notes

- Use TDD for router behavior.
- Keep commits small and frequent.
- Prefer mock HTTP servers for provider forwarding tests.
- Do not log provider API keys.
- Treat raw NusaNexus API keys and provider API keys as secrets.
- Preserve arbitrary OpenAI-compatible request fields when forwarding by using `map[string]any` or raw JSON patching instead of overly strict structs.
- Return `unsupported_streaming` for `stream: true` until streaming is intentionally implemented.
