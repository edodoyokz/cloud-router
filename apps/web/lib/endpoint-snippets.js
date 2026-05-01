const API_KEY_PLACEHOLDER = '<generate-an-api-key-first>';

export function normalizeRouterBaseUrl(value) {
  const fallback = 'http://localhost:8080';
  const raw = String(value || fallback).trim() || fallback;
  return raw.replace(/\/+$/, '');
}

function snippetContext({ routerBaseUrl, apiKey }) {
  const base = normalizeRouterBaseUrl(routerBaseUrl);
  return {
    routerBaseUrl: base,
    openaiBaseUrl: `${base}/v1`,
    apiKey: apiKey || API_KEY_PLACEHOLDER,
    model: 'auto'
  };
}

export function buildEnvSnippet({ routerBaseUrl, apiKey }) {
  const { openaiBaseUrl, apiKey: key, model } = snippetContext({ routerBaseUrl, apiKey });
  return `export OPENAI_API_KEY="${key}"\nexport OPENAI_BASE_URL="${openaiBaseUrl}"\nexport OPENAI_API_BASE="${openaiBaseUrl}"\nexport NUSANEXUS_MODEL="${model}"`;
}

export function buildCurlSnippet({ routerBaseUrl, apiKey }) {
  const { routerBaseUrl: base, apiKey: key, model } = snippetContext({ routerBaseUrl, apiKey });
  return `curl ${base}/v1/chat/completions \\\n  -H "Authorization: Bearer ${key}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"model":"${model}","messages":[{"role":"user","content":"Hello from NusaNexus Router"}]}'`;
}

export function buildClaudeCodeSnippet({ routerBaseUrl, apiKey }) {
  const { openaiBaseUrl, apiKey: key, model } = snippetContext({ routerBaseUrl, apiKey });
  return `# Claude Code / OpenAI-compatible env\nexport OPENAI_API_KEY="${key}"\nexport OPENAI_BASE_URL="${openaiBaseUrl}"\nexport ANTHROPIC_BASE_URL="${openaiBaseUrl}"\nexport NUSANEXUS_MODEL="${model}"`;
}

export function buildCodexSnippet({ routerBaseUrl, apiKey }) {
  const { openaiBaseUrl, apiKey: key, model } = snippetContext({ routerBaseUrl, apiKey });
  return `export OPENAI_API_KEY="${key}"\nexport OPENAI_BASE_URL="${openaiBaseUrl}"\nexport NUSANEXUS_MODEL="${model}"\ncodex`;
}

export function buildOpenClawSnippet({ routerBaseUrl, apiKey }) {
  const { openaiBaseUrl, apiKey: key, model } = snippetContext({ routerBaseUrl, apiKey });
  return `export OPENAI_API_KEY="${key}"\nexport OPENAI_BASE_URL="${openaiBaseUrl}"\nexport NUSANEXUS_MODEL="${model}"\nopenclaw`;
}

export function buildCursorSnippet({ routerBaseUrl, apiKey }) {
  const { openaiBaseUrl, apiKey: key, model } = snippetContext({ routerBaseUrl, apiKey });
  return JSON.stringify({
    openaiApiKey: key,
    openaiBaseUrl,
    model
  }, null, 2);
}

export function buildOnboardingSnippets({ routerBaseUrl, apiKey }) {
  const input = { routerBaseUrl, apiKey };
  return [
    {
      id: 'env',
      label: 'Generic env',
      description: 'OpenAI-compatible environment variables for CLIs and SDKs.',
      language: 'bash',
      content: buildEnvSnippet(input)
    },
    {
      id: 'curl',
      label: 'cURL test',
      description: 'Quick smoke test for the non-streaming chat completions endpoint.',
      language: 'bash',
      content: buildCurlSnippet(input)
    },
    {
      id: 'claude-code',
      label: 'Claude Code',
      description: 'Env-first setup for OpenAI-compatible Claude Code configurations. Support varies by local setup/version.',
      language: 'bash',
      content: buildClaudeCodeSnippet(input)
    },
    {
      id: 'codex',
      label: 'Codex',
      description: 'Start Codex with OpenAI-compatible environment variables pointed at NusaNexus Router.',
      language: 'bash',
      content: buildCodexSnippet(input)
    },
    {
      id: 'openclaw',
      label: 'OpenClaw',
      description: 'Start OpenClaw with OpenAI-compatible environment variables pointed at NusaNexus Router.',
      language: 'bash',
      content: buildOpenClawSnippet(input)
    },
    {
      id: 'cursor',
      label: 'Cursor',
      description: 'Use these values in Cursor custom OpenAI-compatible settings. You can also use OPENAI_API_KEY and OPENAI_BASE_URL env vars.',
      language: 'json',
      content: buildCursorSnippet(input)
    }
  ];
}
