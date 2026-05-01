# Next.js Proxy Migration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the deprecated Next.js `middleware` file convention with the Next.js `proxy` convention while preserving dashboard Supabase cookie auth behavior.

**Architecture:** Rename `apps/web/middleware.js` to `apps/web/proxy.js` and rename the exported handler to `proxy`. Keep the matcher and route-protection logic identical. Update current docs to use proxy wording and verify the build warning is gone.

**Tech Stack:** Next.js 16 App Router, `@supabase/ssr`, React web workspace, Go router unchanged.

---

## Pre-flight

Run from repo root:

```bash
git status --short
npm run lint:web
npm run build:web
cd services/router && go test ./...
```

Expected baseline:

- lint passes
- build passes but may show the deprecated middleware warning before this migration
- Go tests pass
- existing untracked `.pi/` may remain

---

### Task 1: Rename middleware to proxy

**Files:**
- Rename: `apps/web/middleware.js` -> `apps/web/proxy.js`
- Modify: `apps/web/proxy.js`

**Step 1: Rename file**

Run:

```bash
git mv apps/web/middleware.js apps/web/proxy.js
```

**Step 2: Rename exported handler**

Change:

```js
export async function middleware(request) {
```

to:

```js
export async function proxy(request) {
```

Do not change the handler body or `config.matcher`.

Expected final file:

```js
import { NextResponse } from 'next/server';
import { createSupabaseMiddlewareClient } from './lib/supabase-server.js';

export async function proxy(request) {
  const { pathname } = request.nextUrl;
  if (!pathname.startsWith('/dashboard')) {
    return NextResponse.next();
  }

  const { supabase, response } = createSupabaseMiddlewareClient(request);
  const { data, error } = await supabase.auth.getUser();

  if (error || !data?.user) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = '/login';
    redirectUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(redirectUrl);
  }

  return response();
}

export const config = {
  matcher: ['/dashboard/:path*']
};
```

**Step 3: Verify**

Run:

```bash
npm run lint:web
npm run build:web
```

Expected:

- lint passes
- build passes
- build output includes `ƒ Proxy`
- build output does not include `The "middleware" file convention is deprecated`

**Step 4: Commit**

```bash
git add apps/web/proxy.js apps/web/middleware.js
git commit -m "chore: migrate dashboard auth middleware to proxy"
```

---

### Task 2: Update current docs wording

**Files:**
- Modify: `README.md`
- Modify: `docs/AUTH_FLOW.md`
- Modify: `docs/BACKLOG.md`
- Modify: `docs/SETUP.md`

**Step 1: Update README**

Change current thin-slice wording from:

```md
- Dashboard is protected by Supabase cookie middleware while API routes still support bearer tokens and dev fallback
```

to:

```md
- Dashboard is protected by a Next.js proxy with Supabase cookie auth while API routes still support bearer tokens and dev fallback
```

Remove the Next Build Step entry for middleware/proxy migration and renumber the remaining entries.

**Step 2: Update AUTH_FLOW**

Change current wording from cookie middleware to Next.js proxy with Supabase cookie auth. Do not rewrite unrelated auth flow sections.

**Step 3: Update BACKLOG**

Add/update note:

```md
- Dashboard route protection now uses the Next.js proxy convention with Supabase cookie auth.
```

If any current backlog entry still says middleware migration is pending, mark/remove it.

**Step 4: Update SETUP**

Add or update verification guidance to confirm unauthenticated `/dashboard` redirects through proxy protection.

**Step 5: Verify docs references**

Run:

```bash
rg -n "middleware file convention|Migrate Next.js middleware|cookie middleware|middleware warning" README.md docs/AUTH_FLOW.md docs/BACKLOG.md docs/SETUP.md
```

Expected: no current-doc wording says migration is pending or that the active implementation uses middleware. Historical plan docs may still mention middleware.

**Step 6: Commit**

```bash
git add README.md docs/AUTH_FLOW.md docs/BACKLOG.md docs/SETUP.md
git commit -m "docs: document nextjs proxy auth protection"
```

---

### Task 3: Final verification

Run:

```bash
npm run lint:web
npm run build:web
cd services/router && go test ./...
```

Expected:

- lint passes
- Next.js build passes
- build output includes `ƒ Proxy`
- build output does not include the deprecated middleware warning
- Go tests pass

Then inspect:

```bash
git status --short
git log --oneline -8
```

Expected: clean except local untracked `.pi/` if present.

Report final commits and verification results.
