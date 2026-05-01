'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
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

function draftStepsFromPreset(presetData) {
  return (presetData?.steps || []).map((step) => ({
    provider_connection_id: step.provider_connection_id,
    display_name: step.display_name,
    status: step.status,
    health: step.health,
    model_alias: step.model_alias || ''
  }));
}

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
  const [providers, setProviders] = useState([]);
  const [apiKeys, setApiKeys] = useState([]);
  const [managementStatus, setManagementStatus] = useState(null);
  const [loadingResources, setLoadingResources] = useState(false);
  const [pendingActionId, setPendingActionId] = useState(null);
  const [usagePeriod, setUsagePeriod] = useState('today');
  const [usage, setUsage] = useState(null);
  const [usageStatus, setUsageStatus] = useState(null);
  const [loadingUsage, setLoadingUsage] = useState(false);
  const [preset, setPreset] = useState(null);
  const [presetDraftSteps, setPresetDraftSteps] = useState([]);
  const [presetStatus, setPresetStatus] = useState(null);
  const [loadingPreset, setLoadingPreset] = useState(false);
  const [savingPreset, setSavingPreset] = useState(false);
  const [addPresetProviderId, setAddPresetProviderId] = useState('');
  const [addPresetModelAlias, setAddPresetModelAlias] = useState('');
  const [workspaceContext, setWorkspaceContext] = useState(null);
  const [workspaceStatus, setWorkspaceStatus] = useState(null);
  const [loadingWorkspace, setLoadingWorkspace] = useState(false);

  const envSnippet = buildEnvSnippet({ routerBaseUrl: normalizedRouterBaseUrl, apiKey: rawApiKey });
  const curlSnippet = buildCurlSnippet({ routerBaseUrl: normalizedRouterBaseUrl, apiKey: rawApiKey });

  function updateProviderField(field, value) {
    setProviderForm((current) => ({ ...current, [field]: value }));
  }

  const authenticatedJsonHeaders = useCallback(async function authenticatedJsonHeaders() {
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
  }, []);

  const loadWorkspaceContext = useCallback(async function loadWorkspaceContext() {
    setLoadingWorkspace(true);
    setWorkspaceStatus(null);
    try {
      const response = await fetch('/api/workspaces/current', {
        headers: await authenticatedJsonHeaders()
      });
      const data = await parseJsonResponse(response, 'Failed to load workspace');
      setWorkspaceContext(data);
    } catch (error) {
      setWorkspaceStatus({ type: 'error', message: error.message || 'Failed to load workspace' });
    } finally {
      setLoadingWorkspace(false);
    }
  }, [authenticatedJsonHeaders]);

  const loadResources = useCallback(async function loadResources() {
    setLoadingResources(true);
    setManagementStatus(null);
    try {
      const headers = await authenticatedJsonHeaders();
      const [providerResponse, keyResponse] = await Promise.all([
        fetch('/api/providers', { headers }),
        fetch('/api/endpoint/keys', { headers })
      ]);
      const [providerData, keyData] = await Promise.all([
        parseJsonResponse(providerResponse, 'Failed to load providers'),
        parseJsonResponse(keyResponse, 'Failed to load API keys')
      ]);
      setProviders(providerData);
      setApiKeys(keyData);
    } catch (error) {
      setManagementStatus({ type: 'error', message: error.message || 'Failed to load dashboard resources' });
    } finally {
      setLoadingResources(false);
    }
  }, [authenticatedJsonHeaders]);

  useEffect(() => {
    let cancelled = false;

    async function loadInitialWorkspace() {
      try {
        const headers = await authenticatedJsonHeaders();
        if (cancelled) return;
        setLoadingWorkspace(true);
        setWorkspaceStatus(null);

        const response = await fetch('/api/workspaces/current', { headers });
        const data = await parseJsonResponse(response, 'Failed to load workspace');
        if (cancelled) return;
        setWorkspaceContext(data);
      } catch (error) {
        if (!cancelled) setWorkspaceStatus({ type: 'error', message: error.message || 'Failed to load workspace' });
      } finally {
        if (!cancelled) setLoadingWorkspace(false);
      }
    }

    loadInitialWorkspace();

    return () => {
      cancelled = true;
    };
  }, [authenticatedJsonHeaders]);

  useEffect(() => {
    let cancelled = false;

    async function loadInitialResources() {
      const headers = await authenticatedJsonHeaders();
      if (cancelled) return;

      setLoadingResources(true);
      setManagementStatus(null);
      try {
        const [providerResponse, keyResponse] = await Promise.all([
          fetch('/api/providers', { headers }),
          fetch('/api/endpoint/keys', { headers })
        ]);
        const [providerData, keyData] = await Promise.all([
          parseJsonResponse(providerResponse, 'Failed to load providers'),
          parseJsonResponse(keyResponse, 'Failed to load API keys')
        ]);
        if (cancelled) return;
        setProviders(providerData);
        setApiKeys(keyData);
      } catch (error) {
        if (cancelled) return;
        setManagementStatus({ type: 'error', message: error.message || 'Failed to load dashboard resources' });
      } finally {
        if (cancelled) return;
        setLoadingResources(false);
      }
    }

    loadInitialResources();

    return () => {
      cancelled = true;
    };
  }, [authenticatedJsonHeaders]);

  const loadUsage = useCallback(async function loadUsage(period = usagePeriod) {
    setLoadingUsage(true);
    setUsageStatus(null);
    try {
      const response = await fetch(`/api/usage?period=${encodeURIComponent(period)}&limit=50`, {
        headers: await authenticatedJsonHeaders()
      });
      const data = await parseJsonResponse(response, 'Failed to load usage');
      setUsage(data);
    } catch (error) {
      setUsageStatus({ type: 'error', message: error.message || 'Failed to load usage' });
    } finally {
      setLoadingUsage(false);
    }
  }, [authenticatedJsonHeaders, usagePeriod]);

  useEffect(() => {
    let cancelled = false;

    async function loadInitialUsage() {
      try {
        const headers = await authenticatedJsonHeaders();
        if (cancelled) return;
        setLoadingUsage(true);
        setUsageStatus(null);

        const response = await fetch(`/api/usage?period=${encodeURIComponent(usagePeriod)}&limit=50`, { headers });
        const data = await parseJsonResponse(response, 'Failed to load usage');
        if (cancelled) return;
        setUsage(data);
      } catch (error) {
        if (!cancelled) setUsageStatus({ type: 'error', message: error.message || 'Failed to load usage' });
      } finally {
        if (!cancelled) setLoadingUsage(false);
      }
    }

    loadInitialUsage();

    return () => {
      cancelled = true;
    };
  }, [authenticatedJsonHeaders, usagePeriod]);

  const loadPreset = useCallback(async function loadPreset() {
    setLoadingPreset(true);
    setPresetStatus(null);
    try {
      const response = await fetch('/api/presets/default', {
        headers: await authenticatedJsonHeaders()
      });
      const data = await parseJsonResponse(response, 'Failed to load default preset');
      setPreset(data);
      setPresetDraftSteps(draftStepsFromPreset(data));
    } catch (error) {
      setPresetStatus({ type: 'error', message: error.message || 'Failed to load default preset' });
    } finally {
      setLoadingPreset(false);
    }
  }, [authenticatedJsonHeaders]);

  useEffect(() => {
    let cancelled = false;

    async function loadInitialPreset() {
      try {
        const headers = await authenticatedJsonHeaders();
        if (cancelled) return;
        setLoadingPreset(true);
        setPresetStatus(null);

        const response = await fetch('/api/presets/default', { headers });
        const data = await parseJsonResponse(response, 'Failed to load default preset');
        if (cancelled) return;
        setPreset(data);
        setPresetDraftSteps(draftStepsFromPreset(data));
      } catch (error) {
        if (!cancelled) setPresetStatus({ type: 'error', message: error.message || 'Failed to load default preset' });
      } finally {
        if (!cancelled) setLoadingPreset(false);
      }
    }

    loadInitialPreset();

    return () => {
      cancelled = true;
    };
  }, [authenticatedJsonHeaders]);

  function updateDraftModelAlias(index, value) {
    setPresetDraftSteps((current) => current.map((step, stepIndex) => (
      stepIndex === index ? { ...step, model_alias: value } : step
    )));
  }

  function moveDraftStep(index, direction) {
    setPresetDraftSteps((current) => {
      const next = [...current];
      const target = index + direction;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function removeDraftStep(index) {
    setPresetDraftSteps((current) => current.filter((_, stepIndex) => stepIndex !== index));
  }

  function resetPresetDraft() {
    setPresetDraftSteps(draftStepsFromPreset(preset));
    setPresetStatus(null);
  }

  function addProviderToDraft() {
    const provider = providers.find((item) => item.id === addPresetProviderId);
    if (!provider) return;
    setPresetDraftSteps((current) => [
      ...current,
      {
        provider_connection_id: provider.id,
        display_name: provider.display_name,
        status: provider.status,
        health: provider.quota_state?.health || 'unknown',
        model_alias: addPresetModelAlias.trim()
      }
    ]);
    setAddPresetProviderId('');
    setAddPresetModelAlias('');
  }

  async function savePresetChain() {
    setSavingPreset(true);
    setPresetStatus(null);
    try {
      const response = await fetch('/api/presets/default', {
        method: 'PUT',
        headers: await authenticatedJsonHeaders(),
        body: JSON.stringify({
          steps: presetDraftSteps.map((step) => ({
            provider_connection_id: step.provider_connection_id,
            model_alias: step.model_alias?.trim() || null
          }))
        })
      });
      const data = await parseJsonResponse(response, 'Failed to save default preset');
      setPreset(data);
      setPresetDraftSteps(draftStepsFromPreset(data));
      setPresetStatus({ type: 'success', message: 'Default fallback chain saved.' });
    } catch (error) {
      setPresetStatus({ type: 'error', message: error.message || 'Failed to save default preset' });
    } finally {
      setSavingPreset(false);
    }
  }

  function selectUsagePeriod(period) {
    setUsagePeriod(period);
  }

  async function signOut() {
    setWorkspaceStatus(null);
    try {
      const supabase = getSupabaseBrowserClient();
      await supabase.auth.signOut();
      window.location.href = '/login';
    } catch (error) {
      setWorkspaceStatus({ type: 'error', message: error.message || 'Failed to sign out' });
    }
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
      const data = await parseJsonResponse(response, 'Failed to connect provider');
      setProviderStatus({ type: 'success', message: `Provider connected: ${data.display_name}` });
      setProviderForm((current) => ({ ...current, api_key: '' }));
      await loadResources();
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
      const data = await parseJsonResponse(response, 'Failed to generate API key');
      setRawApiKey(data.raw_key);
      setKeyStatus({ type: 'success', message: 'Your key was generated. Copy it now. It will not be shown again.' });
      await loadResources();
    } catch (error) {
      setKeyStatus({ type: 'error', message: error.message || 'Network error generating API key' });
    } finally {
      setKeyPending(false);
    }
  }

  async function disconnectProvider(providerId) {
    setPendingActionId(`provider:${providerId}`);
    setManagementStatus(null);
    try {
      const response = await fetch(`/api/providers/${providerId}`, {
        method: 'DELETE',
        headers: await authenticatedJsonHeaders()
      });
      await parseJsonResponse(response, 'Failed to disconnect provider');
      setManagementStatus({ type: 'success', message: 'Provider disconnected.' });
      await loadResources();
    } catch (error) {
      setManagementStatus({ type: 'error', message: error.message || 'Failed to disconnect provider' });
    } finally {
      setPendingActionId(null);
    }
  }

  async function checkProviderHealth(providerId) {
    setPendingActionId(`provider-check:${providerId}`);
    setManagementStatus(null);
    try {
      const response = await fetch(`/api/providers/${providerId}/check`, {
        method: 'POST',
        headers: await authenticatedJsonHeaders()
      });
      const data = await parseJsonResponse(response, 'Failed to check provider health');
      setManagementStatus({
        type: data.health === 'healthy' ? 'success' : 'error',
        message: data.message || 'Provider health check completed'
      });
      await loadResources();
    } catch (error) {
      setManagementStatus({ type: 'error', message: error.message || 'Failed to check provider health' });
    } finally {
      setPendingActionId(null);
    }
  }

  async function revokeApiKey(keyId) {
    setPendingActionId(`key:${keyId}`);
    setManagementStatus(null);
    try {
      const response = await fetch(`/api/endpoint/keys/${keyId}`, {
        method: 'DELETE',
        headers: await authenticatedJsonHeaders()
      });
      await parseJsonResponse(response, 'Failed to revoke API key');
      setManagementStatus({ type: 'success', message: 'API key revoked.' });
      await loadResources();
    } catch (error) {
      setManagementStatus({ type: 'error', message: error.message || 'Failed to revoke API key' });
    } finally {
      setPendingActionId(null);
    }
  }

  const draftProviderIds = new Set(presetDraftSteps.map((step) => step.provider_connection_id));
  const availablePresetProviders = providers.filter((provider) => (
    provider.status !== 'disconnected' && !draftProviderIds.has(provider.id)
  ));

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <section style={cardStyle}>
        <div>
          <h2 style={{ margin: 0 }}>Workspace</h2>
          <p style={{ margin: '6px 0 0', color: '#4b5563' }}>Current control-plane workspace context.</p>
        </div>

        {workspaceStatus ? <StatusMessage status={workspaceStatus} /> : null}
        {loadingWorkspace ? <p>Loading workspace…</p> : null}

        {workspaceContext ? (
          <div style={{ display: 'grid', gap: 8 }}>
            <span>Mode: {workspaceContext.auth_mode}</span>
            <span>Workspace: {workspaceContext.name}</span>
            <span>Workspace ID: <code>{workspaceContext.id}</code></span>
            {workspaceContext.slug ? <span>Slug: {workspaceContext.slug}</span> : null}
            <span>Role: {workspaceContext.role}</span>
            {workspaceContext.user?.email ? <span>Signed in as: {workspaceContext.user.email}</span> : null}
            {workspaceContext.auth_mode === 'dev_fallback' ? <p style={{ margin: 0, color: '#92400e' }}>Using DEV_WORKSPACE_ID fallback. Log in to use an authenticated workspace.</p> : null}
          </div>
        ) : null}

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {workspaceContext?.auth_mode === 'authenticated' ? (
            <button style={buttonStyle} type="button" onClick={signOut}>Log out</button>
          ) : (
            <>
              <a href="/login">Log in</a>
              <a href="/signup">Sign up</a>
            </>
          )}
          <button style={{ ...buttonStyle, background: '#e5e7eb', color: '#111827' }} type="button" onClick={loadWorkspaceContext} disabled={loadingWorkspace}>
            Refresh workspace
          </button>
        </div>
      </section>

      {managementStatus ? <StatusMessage status={managementStatus} /> : null}

      <section style={cardStyle}>
        <div>
          <h2 style={{ margin: 0 }}>Usage</h2>
          <p style={{ margin: '6px 0 0', color: '#4b5563' }}>Workspace usage from router requests.</p>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {[
            ['today', 'Today'],
            ['7d', '7 days'],
            ['30d', '30 days']
          ].map(([period, label]) => (
            <button
              key={period}
              type="button"
              onClick={() => selectUsagePeriod(period)}
              style={{
                ...buttonStyle,
                background: usagePeriod === period ? '#111827' : '#e5e7eb',
                color: usagePeriod === period ? '#fff' : '#111827'
              }}
            >
              {label}
            </button>
          ))}
          <button type="button" style={buttonStyle} onClick={() => loadUsage()} disabled={loadingUsage}>
            {loadingUsage ? 'Refreshing…' : 'Refresh usage'}
          </button>
        </div>

        {usageStatus ? <StatusMessage status={usageStatus} /> : null}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
          <StatCard label="Requests" value={formatNumber(usage?.summary?.total_requests)} />
          <StatCard label="Total tokens" value={formatNumber(usage?.summary?.total_tokens)} />
          <StatCard label="Prompt tokens" value={formatNumber(usage?.summary?.prompt_tokens)} />
          <StatCard label="Completion tokens" value={formatNumber(usage?.summary?.completion_tokens)} />
          <StatCard label="Success rate" value={formatPercent(usage?.summary?.success_rate)} />
          <StatCard label="Fallbacks" value={formatNumber(usage?.summary?.fallback_count)} />
          <StatCard label="Failures" value={formatNumber(usage?.summary?.failed_count)} />
        </div>

        <div>
          <h3>Recent events</h3>
          {loadingUsage ? <p>Loading usage…</p> : null}
          {!loadingUsage && (!usage?.events || usage.events.length === 0) ? <p style={{ color: '#4b5563' }}>No usage events for this period yet.</p> : null}
          <div style={{ display: 'grid', gap: 12 }}>
            {(usage?.events || []).map((event) => (
              <div key={event.id} style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 14, display: 'grid', gap: 6 }}>
                <strong>{event.status}</strong>
                <span>Requested: {event.model_requested || '—'}</span>
                <span>Resolved: {event.model_resolved || '—'}</span>
                <span>Tokens: {formatNumber(event.total_tokens)} total / {formatNumber(event.prompt_tokens)} prompt / {formatNumber(event.completion_tokens)} completion</span>
                <span>Error: {event.error_code || '—'}</span>
                <span>Created: {formatDate(event.created_at)}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section style={cardStyle}>
        <div>
          <h2 style={{ margin: 0 }}>Connected providers</h2>
          <p style={{ margin: '6px 0 0', color: '#4b5563' }}>Providers available to your default routing preset.</p>
        </div>
        {loadingResources ? <p>Loading providers…</p> : null}
        {providers.length === 0 && !loadingResources ? <p style={{ color: '#4b5563' }}>No providers yet.</p> : null}
        <div style={{ display: 'grid', gap: 12 }}>
          {providers.map((provider) => (
            <div key={provider.id} style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 14, display: 'grid', gap: 8 }}>
              <strong>{provider.display_name}</strong>
              <span>Status: {provider.status}</span>
              <span>Type: {provider.provider_type}</span>
              <span>Base URL: {provider.metadata?.base_url || '—'}</span>
              <span>Default model: {provider.metadata?.default_model || '—'}</span>
              <span>Health: {provider.quota_state?.health || 'unknown'}</span>
              <span>Last checked: {formatDate(provider.last_checked_at)}</span>
              {provider.quota_state?.last_error_message ? <span>Last error: {provider.quota_state.last_error_message}</span> : null}
              <span>Created: {formatDate(provider.created_at)}</span>
              {provider.status !== 'disconnected' ? (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button style={buttonStyle} disabled={pendingActionId === `provider-check:${provider.id}`} onClick={() => checkProviderHealth(provider.id)} type="button">
                    {pendingActionId === `provider-check:${provider.id}` ? 'Checking…' : 'Check health'}
                  </button>
                  <button style={buttonStyle} disabled={pendingActionId === `provider:${provider.id}`} onClick={() => disconnectProvider(provider.id)} type="button">
                    {pendingActionId === `provider:${provider.id}` ? 'Disconnecting…' : 'Disconnect provider'}
                  </button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </section>

      <section style={cardStyle}>
        <div>
          <h2 style={{ margin: 0 }}>Default fallback chain</h2>
          <p style={{ margin: '6px 0 0', color: '#4b5563' }}>Router tries providers in this order for model <code>auto</code>.</p>
        </div>

        {presetStatus ? <StatusMessage status={presetStatus} /> : null}
        {loadingPreset ? <p>Loading default preset…</p> : null}

        <div style={{ display: 'grid', gap: 12 }}>
          {presetDraftSteps.length === 0 && !loadingPreset ? <p style={{ color: '#4b5563' }}>No providers in the fallback chain yet.</p> : null}
          {presetDraftSteps.map((step, index) => (
            <div key={step.provider_connection_id} style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 14, display: 'grid', gap: 10 }}>
              <strong>#{index + 1} {step.display_name}</strong>
              <span>Status: {step.status}</span>
              <span>Health: {step.health || 'unknown'}</span>
              {step.status === 'error' ? <span style={{ color: '#92400e' }}>Warning: this provider is currently marked error.</span> : null}
              <label style={labelStyle}>
                Model override optional
                <input
                  style={inputStyle}
                  value={step.model_alias || ''}
                  onChange={(event) => updateDraftModelAlias(index, event.target.value)}
                  placeholder="provider default"
                />
              </label>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button style={buttonStyle} type="button" onClick={() => moveDraftStep(index, -1)} disabled={index === 0}>Move up</button>
                <button style={buttonStyle} type="button" onClick={() => moveDraftStep(index, 1)} disabled={index === presetDraftSteps.length - 1}>Move down</button>
                <button style={buttonStyle} type="button" onClick={() => removeDraftStep(index)}>Remove</button>
              </div>
            </div>
          ))}
        </div>

        <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 14, display: 'grid', gap: 12 }}>
          <strong>Add provider to chain</strong>
          <label style={labelStyle}>
            Provider
            <select style={inputStyle} value={addPresetProviderId} onChange={(event) => setAddPresetProviderId(event.target.value)}>
              <option value="">Select provider…</option>
              {availablePresetProviders.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.display_name} — {provider.status} / {provider.quota_state?.health || 'unknown'}
                </option>
              ))}
            </select>
          </label>
          <label style={labelStyle}>
            Model override optional
            <input
              style={inputStyle}
              value={addPresetModelAlias}
              onChange={(event) => setAddPresetModelAlias(event.target.value)}
              placeholder="provider default"
            />
          </label>
          <button style={buttonStyle} type="button" onClick={addProviderToDraft} disabled={!addPresetProviderId}>Add to chain</button>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button style={buttonStyle} type="button" onClick={savePresetChain} disabled={savingPreset}>
            {savingPreset ? 'Saving…' : 'Save chain'}
          </button>
          <button style={{ ...buttonStyle, background: '#e5e7eb', color: '#111827' }} type="button" onClick={resetPresetDraft} disabled={savingPreset}>
            Reset changes
          </button>
          <button style={{ ...buttonStyle, background: '#e5e7eb', color: '#111827' }} type="button" onClick={loadPreset} disabled={loadingPreset || savingPreset}>
            Refresh chain
          </button>
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
          <h2 style={{ margin: 0 }}>Router API keys</h2>
          <p style={{ margin: '6px 0 0', color: '#4b5563' }}>Raw keys are shown only once when generated.</p>
        </div>
        {loadingResources ? <p>Loading API keys…</p> : null}
        {apiKeys.length === 0 && !loadingResources ? <p style={{ color: '#4b5563' }}>No API keys yet.</p> : null}
        <div style={{ display: 'grid', gap: 12 }}>
          {apiKeys.map((key) => (
            <div key={key.id} style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 14, display: 'grid', gap: 8 }}>
              <strong>{key.name}</strong>
              <span>Prefix: <code>{key.prefix}</code></span>
              <span>Created: {formatDate(key.created_at)}</span>
              <span>Last used: {formatDate(key.last_used_at)}</span>
              <span>Status: {key.revoked_at ? `revoked at ${formatDate(key.revoked_at)}` : 'active'}</span>
              {!key.revoked_at ? (
                <button style={buttonStyle} disabled={pendingActionId === `key:${key.id}`} onClick={() => revokeApiKey(key.id)} type="button">
                  {pendingActionId === `key:${key.id}` ? 'Revoking…' : 'Revoke key'}
                </button>
              ) : null}
            </div>
          ))}
        </div>
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

function formatPercent(value) {
  return `${Math.round(Number(value || 0) * 100)}%`;
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString();
}

function formatDate(value) {
  if (!value) return 'Never';
  return new Date(value).toLocaleString();
}

async function parseJsonResponse(response, fallbackMessage) {
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error?.message || fallbackMessage);
  return data;
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

function StatCard({ label, value }) {
  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 14, background: '#f8fafc' }}>
      <div style={{ color: '#6b7280', fontSize: 13 }}>{label}</div>
      <strong style={{ fontSize: 22 }}>{value}</strong>
    </div>
  );
}
