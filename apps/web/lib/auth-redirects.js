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
