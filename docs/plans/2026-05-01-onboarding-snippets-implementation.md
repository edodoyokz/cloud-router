# Onboarding Snippets Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add richer dashboard onboarding snippets for Claude Code, Codex, OpenClaw, and Cursor using existing OpenAI-compatible router endpoint and generated router API key.

**Architecture:** Extend `apps/web/lib/endpoint-snippets.js` with reusable snippet builders and update dashboard `Endpoint config` section to render an ordered list of snippet cards. No API, DB, or router changes.

**Tech Stack:** Next.js 16 App Router, React 19 dashboard client, existing snippet helper.

---

## Current Repository Context

Approved design:

```text
docs/plans/2026-05-01-onboarding-snippets-design.md
```

Relevant files:

```text
apps/web/lib/endpoint-snippets.js
apps/web/app/dashboard/dashboard-client.jsx
README.md
docs/SETUP.md
docs/BACKLOG.md
```

Current helper exports:

```js
normalizeRouterBaseUrl(value)
buildEnvSnippet({ routerBaseUrl, apiKey })
buildCurlSnippet({ routerBaseUrl, apiKey })
```

Current dashboard imports these helpers and renders only env + cURL snippets.

Constraints:

- Do not add DB/API changes.
- Do not fetch raw API key from any list API.
- Use `rawApiKey` from dashboard state when just generated.
- Use `<generate-an-api-key-first>` placeholder otherwise.
- Keep model as `auto`.

---

## Task 1: Extend endpoint snippet helper

**Files:**
- Modify: `apps/web/lib/endpoint-snippets.js`

### Step 1: Replace/extend helper implementation

Update file to include these exports while preserving existing names:

```js
const API_KEY_PLACEHOLDER = '<generate-an-api-key-first>';

export function normalizeRouterBaseUrl(value) {
  const fallback = 'http://localhost:8080';
  const raw = String(value || fallback).trim() || fallback;
  return raw.replace(/\/+$/, '');
}

function snippetContext({ routerBaseUrl, apiKey }) {
  const base = normalizeRouterBaseUrl(routerBaseUrl);
  return {
    routerBaseUrl: base,
    openaiBaseUrl: `${base}/v1`,
    apiKey: apiKey || API_KEY_PLACEHOLDER,
    model: 'auto'
  };
}

export function buildEnvSnippet({ routerBaseUrl, apiKey }) {
  const { openaiBaseUrl, apiKey: key, model } = snippetContext({ routerBaseUrl, apiKey });
  return `export OPENAI_API_KEY="${key}"\nexport OPENAI_BASE_URL="${openaiBaseUrl}"\nexport OPENAI_API_BASE="${openaiBaseUrl}"\nexport NUSANEXUS_MODEL="${model}"`;
}

export function buildCurlSnippet({ routerBaseUrl, apiKey }) {
  const { routerBaseUrl: base, apiKey: key, model } = snippetContext({ routerBaseUrl, apiKey });
  return `curl ${base}/v1/chat/completions \\\n  -H "Authorization: Bearer ${key}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"model":"${model}","messages":[{"role":"user","content":"Hello from NusaNexus Router"}]}'`;
}

export function buildClaudeCodeSnippet({ routerBaseUrl, apiKey }) {
  const { openaiBaseUrl, apiKey: key, model } = snippetContext({ routerBaseUrl, apiKey });
  return `# Claude Code / OpenAI-compatible env\nexport OPENAI_API_KEY="${key}"\nexport OPENAI_BASE_URL="${openaiBaseUrl}"\nexport ANTHROPIC_BASE_URL="${openaiBaseUrl}"\nexport NUSANEXUS_MODEL="${model}"`;
}

export function buildCodexSnippet({ routerBaseUrl, apiKey }) {
  const { openaiBaseUrl, apiKey: key, model } = snippetContext({ routerBaseUrl, apiKey });
  return `export OPENAI_API_KEY="${key}"\nexport OPENAI_BASE_URL="${openaiBaseUrl}"\nexport NUSANEXUS_MODEL="${model}"\ncodex`;
}

export function buildOpenClawSnippet({ routerBaseUrl, apiKey }) {
  const { openaiBaseUrl, apiKey: key, model } = snippetContext({ routerBaseUrl, apiKey });
  return `export OPENAI_API_KEY="${key}"\nexport OPENAI_BASE_URL="${openaiBaseUrl}"\nexport NUSANEXUS_MODEL="${model}"\nopenclaw`;
}

export function buildCursorSnippet({ routerBaseUrl, apiKey }) {
  const { openaiBaseUrl, apiKey: key, model } = snippetContext({ routerBaseUrl, apiKey });
  return JSON.stringify({
    openaiApiKey: key,
    openaiBaseUrl,
    model
  }, null, 2);
}

export function buildOnboardingSnippets({ routerBaseUrl, apiKey }) {
  const input = { routerBaseUrl, apiKey };
  return [
    {
      id: 'env',
      label: 'Generic env',
      description: 'OpenAI-compatible environment variables for CLIs and SDKs.',
      language: 'bash',
      content: buildEnvSnippet(input)
    },
    {
      id: 'curl',
      label: 'cURL test',
      description: 'Quick smoke test for the non-streaming chat completions endpoint.',
      language: 'bash',
      content: buildCurlSnippet(input)
    },
    {
      id: 'claude-code',
      label: 'Claude Code',
      description: 'Env-first setup for OpenAI-compatible Claude Code configurations. Support varies by local setup/version.',
      language: 'bash',
      content: buildClaudeCodeSnippet(input)
    },
    {
      id: 'codex',
      label: 'Codex',
      description: 'Start Codex with OpenAI-compatible environment variables pointed at NusaNexus Router.',
      language: 'bash',
      content: buildCodexSnippet(input)
    },
    {
      id: 'openclaw',
      label: 'OpenClaw',
      description: 'Start OpenClaw with OpenAI-compatible environment variables pointed at NusaNexus Router.',
      language: 'bash',
      content: buildOpenClawSnippet(input)
    },
    {
      id: 'cursor',
      label: 'Cursor',
      description: 'Use these values in Cursor custom OpenAI-compatible settings. You can also use OPENAI_API_KEY and OPENAI_BASE_URL env vars.',
      language: 'json',
      content: buildCursorSnippet(input)
    }
  ];
}
```

### Step 2: Quick helper smoke check

Run:

```bash
node --input-type=module - <<'NODE'
import { buildOnboardingSnippets } from './apps/web/lib/endpoint-snippets.js';
console.log(buildOnboardingSnippets({ routerBaseUrl: 'http://localhost:8080/', apiKey: 'nnr_test' }).map((snippet) => snippet.id).join(','));
NODE
```

Expected:

```text
env,curl,claude-code,codex,openclaw,cursor
```

ESM package warning is acceptable if lint/build pass.

### Step 3: Lint/build

```bash
npm run lint:web
npm run build:web
```

Expected: PASS.

### Step 4: Commit

```bash
git add apps/web/lib/endpoint-snippets.js
git commit -m "feat: add onboarding snippet builders"
```

---

## Task 2: Render snippets in dashboard

**Files:**
- Modify: `apps/web/app/dashboard/dashboard-client.jsx`

### Step 1: Update imports

Current import likely looks like:

```js
import { buildCurlSnippet, buildEnvSnippet, normalizeRouterBaseUrl } from '../../lib/endpoint-snippets.js';
```

Change to:

```js
import { buildOnboardingSnippets, normalizeRouterBaseUrl } from '../../lib/endpoint-snippets.js';
```

### Step 2: Replace snippet variables

Find:

```js
const envSnippet = buildEnvSnippet({ routerBaseUrl, apiKey: rawApiKey });
const curlSnippet = buildCurlSnippet({ routerBaseUrl, apiKey: rawApiKey });
```

Replace with:

```js
const onboardingSnippets = buildOnboardingSnippets({ routerBaseUrl, apiKey: rawApiKey });
```

Keep:

```js
const normalizedRouterBaseUrl = normalizeRouterBaseUrl(routerBaseUrl);
```

### Step 3: Update Endpoint config section

Current section renders Environment and Test request separately. Replace with:

```jsx
<section style={cardStyle}>
  <div>
    <h2 style={{ margin: 0 }}>Endpoint config</h2>
    <p style={{ margin: '6px 0 0', color: '#4b5563' }}>Router base URL: <code>{normalizedRouterBaseUrl}</code></p>
    <p style={{ margin: '6px 0 0', color: '#4b5563' }}>
      {rawApiKey ? 'Snippets include the API key you just generated. Copy it before leaving this page.' : 'Generate a router API key first; snippets use a placeholder until a raw key is available.'}
    </p>
  </div>
  <div style={{ display: 'grid', gap: 12 }}>
    {onboardingSnippets.map((snippet) => (
      <div key={snippet.id} style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 14, display: 'grid', gap: 8 }}>
        <div>
          <h3 style={{ margin: 0 }}>{snippet.label}</h3>
          <p style={{ margin: '6px 0 0', color: '#4b5563' }}>{snippet.description}</p>
        </div>
        <pre style={codeStyle}>{snippet.content}</pre>
      </div>
    ))}
  </div>
</section>
```

### Step 4: Lint/build

```bash
npm run lint:web
npm run build:web
```

Expected: PASS.

### Step 5: Commit

```bash
git add apps/web/app/dashboard/dashboard-client.jsx
git commit -m "feat: show onboarding snippets in dashboard"
```

---

## Task 3: Update docs/backlog

**Files:**
- Modify: `README.md`
- Modify: `docs/SETUP.md`
- Modify: `docs/BACKLOG.md`

### README

Add current thin slice bullet:

```md
- Dashboard shows onboarding snippets for Claude Code, Codex, OpenClaw, Cursor, env, and cURL
```

Update next build steps:

```md
## Next Build Steps
1. Add production SSR/cookie auth hardening
2. Add usage charts and provider breakdowns
3. Add provider tags for primary/backup/free/cheap routing hints
4. Add better onboarding wizard with persisted checklist
```

### SETUP

Add smoke step after API key generation/dashboard endpoint config steps:

```md
Use `/dashboard` Endpoint config snippets for Generic env, cURL, Claude Code, Codex, OpenClaw, or Cursor. Snippets include the raw key only immediately after key generation; otherwise they show `<generate-an-api-key-first>`.
```

### BACKLOG

Mark P1 item done:

```md
- [x] Copy config snippets for Claude Code / Codex / OpenClaw / Cursor
```

Add note:

```md
- Onboarding snippets thin slice is implemented in `/dashboard` Endpoint config.
```

### Commit

```bash
git add README.md docs/SETUP.md docs/BACKLOG.md
git commit -m "docs: document onboarding snippets"
```

---

## Task 4: Final verification

Run:

```bash
npm run lint:web
npm run build:web
cd services/router && go test ./...
```

Expected:

- lint PASS
- build PASS
- Go tests PASS

Then check:

```bash
git status --short
git log --oneline --decorate -10
```

Expected status clean except `.pi/` if present.

---

## Manual Smoke Test

1. Start web:
   ```bash
   npm run dev:web
   ```
2. Open `/dashboard`.
3. Before generating key, confirm Endpoint config snippets show:
   ```text
   <generate-an-api-key-first>
   ```
4. Generate a router API key.
5. Confirm Endpoint config snippets now include the raw `nnr_...` key.
6. Confirm cards exist for:
   - Generic env
   - cURL test
   - Claude Code
   - Codex
   - OpenClaw
   - Cursor
7. Confirm no provider credential appears in snippets.

---

## Deferred Work

Do not implement:

- copy-to-clipboard buttons unless trivial and no test/lint complexity
- persisted onboarding checklist
- wizard flow
- tool version detection
- API docs endpoint
- streaming/embeddings snippets

---

## Execution Handoff

Plan saved to:

```text
docs/plans/2026-05-01-onboarding-snippets-implementation.md
```

Recommended prompt for a parallel session:

```text
Use superpowers:executing-plans to implement this plan task-by-task:

docs/plans/2026-05-01-onboarding-snippets-implementation.md

Follow the plan exactly, make the commits described in each task, and stop for review if any task fails or requires product/design clarification.
```
