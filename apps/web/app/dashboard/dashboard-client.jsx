'use client';

import { useMemo, useState } from 'react';
import { buildCurlSnippet, buildEnvSnippet, normalizeRouterBaseUrl } from '../../lib/endpoint-snippets.js';
import { getSupabaseBrowserClient } from '../../lib/supabase-browser.js';

const inputStyle = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: 8,
  border: '1px solid #d0d7de',
  fontSize: 14,
  boxSizing: 'border-box'
};

const labelStyle = {
  display: 'grid',
  gap: 6,
  fontSize: 14,
  fontWeight: 600
};

const cardStyle = {
  border: '1px solid #d0d7de',
  borderRadius: 16,
  padding: 20,
  background: '#fff',
  display: 'grid',
  gap: 16
};

const buttonStyle = {
  border: 0,
  borderRadius: 10,
  padding: '11px 14px',
  background: '#111827',
  color: '#fff',
  fontWeight: 700,
  cursor: 'pointer'
};

const codeStyle = {
  background: '#0f172a',
  color: '#e2e8f0',
  padding: 16,
  borderRadius: 12,
  overflowX: 'auto',
  whiteSpace: 'pre-wrap',
  fontSize: 13
};

export default function DashboardClient({ routerBaseUrl }) {
  const normalizedRouterBaseUrl = useMemo(() => normalizeRouterBaseUrl(routerBaseUrl), [routerBaseUrl]);
  const [providerForm, setProviderForm] = useState({
    display_name: 'My OpenAI-compatible Provider',
    base_url: 'https://api.openai.com',
    default_model: 'gpt-4o-mini',
    api_key: ''
  });
  const [keyName, setKeyName] = useState('Claude Code laptop');
  const [rawApiKey, setRawApiKey] = useState('');
  const [providerStatus, setProviderStatus] = useState(null);
  const [keyStatus, setKeyStatus] = useState(null);
  const [providerPending, setProviderPending] = useState(false);
  const [keyPending, setKeyPending] = useState(false);

  const envSnippet = buildEnvSnippet({ routerBaseUrl: normalizedRouterBaseUrl, apiKey: rawApiKey });
  const curlSnippet = buildCurlSnippet({ routerBaseUrl: normalizedRouterBaseUrl, apiKey: rawApiKey });

  function updateProviderField(field, value) {
    setProviderForm((current) => ({ ...current, [field]: value }));
  }

  async function authenticatedJsonHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    try {
      const supabase = getSupabaseBrowserClient();
      const { data } = await supabase.auth.getSession();
      const token = data?.session?.access_token;
      if (token) headers.Authorization = `Bearer ${token}`;
    } catch {
      // Missing client env should not break DEV_WORKSPACE_ID fallback.
    }
    return headers;
  }

  async function connectProvider(event) {
    event.preventDefault();
    setProviderPending(true);
    setProviderStatus(null);
    try {
      const response = await fetch('/api/providers', {
        method: 'POST',
        headers: await authenticatedJsonHeaders(),
        body: JSON.stringify({
          provider_type: 'openai_compatible',
          auth_method: 'api_key',
          ...providerForm
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error?.message || 'Failed to connect provider');
      setProviderStatus({ type: 'success', message: `Provider connected: ${data.display_name}` });
      setProviderForm((current) => ({ ...current, api_key: '' }));
    } catch (error) {
      setProviderStatus({ type: 'error', message: error.message || 'Network error connecting provider' });
    } finally {
      setProviderPending(false);
    }
  }

  async function generateKey(event) {
    event.preventDefault();
    setKeyPending(true);
    setKeyStatus(null);
    try {
      const response = await fetch('/api/endpoint/keys', {
        method: 'POST',
        headers: await authenticatedJsonHeaders(),
        body: JSON.stringify({ name: keyName })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error?.message || 'Failed to generate API key');
      setRawApiKey(data.raw_key);
      setKeyStatus({ type: 'success', message: 'Your key was generated. Copy it now. It will not be shown again.' });
    } catch (error) {
      setKeyStatus({ type: 'error', message: error.message || 'Network error generating API key' });
    } finally {
      setKeyPending(false);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <section style={cardStyle}>
        <strong>Authenticated mode</strong>
        <p style={{ margin: 0, color: '#4b5563' }}>Log in to resolve workspace from your Supabase session. Local dev can still use DEV_WORKSPACE_ID.</p>
        <div style={{ display: 'flex', gap: 12 }}>
          <a href="/login">Log in</a>
          <a href="/signup">Sign up</a>
        </div>
      </section>

      <section style={cardStyle}>
        <div>
          <h2 style={{ margin: 0 }}>Connect provider</h2>
          <p style={{ margin: '6px 0 0', color: '#4b5563' }}>Add a generic OpenAI-compatible provider.</p>
        </div>
        <form onSubmit={connectProvider} style={{ display: 'grid', gap: 14 }}>
          <label style={labelStyle}>
            Provider name
            <input style={inputStyle} value={providerForm.display_name} onChange={(event) => updateProviderField('display_name', event.target.value)} />
          </label>
          <label style={labelStyle}>
            Base URL
            <input style={inputStyle} value={providerForm.base_url} onChange={(event) => updateProviderField('base_url', event.target.value)} placeholder="https://api.example.com" />
          </label>
          <label style={labelStyle}>
            Default model
            <input style={inputStyle} value={providerForm.default_model} onChange={(event) => updateProviderField('default_model', event.target.value)} placeholder="gpt-4o-mini" />
          </label>
          <label style={labelStyle}>
            Provider API key
            <input style={inputStyle} type="password" value={providerForm.api_key} onChange={(event) => updateProviderField('api_key', event.target.value)} placeholder="sk-..." />
          </label>
          <button style={buttonStyle} disabled={providerPending} type="submit">{providerPending ? 'Connecting…' : 'Connect provider'}</button>
        </form>
        {providerStatus ? <StatusMessage status={providerStatus} /> : null}
      </section>

      <section style={cardStyle}>
        <div>
          <h2 style={{ margin: 0 }}>Generate router API key</h2>
          <p style={{ margin: '6px 0 0', color: '#4b5563' }}>The raw key is shown once. Copy it before leaving this page.</p>
        </div>
        <form onSubmit={generateKey} style={{ display: 'grid', gap: 14 }}>
          <label style={labelStyle}>
            Key name
            <input style={inputStyle} value={keyName} onChange={(event) => setKeyName(event.target.value)} />
          </label>
          <button style={buttonStyle} disabled={keyPending} type="submit">{keyPending ? 'Generating…' : 'Generate API key'}</button>
        </form>
        {keyStatus ? <StatusMessage status={keyStatus} /> : null}
        {rawApiKey ? <pre style={codeStyle}>{rawApiKey}</pre> : null}
      </section>

      <section style={cardStyle}>
        <div>
          <h2 style={{ margin: 0 }}>Endpoint config</h2>
          <p style={{ margin: '6px 0 0', color: '#4b5563' }}>Router base URL: <code>{normalizedRouterBaseUrl}</code></p>
        </div>
        <div>
          <h3>Environment</h3>
          <pre style={codeStyle}>{envSnippet}</pre>
        </div>
        <div>
          <h3>Test request</h3>
          <pre style={codeStyle}>{curlSnippet}</pre>
        </div>
      </section>
    </div>
  );
}

function StatusMessage({ status }) {
  const isError = status.type === 'error';
  return (
    <div style={{
      borderRadius: 10,
      padding: '10px 12px',
      background: isError ? '#fef2f2' : '#ecfdf5',
      color: isError ? '#991b1b' : '#065f46',
      border: `1px solid ${isError ? '#fecaca' : '#a7f3d0'}`
    }}>
      {status.message}
    </div>
  );
}
