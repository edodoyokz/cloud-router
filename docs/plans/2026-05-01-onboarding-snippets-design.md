# NusaNexus Router — Onboarding Snippets Design

Date: 2026-05-01
Status: Approved

## Context

NusaNexus Router already exposes an OpenAI-compatible `/v1/chat/completions` endpoint and a dashboard that can generate router API keys.

Current dashboard endpoint configuration is minimal:

- environment variables snippet
- cURL test request

The next onboarding improvement is to show richer copy/paste snippets for common coding tools:

- Claude Code
- Codex
- OpenClaw
- Cursor

## Goals

- Add reusable snippet builders for target tools.
- Render richer snippets in the dashboard endpoint config section.
- Use the raw router API key immediately after generation when available.
- Use a safe placeholder when the raw key is unavailable.
- Keep snippets OpenAI-compatible and model `auto` oriented.
- Update setup/backlog/docs.

## Non-Goals

- New API routes.
- New database tables.
- Persisted onboarding checklist state.
- Full onboarding wizard.
- Provider/tool auto-detection.
- Exact support guarantees for every third-party tool version.
- Streaming snippets.
- Embeddings snippets.

## Existing Helper

Current file:

```text
apps/web/lib/endpoint-snippets.js
```

Current exports:

```js
normalizeRouterBaseUrl(value)
buildEnvSnippet({ routerBaseUrl, apiKey })
buildCurlSnippet({ routerBaseUrl, apiKey })
```

## New Helper Shape

Add constants/helpers:

```js
const API_KEY_PLACEHOLDER = '<generate-an-api-key-first>';

function snippetContext({ routerBaseUrl, apiKey }) {
  const router = normalizeRouterBaseUrl(routerBaseUrl);
  return {
    routerBaseUrl: router,
    openaiBaseUrl: `${router}/v1`,
    apiKey: apiKey || API_KEY_PLACEHOLDER,
    model: 'auto'
  };
}
```

Add exports:

```js
buildClaudeCodeSnippet({ routerBaseUrl, apiKey })
buildCodexSnippet({ routerBaseUrl, apiKey })
buildOpenClawSnippet({ routerBaseUrl, apiKey })
buildCursorSnippet({ routerBaseUrl, apiKey })
buildOnboardingSnippets({ routerBaseUrl, apiKey })
```

`buildOnboardingSnippets()` returns an ordered array:

```js
[
  { id: 'env', label: 'Generic env', description: '...', language: 'bash', content: '...' },
  { id: 'curl', label: 'cURL test', description: '...', language: 'bash', content: '...' },
  { id: 'claude-code', label: 'Claude Code', description: '...', language: 'bash', content: '...' },
  { id: 'codex', label: 'Codex', description: '...', language: 'bash', content: '...' },
  { id: 'openclaw', label: 'OpenClaw', description: '...', language: 'bash', content: '...' },
  { id: 'cursor', label: 'Cursor', description: '...', language: 'json', content: '...' }
]
```

## Snippet Content

### Generic env

```bash
export OPENAI_API_KEY="nnr_..."
export OPENAI_BASE_URL="http://localhost:8080/v1"
export OPENAI_API_BASE="http://localhost:8080/v1"
export NUSANEXUS_MODEL="auto"
```

`OPENAI_API_BASE` is retained for compatibility with older clients. `OPENAI_BASE_URL` is the preferred modern variable.

### cURL test

```bash
curl http://localhost:8080/v1/chat/completions \
  -H "Authorization: Bearer nnr_..." \
  -H "Content-Type: application/json" \
  -d '{"model":"auto","messages":[{"role":"user","content":"Hello from NusaNexus Router"}]}'
```

### Claude Code

MVP env-first snippet:

```bash
# Claude Code / OpenAI-compatible env
export OPENAI_API_KEY="nnr_..."
export OPENAI_BASE_URL="http://localhost:8080/v1"
export ANTHROPIC_BASE_URL="http://localhost:8080/v1"
export NUSANEXUS_MODEL="auto"
```

Notes:

- Claude Code support varies by setup/version.
- This snippet intentionally shows OpenAI-compatible base URL and key.
- Users should route model `auto` through NusaNexus Router.

### Codex

```bash
export OPENAI_API_KEY="nnr_..."
export OPENAI_BASE_URL="http://localhost:8080/v1"
export NUSANEXUS_MODEL="auto"
codex
```

### OpenClaw

```bash
export OPENAI_API_KEY="nnr_..."
export OPENAI_BASE_URL="http://localhost:8080/v1"
export NUSANEXUS_MODEL="auto"
openclaw
```

### Cursor

```json
{
  "openaiApiKey": "nnr_...",
  "openaiBaseUrl": "http://localhost:8080/v1",
  "model": "auto"
}
```

Also include an env block in description or docs for Cursor users who prefer environment variables:

```env
OPENAI_API_KEY=nnr_...
OPENAI_BASE_URL=http://localhost:8080/v1
```

## Dashboard UX

Update `Endpoint config` section.

Show:

- Router base URL
- API key availability note:
  - if `rawApiKey` exists: snippets include the just-generated key
  - else: snippets use `<generate-an-api-key-first>`
- snippet cards for each snippet returned by `buildOnboardingSnippets()`

Each card includes:

- label
- description
- preformatted snippet

Optional copy buttons are acceptable if implemented simply, but not required.

## Security / Privacy

- Raw router API key remains shown only immediately after generation.
- The dashboard should not fetch raw key from list APIs.
- If `rawApiKey` is empty, snippets must show placeholder.
- Snippets must not include provider credentials.

## API Impact

No API changes.

## Router Impact

No Go router changes.

## Acceptance Criteria

- `apps/web/lib/endpoint-snippets.js` exports target-tool snippet builders.
- Existing env/curl snippets still work.
- Dashboard renders snippets for:
  - Generic env
  - cURL
  - Claude Code
  - Codex
  - OpenClaw
  - Cursor
- Snippets include raw router key only when available in dashboard state.
- Placeholder is used otherwise.
- Docs/backlog updated.
- `npm run lint:web` passes.
- `npm run build:web` passes.
- `cd services/router && go test ./...` passes.
