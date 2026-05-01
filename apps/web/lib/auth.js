export function bearerTokenFromRequest(request) {
  const header = request?.headers?.get?.('authorization') || request?.headers?.get?.('Authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

export function getSupabaseAuthConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url) throw Object.assign(new Error('NEXT_PUBLIC_SUPABASE_URL is required'), { status: 500, code: 'configuration_error' });
  if (!anonKey) throw Object.assign(new Error('NEXT_PUBLIC_SUPABASE_ANON_KEY is required'), { status: 500, code: 'configuration_error' });
  return { url: url.replace(/\/+$/, ''), anonKey };
}

export async function getAuthenticatedUser(request) {
  const token = bearerTokenFromRequest(request);
  if (!token) return null;

  const { url, anonKey } = getSupabaseAuthConfig();
  const response = await fetch(`${url}/auth/v1/user`, {
    method: 'GET',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token}`
    },
    cache: 'no-store'
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw Object.assign(new Error(data?.msg || data?.message || 'Supabase session is invalid'), {
      status: 401,
      code: 'invalid_session'
    });
  }

  if (!data?.id || !data?.email) {
    throw Object.assign(new Error('Supabase session is missing user identity'), {
      status: 401,
      code: 'invalid_session'
    });
  }

  return { id: data.id, email: data.email };
}
