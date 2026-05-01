# Auth Password Reset and OAuth Polish Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add password reset pages and Google/GitHub OAuth buttons to the existing Supabase Auth flow while preserving email/password auth, safe redirects, and workspace bootstrap behavior.

**Architecture:** Extend the client auth form with OAuth actions, add dedicated password reset request/update client forms, and reuse existing Supabase browser client plus `/api/auth/bootstrap`. Keep `/auth/callback` as the shared code-exchange route and harden callback error redirects. Update docs to reflect the polished auth flow.

**Tech Stack:** Next.js App Router, React client components, Supabase JS browser client, Supabase SSR callback helper, existing workspace bootstrap API, Go router unchanged.

---

## Pre-flight

Run from repo root:

```bash
git status --short
npm run lint:web
npm run build:web
cd services/router && go test ./...
```

Expected: lint/build/go tests pass. Existing untracked `.pi/` may remain.

---

### Task 1: Add shared auth redirect helpers

**Files:**
- Create: `apps/web/lib/auth-redirects.js`

**Step 1: Create helper module**

Add:

```js
export function safeNextPath(value, fallback = '/dashboard') {
  const next = String(value || fallback);
  if (!next.startsWith('/') || next.startsWith('//')) return fallback;
  return next;
}

export function authCallbackUrl(nextPath = '/dashboard') {
  if (typeof window === 'undefined') return `/auth/callback?next=${encodeURIComponent(safeNextPath(nextPath))}`;
  const next = safeNextPath(nextPath);
  return `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
}
```

**Step 2: Update existing `AuthForm` import/use**

Modify `apps/web/app/auth-form.jsx`:

- import `authCallbackUrl` and `safeNextPath` from `../lib/auth-redirects.js`
- remove local `safeNextPath` function
- keep existing email/password behavior unchanged for now

**Step 3: Verify**

Run:

```bash
npm run lint:web
```

Expected: PASS.

**Step 4: Commit**

```bash
git add apps/web/lib/auth-redirects.js apps/web/app/auth-form.jsx
git commit -m "feat: add shared auth redirect helpers"
```

---

### Task 2: Add OAuth buttons to login/signup form

**Files:**
- Modify: `apps/web/app/auth-form.jsx`

**Step 1: Add OAuth handler**

Inside `AuthForm`, add:

```js
async function signInWithOAuth(provider) {
  setPending(true);
  setStatus(null);
  try {
    const supabase = getSupabaseBrowserClient();
    const result = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: authCallbackUrl(destination)
      }
    });
    if (result.error) throw result.error;
  } catch (error) {
    setStatus({ type: 'error', message: error.message || 'OAuth sign-in failed' });
    setPending(false);
  }
}
```

Do not set `pending` false after a successful OAuth initiation because the browser should redirect.

**Step 2: Render buttons**

Above or below the email/password submit button, render:

```jsx
<div style={{ display: 'grid', gap: 8 }}>
  <button style={{ ...buttonStyle, background: '#fff', color: '#111827', border: '1px solid #d0d7de' }} type="button" disabled={pending} onClick={() => signInWithOAuth('google')}>
    Continue with Google
  </button>
  <button style={{ ...buttonStyle, background: '#fff', color: '#111827', border: '1px solid #d0d7de' }} type="button" disabled={pending} onClick={() => signInWithOAuth('github')}>
    Continue with GitHub
  </button>
</div>
```

Keep email/password fields and submit button.

**Step 3: Verify**

Run:

```bash
npm run lint:web
npm run build:web
```

Expected: PASS.

**Step 4: Commit**

```bash
git add apps/web/app/auth-form.jsx
git commit -m "feat: add oauth auth buttons"
```

---

### Task 3: Add forgot password page/form

**Files:**
- Create: `apps/web/app/password-reset-form.jsx`
- Create: `apps/web/app/forgot-password/page.jsx`
- Modify: `apps/web/app/login/page.jsx`

**Step 1: Create password reset request form**

Create `apps/web/app/password-reset-form.jsx`:

```jsx
'use client';

import { useState } from 'react';
import { authCallbackUrl } from '../lib/auth-redirects.js';
import { getSupabaseBrowserClient } from '../lib/supabase-browser.js';

const inputStyle = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: 8,
  border: '1px solid #d0d7de',
  fontSize: 14,
  boxSizing: 'border-box'
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

export default function PasswordResetForm() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState(null);
  const [pending, setPending] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setPending(true);
    setStatus(null);
    try {
      const supabase = getSupabaseBrowserClient();
      const result = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: authCallbackUrl('/reset-password')
      });
      if (result.error) throw result.error;
      setStatus({ type: 'success', message: 'If an account exists, reset instructions were sent.' });
    } catch (error) {
      setStatus({ type: 'error', message: error.message || 'Failed to request password reset' });
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ display: 'grid', gap: 14 }}>
      <label style={{ display: 'grid', gap: 6, fontWeight: 600 }}>
        Email
        <input style={inputStyle} type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
      </label>
      <button style={buttonStyle} type="submit" disabled={pending}>{pending ? 'Sending…' : 'Send reset instructions'}</button>
      {status ? <StatusMessage status={status} /> : null}
    </form>
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

**Step 2: Create page**

Create `apps/web/app/forgot-password/page.jsx` with layout matching login/signup:

```jsx
import Link from 'next/link';
import PasswordResetForm from '../password-reset-form.jsx';

export const metadata = {
  title: 'Forgot password — NusaNexus Router'
};

export default function ForgotPasswordPage() {
  return (
    <main style={{ minHeight: '100vh', background: '#f8fafc', color: '#111827', fontFamily: 'sans-serif' }}>
      <div style={{ maxWidth: 420, margin: '0 auto', padding: '48px 24px', display: 'grid', gap: 20 }}>
        <header style={{ display: 'grid', gap: 8 }}>
          <Link href="/">NusaNexus Router</Link>
          <h1 style={{ margin: 0 }}>Reset password</h1>
          <p style={{ margin: 0, color: '#4b5563' }}>Enter your email and we’ll send reset instructions if an account exists.</p>
        </header>
        <section style={{ border: '1px solid #d0d7de', borderRadius: 16, padding: 20, background: '#fff' }}>
          <PasswordResetForm />
        </section>
        <Link href="/login">Back to login</Link>
      </div>
    </main>
  );
}
```

**Step 3: Add login link**

In `apps/web/app/login/page.jsx`, add a link to `/forgot-password` near the alternate signup link.

**Step 4: Verify and commit**

```bash
npm run lint:web
npm run build:web
git add apps/web/app/password-reset-form.jsx apps/web/app/forgot-password/page.jsx apps/web/app/login/page.jsx
git commit -m "feat: add forgot password flow"
```

---

### Task 4: Add reset password update page/form

**Files:**
- Create: `apps/web/app/password-update-form.jsx`
- Create: `apps/web/app/reset-password/page.jsx`

**Step 1: Create password update form**

Create `apps/web/app/password-update-form.jsx`:

```jsx
'use client';

import Link from 'next/link';
import { useState } from 'react';
import { getSupabaseBrowserClient } from '../lib/supabase-browser.js';

const inputStyle = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: 8,
  border: '1px solid #d0d7de',
  fontSize: 14,
  boxSizing: 'border-box'
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

export default function PasswordUpdateForm() {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [status, setStatus] = useState(null);
  const [pending, setPending] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setStatus(null);
    if (password.length < 8) {
      setStatus({ type: 'error', message: 'Password must be at least 8 characters.' });
      return;
    }
    if (password !== confirmPassword) {
      setStatus({ type: 'error', message: 'Passwords do not match.' });
      return;
    }

    setPending(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const result = await supabase.auth.updateUser({ password });
      if (result.error) throw result.error;

      const sessionResult = await supabase.auth.getSession();
      const token = sessionResult.data?.session?.access_token;
      if (token) {
        const response = await fetch('/api/auth/bootstrap', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` }
        });
        if (!response.ok) {
          const data = await response.json();
          throw new Error(data?.error?.message || 'Password updated, but workspace bootstrap failed');
        }
      }

      setStatus({ type: 'success', message: 'Password updated. You can open the dashboard now.' });
      setPassword('');
      setConfirmPassword('');
    } catch (error) {
      setStatus({ type: 'error', message: error.message || 'Failed to update password' });
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ display: 'grid', gap: 14 }}>
      <label style={{ display: 'grid', gap: 6, fontWeight: 600 }}>
        New password
        <input style={inputStyle} type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={8} />
      </label>
      <label style={{ display: 'grid', gap: 6, fontWeight: 600 }}>
        Confirm password
        <input style={inputStyle} type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required minLength={8} />
      </label>
      <button style={buttonStyle} type="submit" disabled={pending}>{pending ? 'Updating…' : 'Update password'}</button>
      {status ? <StatusMessage status={status} /> : null}
      {status?.type === 'success' ? <Link href="/dashboard">Open dashboard</Link> : null}
    </form>
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

**Step 2: Create page**

Create `apps/web/app/reset-password/page.jsx` with matching layout and `PasswordUpdateForm`.

**Step 3: Verify and commit**

```bash
npm run lint:web
npm run build:web
git add apps/web/app/password-update-form.jsx apps/web/app/reset-password/page.jsx
git commit -m "feat: add password update flow"
```

---

### Task 5: Harden callback error redirect and docs

**Files:**
- Modify: `apps/web/app/auth/callback/route.js`
- Modify: `README.md`
- Modify: `docs/AUTH_FLOW.md`
- Modify: `docs/SETUP.md`
- Modify: `docs/BACKLOG.md`

**Step 1: Inspect callback**

Read `apps/web/app/auth/callback/route.js`. Preserve safe local `next` handling.

If callback currently throws or returns a raw error, change it to redirect to:

```text
/login?error=auth_callback_failed
```

Only if needed. Do not break successful code exchange behavior.

**Step 2: Update README**

Add current thin-slice bullet:

```md
- Dashboard auth supports password reset and Google/GitHub OAuth entry points
```

Remove password reset/OAuth from Next Build Steps.

**Step 3: Update AUTH_FLOW**

Document:

- forgot password request
- `/auth/callback?next=/reset-password`
- `/reset-password` update
- OAuth Google/GitHub buttons via Supabase

**Step 4: Update SETUP**

Add manual verification steps for forgot password and OAuth button redirects.

**Step 5: Update BACKLOG**

Mark password reset/OAuth polish as done or add note under P1 notes.

**Step 6: Verify and commit**

```bash
npm run lint:web
npm run build:web
git add apps/web/app/auth/callback/route.js README.md docs/AUTH_FLOW.md docs/SETUP.md docs/BACKLOG.md
git commit -m "docs: document auth reset oauth polish"
```

If callback does not need code changes, do not add it to the commit.

---

### Task 6: Final verification

Run:

```bash
npm run lint:web
npm run build:web
cd services/router && go test ./...
```

Expected:

- lint passes
- build includes `/forgot-password` and `/reset-password`
- Go tests pass

Inspect:

```bash
git status --short
git log --oneline -8
```

Expected: clean except local untracked `.pi/` if present.

Report commits and verification results.
