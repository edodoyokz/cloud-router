const jsonHeaders = (serviceKey) => ({
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
  'Content-Type': 'application/json',
  Prefer: 'return=representation'
});

export function getSupabaseAdminConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL is required');
  if (!serviceKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required');
  return { url: url.replace(/\/+$/, ''), serviceKey };
}

export async function supabaseSelect(table, query = '') {
  const { url, serviceKey } = getSupabaseAdminConfig();
  const response = await fetch(`${url}/rest/v1/${table}${query}`, {
    method: 'GET',
    headers: jsonHeaders(serviceKey),
    cache: 'no-store'
  });
  return parseSupabaseResponse(response);
}

export async function supabaseInsert(table, rows) {
  const { url, serviceKey } = getSupabaseAdminConfig();
  const response = await fetch(`${url}/rest/v1/${table}`, {
    method: 'POST',
    headers: jsonHeaders(serviceKey),
    body: JSON.stringify(rows)
  });
  return parseSupabaseResponse(response);
}

export async function supabasePatch(table, query, patch) {
  const { url, serviceKey } = getSupabaseAdminConfig();
  const response = await fetch(`${url}/rest/v1/${table}${query}`, {
    method: 'PATCH',
    headers: jsonHeaders(serviceKey),
    body: JSON.stringify(patch)
  });
  return parseSupabaseResponse(response);
}

export async function supabaseDelete(table, query) {
  const { url, serviceKey } = getSupabaseAdminConfig();
  const response = await fetch(`${url}/rest/v1/${table}${query}`, {
    method: 'DELETE',
    headers: jsonHeaders(serviceKey)
  });
  return parseSupabaseResponse(response);
}

async function parseSupabaseResponse(response) {
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const message = data?.message || data?.error || `Supabase request failed with ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}
