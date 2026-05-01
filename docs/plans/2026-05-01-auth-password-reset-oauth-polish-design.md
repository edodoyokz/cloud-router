# Auth Password Reset and OAuth Polish Design

Date: 2026-05-01
Status: Approved

## Goal

Polish NusaNexus Router dashboard authentication by adding password reset flows and Google/GitHub OAuth sign-in buttons while preserving the existing Supabase Auth + workspace bootstrap model.

## Scope

In scope:

- Forgot password link from login.
- `/forgot-password` page to request a Supabase password reset email.
- `/reset-password` page to update password after Supabase callback/session exchange.
- Google and GitHub OAuth buttons on login and signup forms.
- Existing email/password login and signup remain available.
- Existing `/auth/callback` remains the callback entry point for OAuth and reset email links.
- Workspace bootstrap remains required after a browser session exists.

Out of scope:

- No custom password policy beyond the current minimum length.
- No custom email templates.
- No OAuth provider setup automation inside Supabase.
- No MFA or enterprise SSO.
- No changes to router API-key auth.

## Password Reset Flow

### Request reset

Route:

```text
/forgot-password
```

User enters an email. The browser calls:

```js
supabase.auth.resetPasswordForEmail(email, {
  redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`
});
```

Supabase sends the reset email.

Success copy should be neutral:

```text
If an account exists, reset instructions were sent.
```

### Callback

The reset email returns to:

```text
/auth/callback?next=/reset-password
```

The existing callback exchanges the Supabase `code` for a session and redirects to the safe local `next` path.

### Update password

Route:

```text
/reset-password
```

User enters a new password and confirmation. The browser validates:

- password length at least 8
- confirmation matches

Then calls:

```js
supabase.auth.updateUser({ password });
```

On success, the page should call the existing bootstrap route with the current session bearer token so the internal user/workspace is ready, then show a link to `/dashboard`.

## OAuth Flow

Add OAuth buttons to the existing auth form:

```text
Continue with Google
Continue with GitHub
```

On click:

```js
supabase.auth.signInWithOAuth({
  provider: 'google' | 'github',
  options: {
    redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(destination)}`
  }
});
```

OAuth depends on provider configuration in Supabase. If the provider is not configured, Supabase should return or surface an error.

## Callback and Bootstrap

Current `/auth/callback` exchanges the auth code and redirects. For OAuth users, internal workspace bootstrap should happen before the user lands on `/dashboard`.

The preferred MVP behavior is:

1. Exchange code for session.
2. If a session/user exists, call existing internal workspace bootstrap logic server-side or an equivalent helper path.
3. Redirect to the safe local `next` path.

If server-side callback bootstrap is not straightforward with the current helper split, it is acceptable for this slice to keep callback redirect behavior and rely on existing dashboard/API workspace resolution, as long as email/password and reset flows still call bootstrap after session availability. Document the limitation clearly.

## Routes and Components

Create:

```text
apps/web/app/forgot-password/page.jsx
apps/web/app/reset-password/page.jsx
apps/web/app/password-reset-form.jsx
apps/web/app/password-update-form.jsx
```

Modify:

```text
apps/web/app/auth-form.jsx
apps/web/app/auth/callback/route.js
apps/web/app/login/page.jsx
apps/web/app/signup/page.jsx
```

Docs:

```text
README.md
docs/AUTH_FLOW.md
docs/SETUP.md
docs/BACKLOG.md
```

## Error Handling

- Missing Supabase public env uses the existing clear client error.
- Password reset request shows neutral success when Supabase accepts the request.
- Password mismatch is rejected client-side before calling Supabase.
- OAuth initiation errors show in the auth form status if Supabase returns immediately.
- Callback errors redirect to login with safe error status.
- Redirect `next` paths must remain local-only and reject external URLs.

## Verification

Run:

```bash
npm run lint:web
npm run build:web
cd services/router && go test ./...
```

Manual checks:

1. `/login` shows forgot password link and Google/GitHub buttons.
2. `/signup` shows Google/GitHub buttons.
3. `/forgot-password` sends a reset email request and shows neutral success.
4. `/reset-password` rejects mismatched passwords.
5. OAuth buttons redirect to Supabase provider authorization URL.
6. `/auth/callback?next=/dashboard` redirects safely and preserves dashboard protection.
7. Existing email/password login/signup still work.
