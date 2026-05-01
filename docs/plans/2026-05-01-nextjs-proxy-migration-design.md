# Next.js Proxy Migration Design

Date: 2026-05-01
Status: Approved

## Goal

Migrate NusaNexus Router's dashboard route protection from the deprecated Next.js `middleware` file convention to the Next.js `proxy` file convention.

The change should remove the build warning:

```text
The "middleware" file convention is deprecated. Please use "proxy" instead.
```

## Scope

This is a compatibility cleanup slice only.

In scope:

- Rename `apps/web/middleware.js` to `apps/web/proxy.js`.
- Rename the exported handler from `middleware` to `proxy`.
- Preserve the existing `/dashboard/:path*` matcher.
- Preserve Supabase cookie session validation.
- Preserve unauthenticated redirects to `/login?next=/dashboard`.
- Update current docs to say dashboard is protected by a Next.js proxy instead of middleware.

Out of scope:

- No auth redesign.
- No change to bearer-token API compatibility.
- No change to `DEV_WORKSPACE_ID` fallback behavior.
- No changes to Supabase helper APIs unless required by Next.js proxy compatibility.
- No updates to historical plan docs that intentionally describe earlier middleware work.

## Current Behavior

`apps/web/middleware.js` protects `/dashboard` routes:

1. Ignore paths outside `/dashboard`.
2. Create a Supabase middleware client.
3. Call `supabase.auth.getUser()`.
4. Redirect unauthenticated users to `/login?next=/dashboard`.
5. Return the Supabase response wrapper for authenticated users.

This behavior must remain identical after migration.

## Target Behavior

`apps/web/proxy.js` should implement the same logic:

```js
export async function proxy(request) {
  // same dashboard auth protection
}

export const config = {
  matcher: ['/dashboard/:path*']
};
```

The production build should still show a proxy entry and should no longer warn about the deprecated `middleware` file convention.

## Documentation

Update current docs only:

- `README.md`
- `docs/AUTH_FLOW.md`
- `docs/BACKLOG.md`
- `docs/SETUP.md` if useful for verification guidance

Use wording such as:

```text
Dashboard is protected by a Next.js proxy with Supabase cookie auth.
```

Historical implementation plans can keep old wording because they document past slices.

## Verification

Run:

```bash
npm run lint:web
npm run build:web
cd services/router && go test ./...
```

Expected:

- lint passes
- build passes
- build output includes `ƒ Proxy`
- deprecated `middleware` warning is gone
- Go tests pass

Manual behavior check:

- Unauthenticated `/dashboard` redirects to `/login?next=/dashboard`.
- Authenticated `/dashboard` remains accessible.
- API bearer auth behavior remains unchanged.
