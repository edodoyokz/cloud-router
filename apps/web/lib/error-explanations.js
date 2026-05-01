function explanation({ severity = 'error', title, explanation, likelyCause, nextActions = [] }) {
  return { severity, title, explanation, likelyCause, nextActions };
}

const errorCodeExplanations = {
  invalid_api_key: explanation({
    title: 'Invalid router API key',
    explanation: 'The request did not include a valid NusaNexus Router API key.',
    likelyCause: 'The key was copied incorrectly, revoked, missing, or sent to the wrong endpoint.',
    nextActions: [
      'Generate a new router API key in the dashboard if needed.',
      'Update your client Authorization header to use Bearer <router-api-key>.',
      'Confirm the request is sent to the NusaNexus Router base URL.'
    ]
  }),
  unsupported_streaming: explanation({
    title: 'Streaming is not supported yet',
    explanation: 'The client sent stream: true, but this MVP only supports non-streaming chat completions.',
    likelyCause: 'Your client is configured to request streaming responses.',
    nextActions: [
      'Disable streaming in the client configuration.',
      'Send non-streaming /v1/chat/completions requests.',
      'Retry the request with stream omitted or set to false.'
    ]
  }),
  preset_not_found: explanation({
    title: 'Default fallback chain not found',
    explanation: 'The router could not find a default routing preset for this workspace.',
    likelyCause: 'No provider has been connected yet, or the default fallback chain was removed.',
    nextActions: [
      'Connect at least one provider.',
      'Open Default fallback chain and save a valid chain.',
      'Confirm you are using an API key from the intended workspace.'
    ]
  }),
  provider_not_found: explanation({
    title: 'Provider in chain was not found',
    explanation: 'The saved fallback chain references a provider that is unavailable to the router.',
    likelyCause: 'The provider was disconnected, deleted, or is not active for this workspace.',
    nextActions: [
      'Refresh connected providers.',
      'Remove unavailable providers from the default fallback chain.',
      'Reconnect or rotate credentials for the provider if needed.'
    ]
  }),
  provider_request_failed: explanation({
    title: 'Provider request failed',
    explanation: 'The selected provider could not complete the request.',
    likelyCause: 'The provider type, base URL, model, quota, or request payload may be incompatible.',
    nextActions: [
      'Run a provider health check.',
      'Confirm the provider base URL and default model.',
      'Try a different provider or add a backup to the fallback chain.'
    ]
  }),
  provider_credential_missing: explanation({
    title: 'Provider credential is missing or unreadable',
    explanation: 'The router could not decrypt or read the provider API key.',
    likelyCause: 'The credential was not saved correctly, the encryption key changed, or the provider needs reconnecting.',
    nextActions: [
      'Use Reconnect / rotate key on the provider card.',
      'Confirm ENCRYPTION_KEY is the same key used when credentials were stored.',
      'Run a provider health check after reconnecting.'
    ]
  }),
  fallback_exhausted: explanation({
    title: 'Fallback chain exhausted',
    explanation: 'All attempted providers failed or could not complete the request.',
    likelyCause: 'Every provider in the current fallback chain failed, timed out, or was rate-limited.',
    nextActions: [
      'Run health checks for providers in the default chain.',
      'Check provider credentials, quotas, and base URLs.',
      'Add a backup provider or reorder the fallback chain.'
    ]
  }),
  validation_error: explanation({
    title: 'Request validation failed',
    explanation: 'A dashboard or API request did not pass validation.',
    likelyCause: 'A required field is missing, malformed, or outside the supported MVP limits.',
    nextActions: [
      'Review the form fields and try again.',
      'Check that IDs, model names, URLs, and numeric fields are valid.',
      'Refresh the dashboard if the data looks stale.'
    ]
  }),
  persistence_error: explanation({
    title: 'Persistence error',
    explanation: 'The control plane could not read or write required data.',
    likelyCause: 'Supabase configuration, service-role access, or network connectivity may be unavailable.',
    nextActions: [
      'Check Supabase URL and service-role environment variables.',
      'Retry after confirming Supabase is reachable.',
      'Review server logs for the sanitized persistence error.'
    ]
  })
};

export function explainErrorCode(code, context = {}) {
  const normalized = typeof code === 'string' ? code.trim().toLowerCase() : '';
  if (normalized && errorCodeExplanations[normalized]) return errorCodeExplanations[normalized];

  if (!normalized) {
    return explanation({
      severity: context.status === 'fallback' ? 'warning' : 'error',
      title: 'No error code recorded',
      explanation: 'This event did not include a specific error code.',
      likelyCause: 'The request may have failed before structured error recording was available.',
      nextActions: [
        'Check provider health and the default fallback chain.',
        'Retry the request after confirming providers are active.',
        'Use recent timestamps to correlate with server logs if needed.'
      ]
    });
  }

  return explanation({
    title: 'Unknown error code',
    explanation: `The router recorded an unrecognized error code: ${normalized}.`,
    likelyCause: 'A newer or unexpected failure path was recorded.',
    nextActions: [
      'Check provider health and fallback-chain configuration.',
      'Retry the request after fixing obvious provider issues.',
      'Use the error code when checking logs or opening support notes.'
    ]
  });
}

export function explainUsageEvent(event) {
  const status = String(event?.status || '').toLowerCase();
  if (status === 'success') return null;

  if (status === 'fallback') {
    return explanation({
      severity: 'warning',
      title: 'Request succeeded after fallback',
      explanation: 'The first provider did not complete the request, but another provider in the chain succeeded.',
      likelyCause: 'A primary provider may be unhealthy, rate-limited, or temporarily unavailable.',
      nextActions: [
        'Run health checks for providers earlier in the chain.',
        'Review provider quotas and credentials.',
        'Keep a backup provider in the chain for resilience.'
      ]
    });
  }

  return explainErrorCode(event?.error_code, { status });
}

function messageIncludes(message, patterns) {
  const normalized = String(message || '').toLowerCase();
  return patterns.some((pattern) => normalized.includes(pattern));
}

export function explainProviderHealth(provider) {
  const health = String(provider?.quota_state?.health || 'unknown').toLowerCase();
  const message = provider?.quota_state?.last_error_message || '';

  if (health === 'healthy' || health === 'ok') return null;

  if (health === 'unknown') {
    return explanation({
      severity: 'warning',
      title: 'Provider health is unknown',
      explanation: 'This provider has not passed a health check yet.',
      likelyCause: 'The provider was recently added, reconnected, or has not been checked.',
      nextActions: [
        'Click Check health on this provider.',
        'Confirm the base URL, API key, and default model are correct.',
        'Save the provider in the fallback chain only after verifying it works.'
      ]
    });
  }

  if (messageIncludes(message, ['401', '403', 'unauthorized', 'forbidden'])) {
    return explanation({
      title: 'Provider credential or authorization failed',
      explanation: 'The provider rejected the health check as unauthorized.',
      likelyCause: 'The provider API key is invalid, expired, missing permissions, or belongs to the wrong account.',
      nextActions: [
        'Use Reconnect / rotate key to save a new provider API key.',
        'Confirm the key has access to the selected model.',
        'Run Check health again after rotating the API key.'
      ]
    });
  }

  if (messageIncludes(message, ['404', 'not found'])) {
    return explanation({
      title: 'Provider endpoint or model was not found',
      explanation: 'The health check reached the provider but the endpoint or model was not available.',
      likelyCause: 'The base URL may be wrong, or the default model does not exist for this provider.',
      nextActions: [
        'Confirm the provider base URL points to an OpenAI-compatible API root.',
        'Check the default model name.',
        'Reconnect the provider with the corrected base URL or model.'
      ]
    });
  }

  if (messageIncludes(message, ['429', 'rate limit', 'quota'])) {
    return explanation({
      title: 'Provider quota or rate limit reached',
      explanation: 'The provider rejected the health check because quota or rate limits may be exhausted.',
      likelyCause: 'The provider account may be out of credits or receiving too many requests.',
      nextActions: [
        'Check quota or billing in the provider dashboard.',
        'Wait for rate limits to reset.',
        'Add a backup provider to the default fallback chain.'
      ]
    });
  }

  if (messageIncludes(message, ['timeout', 'network', 'fetch failed'])) {
    return explanation({
      title: 'Provider network check failed',
      explanation: 'NusaNexus Router could not reliably reach the provider endpoint.',
      likelyCause: 'The base URL may be unreachable, blocked, or too slow to respond.',
      nextActions: [
        'Confirm the base URL is reachable from the deployment environment.',
        'Check for typos in the provider URL.',
        'Retry the health check after network issues are resolved.'
      ]
    });
  }

  return explanation({
    title: 'Provider health check failed',
    explanation: 'The provider did not pass the OpenAI-compatible health probe.',
    likelyCause: 'The base URL, API key, model, quota, or provider availability may be incorrect.',
    nextActions: [
      'Review the provider base URL and default model.',
      'Rotate the provider API key if needed.',
      'Add or move a healthy backup provider earlier in the fallback chain.'
    ]
  });
}
