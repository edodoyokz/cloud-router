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
