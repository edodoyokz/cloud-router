# Minimal Dashboard Thin Slice Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a minimal `/dashboard` page that lets users connect an OpenAI-compatible provider, generate a NusaNexus API key, and copy endpoint configuration snippets.

**Architecture:** Keep the dashboard as a simple Next.js route with a client component that calls the existing Supabase-backed API routes. Put snippet generation in a small reusable helper. Do not add auth UI or a full dashboard navigation system in this slice.

**Tech Stack:** Next.js 16 App Router, React 19 client component, existing route handlers `/api/providers` and `/api/endpoint/keys`, simple JSX styling, npm workspace scripts.

---

## Current Repository Context

Important existing files:

- Approved design: `docs/plans/2026-05-01-dashboard-minimal-thin-slice-design.md`
- Existing landing page: `apps/web/app/page.jsx`
- Existing layout: `apps/web/app/layout.jsx`
- Existing provider API route: `apps/web/app/api/providers/route.js`
- Existing API key generation route: `apps/web/app/api/endpoint/keys/route.js`
- Existing provider validation: `apps/web/lib/provider-validation.js`
- Existing web package: `apps/web/package.json`
- Existing Next config: `apps/web/next.config.mjs`

Constraints:

- Do not implement full Supabase Auth UI.
- Do not expose service role key or provider API key in logs.
- Provider API key input should be cleared after successful provider connection.
- Raw NusaNexus API key should only live in current page state after generation.
- Keep styling simple.

---

## Task 1: Add endpoint snippet helper

**Files:**
- Create: `apps/web/lib/endpoint-snippets.js`

**Step 1: Create helper file**

Create `apps/web/lib/endpoint-snippets.js`:

```js
export function normalizeRouterBaseUrl(value) {
  const fallback = 'http://localhost:8080';
  const raw = String(value || fallback).trim() || fallback;
  return raw.replace(/\/+$/, '');
}

export function buildEnvSnippet({ routerBaseUrl, apiKey }) {
  const base = normalizeRouterBaseUrl(routerBaseUrl);
  const key = apiKey || '<generate-an-api-key-first>';
  return `export OPENAI_API_BASE="${base}/v1"\nexport OPENAI_API_KEY="${key}"`;
}

export function buildCurlSnippet({ routerBaseUrl, apiKey }) {
  const base = normalizeRouterBaseUrl(routerBaseUrl);
  const key = apiKey || '<generate-an-api-key-first>';
  return `curl ${base}/v1/chat/completions \\\n  -H "Authorization: Bearer ${key}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"model":"auto","messages":[{"role":"user","content":"Hello"}]}'`;
}
```

**Step 2: Verify helper manually**

Run:

```bash
node -e "import('./apps/web/lib/endpoint-snippets.js').then(m => console.log(m.buildEnvSnippet({routerBaseUrl:'http://localhost:8080/', apiKey:'nnr_test'})))"
```

Expected output includes:

```text
export OPENAI_API_BASE="http://localhost:8080/v1"
export OPENAI_API_KEY="nnr_test"
```

**Step 3: Commit**

```bash
git add apps/web/lib/endpoint-snippets.js
git commit -m "feat: add endpoint snippet helpers"
```

---

## Task 2: Add dashboard client component

**Files:**
- Create: `apps/web/app/dashboard/dashboard-client.jsx`

**Step 1: Create client component skeleton**

Create `apps/web/app/dashboard/dashboard-client.jsx`:

```jsx
'use client';

import { useMemo, useState } from 'react';
import { buildCurlSnippet, buildEnvSnippet, normalizeRouterBaseUrl } from '../../lib/endpoint-snippets.js';

const inputStyle = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: 8,
  border: '1px solid #d0d7de',
  fontSize: 14,
  boxSizing: 'border-box'
};

const labelStyle = {
  display: 'grid',
  gap: 6,
  fontSize: 14,
  fontWeight: 600
};

const cardStyle = {
  border: '1px solid #d0d7de',
  borderRadius: 16,
  padding: 20,
  background: '#fff',
  display: 'grid',
  gap: 16
};

const buttonStyle = {
  border: 0,
  borderRadius: 10,
  padding: '11px 14px',
  background: '#111827',
  color: '#fff',
  fontWeight: 700,
  cursor: 'pointer'
};

const codeStyle = {
  background: '#0f172a',
  color: '#e2e8f0',
  padding: 16,
  borderRadius: 12,
  overflowX: 'auto',
  whiteSpace: 'pre-wrap',
  fontSize: 13
};

export default function DashboardClient({ routerBaseUrl }) {
  const normalizedRouterBaseUrl = useMemo(() => normalizeRouterBaseUrl(routerBaseUrl), [routerBaseUrl]);
  const [providerForm, setProviderForm] = useState({
    display_name: 'My OpenAI-compatible Provider',
    base_url: 'https://api.openai.com',
    default_model: 'gpt-4o-mini',
    api_key: ''
  });
  const [keyName, setKeyName] = useState('Claude Code laptop');
  const [rawApiKey, setRawApiKey] = useState('');
  const [providerStatus, setProviderStatus] = useState(null);
  const [keyStatus, setKeyStatus] = useState(null);
  const [providerPending, setProviderPending] = useState(false);
  const [keyPending, setKeyPending] = useState(false);

  const envSnippet = buildEnvSnippet({ routerBaseUrl: normalizedRouterBaseUrl, apiKey: rawApiKey });
  const curlSnippet = buildCurlSnippet({ routerBaseUrl: normalizedRouterBaseUrl, apiKey: rawApiKey });

  function updateProviderField(field, value) {
    setProviderForm((current) => ({ ...current, [field]: value }));
  }

  async function connectProvider(event) {
    event.preventDefault();
    setProviderPending(true);
    setProviderStatus(null);
    try {
      const response = await fetch('/api/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider_type: 'openai_compatible',
          auth_method: 'api_key',
          ...providerForm
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error?.message || 'Failed to connect provider');
      setProviderStatus({ type: 'success', message: `Provider connected: ${data.display_name}` });
      setProviderForm((current) => ({ ...current, api_key: '' }));
    } catch (error) {
      setProviderStatus({ type: 'error', message: error.message || 'Network error connecting provider' });
    } finally {
      setProviderPending(false);
    }
  }

  async function generateKey(event) {
    event.preventDefault();
    setKeyPending(true);
    setKeyStatus(null);
    try {
      const response = await fetch('/api/endpoint/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: keyName })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error?.message || 'Failed to generate API key');
      setRawApiKey(data.raw_key);
      setKeyStatus({ type: 'success', message: 'Your key was generated. Copy it now. It will not be shown again.' });
    } catch (error) {
      setKeyStatus({ type: 'error', message: error.message || 'Network error generating API key' });
    } finally {
      setKeyPending(false);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <section style={cardStyle}>
        <div>
          <h2 style={{ margin: 0 }}>Connect provider</h2>
          <p style={{ margin: '6px 0 0', color: '#4b5563' }}>Add a generic OpenAI-compatible provider.</p>
        </div>
        <form onSubmit={connectProvider} style={{ display: 'grid', gap: 14 }}>
          <label style={labelStyle}>
            Provider name
            <input style={inputStyle} value={providerForm.display_name} onChange={(event) => updateProviderField('display_name', event.target.value)} />
          </label>
          <label style={labelStyle}>
            Base URL
            <input style={inputStyle} value={providerForm.base_url} onChange={(event) => updateProviderField('base_url', event.target.value)} placeholder="https://api.example.com" />
          </label>
          <label style={labelStyle}>
            Default model
            <input style={inputStyle} value={providerForm.default_model} onChange={(event) => updateProviderField('default_model', event.target.value)} placeholder="gpt-4o-mini" />
          </label>
          <label style={labelStyle}>
            Provider API key
            <input style={inputStyle} type="password" value={providerForm.api_key} onChange={(event) => updateProviderField('api_key', event.target.value)} placeholder="sk-..." />
          </label>
          <button style={buttonStyle} disabled={providerPending} type="submit">{providerPending ? 'Connecting…' : 'Connect provider'}</button>
        </form>
        {providerStatus ? <StatusMessage status={providerStatus} /> : null}
      </section>

      <section style={cardStyle}>
        <div>
          <h2 style={{ margin: 0 }}>Generate router API key</h2>
          <p style={{ margin: '6px 0 0', color: '#4b5563' }}>The raw key is shown once. Copy it before leaving this page.</p>
        </div>
        <form onSubmit={generateKey} style={{ display: 'grid', gap: 14 }}>
          <label style={labelStyle}>
            Key name
            <input style={inputStyle} value={keyName} onChange={(event) => setKeyName(event.target.value)} />
          </label>
          <button style={buttonStyle} disabled={keyPending} type="submit">{keyPending ? 'Generating…' : 'Generate API key'}</button>
        </form>
        {keyStatus ? <StatusMessage status={keyStatus} /> : null}
        {rawApiKey ? <pre style={codeStyle}>{rawApiKey}</pre> : null}
      </section>

      <section style={cardStyle}>
        <div>
          <h2 style={{ margin: 0 }}>Endpoint config</h2>
          <p style={{ margin: '6px 0 0', color: '#4b5563' }}>Router base URL: <code>{normalizedRouterBaseUrl}</code></p>
        </div>
        <div>
          <h3>Environment</h3>
          <pre style={codeStyle}>{envSnippet}</pre>
        </div>
        <div>
          <h3>Test request</h3>
          <pre style={codeStyle}>{curlSnippet}</pre>
        </div>
      </section>
    </div>
  );
}

function StatusMessage({ status }) {
  const isError = status.type === 'error';
  return (
    <div style={{
      borderRadius: 10,
      padding: '10px 12px',
      background: isError ? '#fef2f2' : '#ecfdf5',
      color: isError ? '#991b1b' : '#065f46',
      border: `1px solid ${isError ? '#fecaca' : '#a7f3d0'}`
    }}>
      {status.message}
    </div>
  );
}
```

**Step 2: Run lint/build to catch JSX errors**

```bash
npm run lint:web
npm run build:web
```

Expected: PASS.

**Step 3: Commit**

```bash
git add apps/web/app/dashboard/dashboard-client.jsx
git commit -m "feat: add minimal dashboard client"
```

---

## Task 3: Add dashboard route page

**Files:**
- Create: `apps/web/app/dashboard/page.jsx`

**Step 1: Create page**

Create `apps/web/app/dashboard/page.jsx`:

```jsx
import DashboardClient from './dashboard-client.jsx';

export const metadata = {
  title: 'Dashboard — NusaNexus Router'
};

export default function DashboardPage() {
  const routerBaseUrl = process.env.NEXT_PUBLIC_ROUTER_BASE_URL || 'http://localhost:8080';

  return (
    <main style={{ minHeight: '100vh', background: '#f8fafc', color: '#111827', fontFamily: 'sans-serif' }}>
      <div style={{ maxWidth: 920, margin: '0 auto', padding: '40px 24px', display: 'grid', gap: 24 }}>
        <header style={{ display: 'grid', gap: 8 }}>
          <p style={{ margin: 0, color: '#2563eb', fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase' }}>NusaNexus Router</p>
          <h1 style={{ margin: 0, fontSize: 38 }}>Dashboard</h1>
          <p style={{ margin: 0, color: '#4b5563', fontSize: 16 }}>
            Configure your OpenAI-compatible provider and generate a router API key.
          </p>
          <div style={{ marginTop: 8, border: '1px solid #fde68a', background: '#fffbeb', color: '#92400e', borderRadius: 12, padding: 12 }}>
            Dev mode: this dashboard uses <code>DEV_WORKSPACE_ID</code> until Supabase Auth is wired.
          </div>
        </header>
        <DashboardClient routerBaseUrl={routerBaseUrl} />
      </div>
    </main>
  );
}
```

**Step 2: Build web app**

```bash
npm run build:web
```

Expected: `/dashboard` appears in route output.

**Step 3: Commit**

```bash
git add apps/web/app/dashboard/page.jsx
git commit -m "feat: add minimal dashboard page"
```

---

## Task 4: Add dashboard link from landing page

**Files:**
- Modify: `apps/web/app/page.jsx`

**Step 1: Add link**

Update landing page to include a dashboard link. Keep it simple:

```jsx
export default function HomePage() {
  return (
    <main style={{ fontFamily: 'sans-serif', padding: 32 }}>
      <h1>NusaNexus Router</h1>
      <p>Hosted AI router untuk coding tools, zero-setup.</p>
      <a href="/dashboard">Open dashboard</a>
    </main>
  );
}
```

**Step 2: Run web verification**

```bash
npm run build:web
npm run lint:web
```

Expected: PASS.

**Step 3: Commit**

```bash
git add apps/web/app/page.jsx
git commit -m "feat: link landing page to dashboard"
```

---

## Task 5: Update docs for minimal dashboard flow

**Files:**
- Modify: `README.md`
- Modify: `docs/SETUP.md`
- Modify: `docs/BUILD_ORDER.md`

**Step 1: Update README Next Build Steps**

Replace outdated next steps with current state and next steps:

```md
## Current Thin Slice
- Minimal `/dashboard` page for provider connection and API key generation
- Supabase-backed provider/API key persistence
- Go router can read Supabase config when env vars are set
- Non-streaming OpenAI-compatible chat completions

## Next Build Steps
1. Wire Supabase Auth and remove `DEV_WORKSPACE_ID` dependency
2. Add provider/API key listing and revoke/disconnect flows
3. Add usage dashboard
4. Add provider health checks
```

**Step 2: Update setup docs**

In `docs/SETUP.md`, add:

```md
Open `http://localhost:3000/dashboard` to use the minimal dashboard.
```

**Step 3: Update build order**

Mark or note that a minimal dashboard thin slice exists under Phase 3.

**Step 4: Commit**

```bash
git add README.md docs/SETUP.md docs/BUILD_ORDER.md
git commit -m "docs: document minimal dashboard flow"
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

Expected: PASS and includes `/dashboard`.

**Step 3: Run Go tests**

```bash
cd services/router && go test ./...
```

Expected: PASS.

**Step 4: Check status**

```bash
git status --short
```

Expected: clean except `.pi/` if present.

**Step 5: Commit any final fixes**

```bash
git add <files>
git commit -m "chore: finalize minimal dashboard thin slice"
```

---

## Deferred Work

Do not implement these in this plan:

- Login/signup UI.
- Supabase Auth browser session handling.
- Provider list/edit/delete.
- API key list/revoke.
- Usage dashboard.
- Preset editor.
- Full dashboard navigation/sidebar.
- Visual design system.
- Copy-to-clipboard buttons unless trivial and not disruptive.

---

## Execution Handoff

Implement in a separate worktree or parallel session using `superpowers:executing-plans`.

Recommended prompt:

```text
Use superpowers:executing-plans to implement this plan task-by-task:

docs/plans/2026-05-01-dashboard-minimal-thin-slice-implementation.md

Follow the plan exactly, use TDD where specified, make the commits described in each task, and stop for review if any task fails or requires product/design clarification.
```
