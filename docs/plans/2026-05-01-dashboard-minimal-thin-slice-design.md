# NusaNexus Router — Minimal Dashboard Thin Slice Design

Date: 2026-05-01
Status: Approved

## Context

NusaNexus Router now has a Supabase-backed thin slice:

- `POST /api/providers` persists OpenAI-compatible providers.
- `POST /api/endpoint/keys` generates and stores hashed NusaNexus API keys.
- Provider creation ensures a default routing preset and preset step.
- The Go router can read config from Supabase when configured.

The next step is to expose this thin slice through a minimal browser dashboard so the flow can be used manually without curl-only setup.

## Goals

- Add a minimal `/dashboard` page.
- Let a user connect a generic OpenAI-compatible provider.
- Let a user generate a NusaNexus router API key.
- Show the raw generated API key once in the browser.
- Show copyable endpoint configuration snippets.
- Keep the UI simple and dev-friendly while full Supabase Auth UI is not implemented.

## Non-Goals

- Full login/signup UI.
- Full dashboard navigation/sidebar.
- Provider listing/edit/delete.
- API key listing/revocation.
- Usage dashboard.
- Preset editor UI.
- Advanced visual design system.
- Client-side Supabase session handling.

## Recommended Approach

Build one route:

```text
apps/web/app/dashboard/page.jsx
```

Use a small client component for interactivity:

```text
apps/web/app/dashboard/dashboard-client.jsx
```

Keep all state in the page session. The API key raw value is shown only after generation and is not fetched again.

This gives the fastest useful path:

1. Open `/dashboard`.
2. Connect provider.
3. Generate API key.
4. Copy endpoint snippet.
5. Send a request to the Go router.

## Page Structure

### Header

Title:

```text
NusaNexus Router Dashboard
```

Subtitle:

```text
Configure your OpenAI-compatible provider and generate a router API key.
```

Dev note:

```text
Dev mode: this dashboard uses DEV_WORKSPACE_ID until Supabase Auth is wired.
```

### Provider Form

Fields:

- Provider name
- Base URL
- Default model
- Provider API key

Submit action:

```text
Connect provider
```

Request:

```http
POST /api/providers
Content-Type: application/json
```

Body:

```json
{
  "provider_type": "openai_compatible",
  "auth_method": "api_key",
  "display_name": "My Provider",
  "base_url": "https://api.example.com",
  "default_model": "gpt-4o-mini",
  "api_key": "sk-..."
}
```

Success state:

```text
Provider connected: <display_name>
```

Error state:

```text
Failed to connect provider: <message>
```

### API Key Form

Fields:

- Key name

Submit action:

```text
Generate API key
```

Request:

```http
POST /api/endpoint/keys
Content-Type: application/json
```

Body:

```json
{
  "name": "Claude Code laptop"
}
```

Success state:

```text
Your key was generated. Copy it now. It will not be shown again.
```

Show:

```text
nnr_...
```

### Endpoint Snippets

Use `NEXT_PUBLIC_ROUTER_BASE_URL` if configured. Fallback:

```text
http://localhost:8080
```

Show environment snippet:

```bash
export OPENAI_API_BASE="<router_base_url>/v1"
export OPENAI_API_KEY="<raw_key>"
```

Show curl test snippet:

```bash
curl <router_base_url>/v1/chat/completions \
  -H "Authorization: Bearer <raw_key>" \
  -H "Content-Type: application/json" \
  -d '{"model":"auto","messages":[{"role":"user","content":"Hello"}]}'
```

If no key has been generated in the current page session, use placeholder:

```text
<generate-an-api-key-first>
```

## Helper Functions

Create:

```text
apps/web/lib/endpoint-snippets.js
```

Responsibilities:

- Normalize router base URL.
- Generate env snippet.
- Generate curl snippet.

Example API:

```js
export function normalizeRouterBaseUrl(value) {}
export function buildEnvSnippet({ routerBaseUrl, apiKey }) {}
export function buildCurlSnippet({ routerBaseUrl, apiKey }) {}
```

Keeping snippets in a helper makes them easy to test and reuse on future endpoint pages.

## Error Handling

The dashboard client should:

- Show validation/API errors returned by route handlers.
- Show a generic fallback message for network errors.
- Disable submit buttons while requests are pending.
- Never log provider API keys.
- Clear provider API key input after successful provider connection.

## Styling

Use simple inline styles or minimal CSS in JSX. The goal is clarity, not a full design system.

Layout:

- Centered max-width container.
- Stacked cards.
- Monospace blocks for snippets and raw API key.
- Clear success/error status messages.

## Testing Strategy

Minimum verification:

```bash
npm run build:web
npm run lint:web
cd services/router && go test ./...
```

Optional helper verification:

```bash
node -e "import('./apps/web/lib/endpoint-snippets.js').then(m => console.log(m.buildEnvSnippet({routerBaseUrl:'http://localhost:8080', apiKey:'nnr_test'})))"
```

## Acceptance Criteria

This batch is complete when:

- `/dashboard` builds successfully.
- Provider form posts to `/api/providers`.
- API key form posts to `/api/endpoint/keys`.
- Generated raw key is displayed once in page state.
- Endpoint env and curl snippets update with the generated key.
- Web build and lint pass.
- Existing Go tests pass.
