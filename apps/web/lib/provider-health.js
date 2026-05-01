export function normalizeOpenAIBaseUrl(baseUrl) {
  const value = String(baseUrl || '').trim();
  if (!value) throw new Error('missing provider base URL');

  const parsed = new URL(value);
  parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/+$/, '');
}

export function buildChatCompletionsUrl(baseUrl) {
  return `${normalizeOpenAIBaseUrl(baseUrl)}/v1/chat/completions`;
}

export function sanitizeProviderFailure(error) {
  if (error?.name === 'AbortError') return 'Provider request timed out';
  return 'Provider request failed';
}

export async function runOpenAICompatibleHealthCheck({ baseUrl, apiKey, model, fetchImpl = fetch, timeoutMs = 10000 }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(buildChatCompletionsUrl(baseUrl), {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
        stream: false
      })
    });

    if (!response.ok) {
      return {
        ok: false,
        error_code: 'provider_check_failed',
        message: `Provider returned ${response.status}`
      };
    }

    const data = await response.json().catch(() => null);
    if (!data || typeof data !== 'object') {
      return {
        ok: false,
        error_code: 'provider_invalid_response',
        message: 'Provider returned an invalid response'
      };
    }

    return { ok: true, message: 'Provider check passed' };
  } catch (error) {
    return {
      ok: false,
      error_code: error?.name === 'AbortError' ? 'provider_check_timeout' : 'provider_check_failed',
      message: sanitizeProviderFailure(error)
    };
  } finally {
    clearTimeout(timeout);
  }
}
