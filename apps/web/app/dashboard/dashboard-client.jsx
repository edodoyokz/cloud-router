'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { buildOnboardingSnippets, normalizeRouterBaseUrl } from '../../lib/endpoint-snippets.js';
import { ALLOWED_PROVIDER_TAGS, normalizeProviderTags, providerTagLabel } from '../../lib/provider-tags.js';
import { buildTagBasedFallbackSuggestion } from '../../lib/provider-routing-suggestions.js';
import { explainProviderHealth, explainUsageEvent } from '../../lib/error-explanations.js';
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

function formatInteger(value) {
  return new Intl.NumberFormat('en-US').format(Number(value || 0));
}

function maxMetric(rows, metric) {
  return Math.max(1, ...(Array.isArray(rows) ? rows.map((row) => Number(row?.[metric] || 0)) : []));
}

function MetricBar({ value, max, color = '#2563eb' }) {
  const width = Math.max(2, Math.round((Number(value || 0) / Math.max(1, Number(max || 1))) * 100));
  return (
    <div style={{ height: 8, borderRadius: 999, background: '#e5e7eb', overflow: 'hidden' }}>
      <div style={{ width: `${width}%`, height: '100%', borderRadius: 999, background: color }} />
    </div>
  );
}

function UsageTrend({ buckets }) {
  const rows = Array.isArray(buckets) ? buckets : [];
  const maxRequests = maxMetric(rows, 'requests');

  if (rows.length === 0) return <p style={{ margin: 0, color: '#6b7280' }}>No usage buckets available yet.</p>;

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {rows.map((bucket) => (
        <div key={bucket.bucket} style={{ display: 'grid', gridTemplateColumns: '72px 1fr 92px', gap: 10, alignItems: 'center', fontSize: 13 }}>
          <span style={{ color: '#4b5563' }}>{bucket.label}</span>
          <MetricBar value={bucket.requests} max={maxRequests} />
          <span style={{ textAlign: 'right', fontWeight: 700 }}>{formatInteger(bucket.requests)} req</span>
          <span />
          <span style={{ color: '#6b7280' }}>{formatInteger(bucket.total_tokens)} tokens · {formatUsd(bucket.estimated_cost_usd)}</span>
          <span style={{ textAlign: 'right', color: '#6b7280' }}>{formatPercent(bucket.success_rate)}</span>
        </div>
      ))}
    </div>
  );
}

function ProviderBreakdown({ providers }) {
  const rows = Array.isArray(providers) ? providers : [];
  const maxRequests = maxMetric(rows, 'requests');

  if (rows.length === 0) return <p style={{ margin: 0, color: '#6b7280' }}>No provider usage yet.</p>;

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {rows.map((provider) => (
        <div key={provider.provider_connection_id || provider.display_name} style={{ display: 'grid', gap: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <strong>{provider.display_name}</strong>
            <span>{formatInteger(provider.requests)} req</span>
          </div>
          <MetricBar value={provider.requests} max={maxRequests} color="#16a34a" />
          <div style={{ color: '#6b7280', fontSize: 13 }}>
            {formatInteger(provider.total_tokens)} tokens · {formatUsd(provider.estimated_cost_usd)} · success {formatPercent(provider.success_rate)}
          </div>
        </div>
      ))}
    </div>
  );
}

function ModelBreakdown({ models }) {
  const rows = Array.isArray(models) ? models : [];
  const maxTokens = maxMetric(rows, 'total_tokens');

  if (rows.length === 0) return <p style={{ margin: 0, color: '#6b7280' }}>No model usage yet.</p>;

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {rows.map((model) => (
        <div key={model.model} style={{ display: 'grid', gap: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <strong>{model.model}</strong>
            <span>{formatInteger(model.total_tokens)} tokens</span>
          </div>
          <MetricBar value={model.total_tokens} max={maxTokens} color="#7c3aed" />
          <div style={{ color: '#6b7280', fontSize: 13 }}>
            {formatInteger(model.requests)} req · {formatUsd(model.estimated_cost_usd)} · success {formatPercent(model.success_rate)}
            {model.pricing_rule_missing_count ? ` · ${formatInteger(model.pricing_rule_missing_count)} missing pricing` : ''}
          </div>
        </div>
      ))}
    </div>
  );
}

function StatusBreakdown({ statuses }) {
  const rows = Array.isArray(statuses) ? statuses : [];
  const maxRequests = maxMetric(rows, 'requests');
  const colors = { success: '#16a34a', failed: '#dc2626', fallback: '#f59e0b', unknown: '#6b7280' };

  if (rows.length === 0) return <p style={{ margin: 0, color: '#6b7280' }}>No status usage yet.</p>;

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {rows.map((status) => (
        <div key={status.status} style={{ display: 'grid', gap: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <strong>{status.status}</strong>
            <span>{formatInteger(status.requests)} req · {formatPercent(status.percentage)}</span>
          </div>
          <MetricBar value={status.requests} max={maxRequests} color={colors[status.status] || colors.unknown} />
        </div>
      ))}
    </div>
  );
}

function ProviderTagChips({ tags }) {
  const normalized = normalizeProviderTags(tags);
  if (normalized.length === 0) return <span style={{ color: '#6b7280' }}>No tags</span>;
  return (
    <span style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {normalized.map((tag) => (
        <span key={tag} style={{ border: '1px solid #bfdbfe', background: '#eff6ff', color: '#1e40af', borderRadius: 999, padding: '2px 8px', fontSize: 12, fontWeight: 700 }}>
          {providerTagLabel(tag)}
        </span>
      ))}
    </span>
  );
}

function ProviderTagToggleGroup({ selectedTags, onToggle, disabled = false }) {
  const selected = normalizeProviderTags(selectedTags);
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {ALLOWED_PROVIDER_TAGS.map((tag) => {
        const active = selected.includes(tag);
        return (
          <button
            key={tag}
            type="button"
            onClick={() => onToggle(tag)}
            disabled={disabled}
            style={{
              border: `1px solid ${active ? '#2563eb' : '#d0d7de'}`,
              background: active ? '#eff6ff' : '#fff',
              color: active ? '#1e40af' : '#374151',
              borderRadius: 999,
              padding: '6px 10px',
              fontWeight: 700,
              cursor: disabled ? 'not-allowed' : 'pointer'
            }}
          >
            {providerTagLabel(tag)}
          </button>
        );
      })}
    </div>
  );
}

function ErrorExplanationPanel({ explanation, heading = 'Why this happened' }) {
  if (!explanation) return null;
  const isError = explanation.severity === 'error';
  const isWarning = explanation.severity === 'warning';
  const border = isError ? '#fecaca' : isWarning ? '#fde68a' : '#bfdbfe';
  const background = isError ? '#fef2f2' : isWarning ? '#fffbeb' : '#eff6ff';
  const color = isError ? '#991b1b' : isWarning ? '#92400e' : '#1e40af';

  return (
    <div style={{ border: `1px solid ${border}`, background, color, borderRadius: 12, padding: 12, display: 'grid', gap: 8 }}>
      <strong>{heading}</strong>
      <div>
        <strong>{explanation.title}</strong>
        <p style={{ margin: '4px 0 0' }}>{explanation.explanation}</p>
      </div>
      {explanation.likelyCause ? (
        <div>
          <strong>Likely cause</strong>
          <p style={{ margin: '4px 0 0' }}>{explanation.likelyCause}</p>
        </div>
      ) : null}
      {explanation.nextActions?.length > 0 ? (
        <div>
          <strong>Try this</strong>
          <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
            {explanation.nextActions.map((action) => <li key={action}>{action}</li>)}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function TagBasedSuggestionPanel({ suggestion, onApply }) {
  const steps = Array.isArray(suggestion?.steps) ? suggestion.steps : [];
  const excluded = Array.isArray(suggestion?.excluded) ? suggestion.excluded : [];

  return (
    <div style={{ border: '1px solid #bfdbfe', background: '#eff6ff', borderRadius: 12, padding: 14, display: 'grid', gap: 10 }}>
      <div>
        <strong>Tag-based suggestion</strong>
        <p style={{ margin: '4px 0 0', color: '#1e40af' }}>Primary providers first, then cheap/free, then backup. Applying this only changes the local draft.</p>
      </div>
      {steps.length === 0 ? <p style={{ margin: 0, color: '#4b5563' }}>No eligible providers for a tag-based suggestion yet.</p> : null}
      {steps.length > 0 ? (
        <ol style={{ margin: 0, paddingLeft: 22, display: 'grid', gap: 6 }}>
          {steps.map((step) => (
            <li key={step.provider_connection_id}>
              <strong>{step.display_name}</strong> — {step.suggestion_label} · {step.health || 'unknown'}{step.status === 'error' ? ' · status error' : ''}
            </li>
          ))}
        </ol>
      ) : null}
      {excluded.length > 0 ? (
        <details>
          <summary>Excluded providers</summary>
          <ul style={{ marginBottom: 0 }}>
            {excluded.map((provider) => (
              <li key={provider.id || provider.display_name}>{provider.display_name} — {provider.reason}</li>
            ))}
          </ul>
        </details>
      ) : null}
      <button style={buttonStyle} type="button" onClick={onApply} disabled={steps.length === 0}>Apply suggestion to draft</button>
    </div>
  );
}

export default function DashboardClient({ routerBaseUrl }) {
  const normalizedRouterBaseUrl = useMemo(() => normalizeRouterBaseUrl(routerBaseUrl), [routerBaseUrl]);
  const [providerForm, setProviderForm] = useState({
    display_name: 'My OpenAI-compatible Provider',
    base_url: 'https://api.openai.com',
    default_model: 'gpt-4o-mini',
    api_key: '',
    tags: []
  });
  const [keyName, setKeyName] = useState('Claude Code laptop');
  const [rawApiKey, setRawApiKey] = useState('');
  const [providerStatus, setProviderStatus] = useState(null);
  const [keyStatus, setKeyStatus] = useState(null);
  const [providerPending, setProviderPending] = useState(false);
  const [keyPending, setKeyPending] = useState(false);
  const [providers, setProviders] = useState([]);
  const [apiKeys, setApiKeys] = useState([]);
  const [providerTagDrafts, setProviderTagDrafts] = useState({});
  const [managementStatus, setManagementStatus] = useState(null);
  const [loadingResources, setLoadingResources] = useState(false);
  const [pendingActionId, setPendingActionId] = useState(null);
  const [reconnectProviderId, setReconnectProviderId] = useState(null);
  const [reconnectForm, setReconnectForm] = useState({
    display_name: '',
    base_url: '',
    default_model: '',
    api_key: ''
  });
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
  const [pricingRules, setPricingRules] = useState([]);
  const [loadingPricingRules, setLoadingPricingRules] = useState(false);
  const [pricingPending, setPricingPending] = useState(false);
  const [pricingStatus, setPricingStatus] = useState(null);
  const [pricingForm, setPricingForm] = useState({
    provider_connection_id: '',
    model_pattern: '',
    input_usd_per_1m_tokens: '',
    output_usd_per_1m_tokens: ''
  });
  const [onboarding, setOnboarding] = useState(null);
  const [loadingOnboarding, setLoadingOnboarding] = useState(false);
  const [onboardingStatus, setOnboardingStatus] = useState(null);

  const onboardingSnippets = buildOnboardingSnippets({ routerBaseUrl: normalizedRouterBaseUrl, apiKey: rawApiKey });
  const tagBasedSuggestion = useMemo(() => buildTagBasedFallbackSuggestion(providers), [providers]);
  const onboardingTargets = {
    connect_provider: 'connect-provider',
    check_provider_health: 'connected-providers',
    generate_router_key: 'generate-router-key',
    copy_client_snippet: 'endpoint-config',
    send_first_request: 'endpoint-config'
  };

  function updateProviderField(field, value) {
    setProviderForm((current) => ({ ...current, [field]: value }));
  }

  function providerTags(provider) {
    return normalizeProviderTags(provider?.metadata?.tags);
  }

  function toggleTagList(tags, tag) {
    const current = new Set(normalizeProviderTags(tags));
    if (current.has(tag)) current.delete(tag);
    else current.add(tag);
    return normalizeProviderTags(Array.from(current));
  }

  function toggleProviderFormTag(tag) {
    setProviderForm((current) => ({ ...current, tags: toggleTagList(current.tags, tag) }));
  }

  function providerTagDraft(provider) {
    return providerTagDrafts[provider.id] || providerTags(provider);
  }

  function toggleProviderDraftTag(provider, tag) {
    setProviderTagDrafts((current) => ({
      ...current,
      [provider.id]: toggleTagList(current[provider.id] || providerTags(provider), tag)
    }));
  }

  function startReconnect(provider) {
    setReconnectProviderId(provider.id);
    setReconnectForm({
      display_name: provider.display_name || '',
      base_url: provider.metadata?.base_url || '',
      default_model: provider.metadata?.default_model || '',
      api_key: ''
    });
    setManagementStatus(null);
  }

  function cancelReconnect() {
    setReconnectProviderId(null);
    setReconnectForm({ display_name: '', base_url: '', default_model: '', api_key: '' });
  }

  function updateReconnectField(field, value) {
    setReconnectForm((current) => ({ ...current, [field]: value }));
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

  const loadOnboarding = useCallback(async function loadOnboarding() {
    setLoadingOnboarding(true);
    setOnboardingStatus(null);
    try {
      const response = await fetch('/api/onboarding', {
        headers: await authenticatedJsonHeaders(),
        cache: 'no-store'
      });
      const data = await parseJsonResponse(response, 'Failed to load onboarding checklist');
      setOnboarding(data);
    } catch (error) {
      setOnboardingStatus({ type: 'error', message: error.message || 'Failed to load onboarding checklist' });
    } finally {
      setLoadingOnboarding(false);
    }
  }, [authenticatedJsonHeaders]);

  const updateOnboarding = useCallback(async function updateOnboarding(payload) {
    const response = await fetch('/api/onboarding', {
      method: 'PATCH',
      headers: await authenticatedJsonHeaders(),
      body: JSON.stringify(payload)
    });
    const data = await parseJsonResponse(response, 'Failed to update onboarding checklist');
    setOnboarding(data);
    return data;
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

  const loadPricingRules = useCallback(async function loadPricingRules() {
    setLoadingPricingRules(true);
    setPricingStatus(null);
    try {
      const response = await fetch('/api/pricing/rules', {
        headers: await authenticatedJsonHeaders(),
        cache: 'no-store'
      });
      const data = await parseJsonResponse(response, 'Failed to load pricing rules');
      setPricingRules(Array.isArray(data) ? data : []);
    } catch (error) {
      setPricingStatus({ type: 'error', message: error.message || 'Failed to load pricing rules' });
    } finally {
      setLoadingPricingRules(false);
    }
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

    async function loadInitialPricingRules() {
      try {
        const headers = await authenticatedJsonHeaders();
        if (cancelled) return;
        setLoadingPricingRules(true);
        setPricingStatus(null);

        const response = await fetch('/api/pricing/rules', {
          headers,
          cache: 'no-store'
        });
        const data = await parseJsonResponse(response, 'Failed to load pricing rules');
        if (cancelled) return;
        setPricingRules(Array.isArray(data) ? data : []);
      } catch (error) {
        if (!cancelled) setPricingStatus({ type: 'error', message: error.message || 'Failed to load pricing rules' });
      } finally {
        if (!cancelled) setLoadingPricingRules(false);
      }
    }

    loadInitialPricingRules();

    return () => {
      cancelled = true;
    };
  }, [authenticatedJsonHeaders]);

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

  useEffect(() => {
    let cancelled = false;

    async function loadInitialOnboarding() {
      try {
        const headers = await authenticatedJsonHeaders();
        if (cancelled) return;
        setLoadingOnboarding(true);
        setOnboardingStatus(null);

        const response = await fetch('/api/onboarding', {
          headers,
          cache: 'no-store'
        });
        const data = await parseJsonResponse(response, 'Failed to load onboarding checklist');
        if (cancelled) return;
        setOnboarding(data);
      } catch (error) {
        if (!cancelled) setOnboardingStatus({ type: 'error', message: error.message || 'Failed to load onboarding checklist' });
      } finally {
        if (!cancelled) setLoadingOnboarding(false);
      }
    }

    loadInitialOnboarding();

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

  function applyTagBasedSuggestion() {
    setPresetDraftSteps(tagBasedSuggestion.steps.map((step) => ({
      provider_connection_id: step.provider_connection_id,
      display_name: step.display_name,
      status: step.status,
      health: step.health,
      model_alias: ''
    })));
    setPresetStatus({ type: 'success', message: 'Suggested chain applied to draft. Review it, then Save chain.' });
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

  function updatePricingField(field, value) {
    setPricingForm((current) => ({ ...current, [field]: value }));
  }

  async function createPricingRule(event) {
    event.preventDefault();
    setPricingPending(true);
    setPricingStatus(null);
    try {
      const payload = {
        ...pricingForm,
        provider_connection_id: pricingForm.provider_connection_id || null
      };
      const response = await fetch('/api/pricing/rules', {
        method: 'POST',
        headers: await authenticatedJsonHeaders(),
        body: JSON.stringify(payload)
      });
      await parseJsonResponse(response, 'Failed to create pricing rule');
      setPricingForm({ provider_connection_id: '', model_pattern: '', input_usd_per_1m_tokens: '', output_usd_per_1m_tokens: '' });
      setPricingStatus({ type: 'success', message: 'Pricing rule added.' });
      await loadPricingRules();
      await loadUsage(usagePeriod);
    } catch (error) {
      setPricingStatus({ type: 'error', message: error.message || 'Failed to create pricing rule' });
    } finally {
      setPricingPending(false);
    }
  }

  async function disablePricingRule(ruleId) {
    setPendingActionId(`pricing:${ruleId}`);
    setPricingStatus(null);
    try {
      const response = await fetch(`/api/pricing/rules/${ruleId}`, {
        method: 'DELETE',
        headers: await authenticatedJsonHeaders()
      });
      await parseJsonResponse(response, 'Failed to disable pricing rule');
      setPricingStatus({ type: 'success', message: 'Pricing rule disabled.' });
      await loadPricingRules();
      await loadUsage(usagePeriod);
    } catch (error) {
      setPricingStatus({ type: 'error', message: error.message || 'Failed to disable pricing rule' });
    } finally {
      setPendingActionId(null);
    }
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
      await loadOnboarding();
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
      await loadOnboarding();
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
      await loadOnboarding();
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
      await loadOnboarding();
    } catch (error) {
      setManagementStatus({ type: 'error', message: error.message || 'Failed to check provider health' });
    } finally {
      setPendingActionId(null);
    }
  }

  async function saveProviderTags(provider) {
    setPendingActionId(`provider-tags:${provider.id}`);
    setManagementStatus(null);
    try {
      const response = await fetch(`/api/providers/${provider.id}/tags`, {
        method: 'PATCH',
        headers: await authenticatedJsonHeaders(),
        body: JSON.stringify({ tags: providerTagDraft(provider) })
      });
      await parseJsonResponse(response, 'Failed to save provider tags');
      setManagementStatus({ type: 'success', message: 'Provider tags saved.' });
      setProviderTagDrafts((current) => {
        const next = { ...current };
        delete next[provider.id];
        return next;
      });
      await loadResources();
      await loadPreset();
      await loadOnboarding();
    } catch (error) {
      setManagementStatus({ type: 'error', message: error.message || 'Failed to save provider tags' });
    } finally {
      setPendingActionId(null);
    }
  }

  async function reconnectProvider(providerId) {
    setPendingActionId(`provider-reconnect:${providerId}`);
    setManagementStatus(null);
    try {
      const response = await fetch(`/api/providers/${providerId}`, {
        method: 'PATCH',
        headers: await authenticatedJsonHeaders(),
        body: JSON.stringify(reconnectForm)
      });
      await parseJsonResponse(response, 'Failed to reconnect provider');
      setManagementStatus({ type: 'success', message: 'Provider reconnected. Run health check to verify.' });
      cancelReconnect();
      await loadResources();
      await loadPreset();
      await loadOnboarding();
    } catch (error) {
      setManagementStatus({ type: 'error', message: error.message || 'Failed to reconnect provider' });
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
      await loadOnboarding();
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

  async function handleCopySnippet(content) {
    try {
      await navigator.clipboard.writeText(content);
      try {
        await updateOnboarding({ completed_steps: ['copy_client_snippet'] });
        setOnboardingStatus({ type: 'success', message: 'Snippet copied. Quick start progress updated.' });
      } catch (error) {
        setOnboardingStatus({ type: 'error', message: `Snippet copied, but failed to persist progress: ${error.message}` });
      }
    } catch (error) {
      setOnboardingStatus({ type: 'error', message: error.message || 'Failed to copy snippet' });
    }
  }

  async function toggleOnboardingDismissed(dismissed) {
    setOnboardingStatus(null);
    try {
      await updateOnboarding({ dismissed });
      setOnboardingStatus({
        type: 'success',
        message: dismissed ? 'Quick start dismissed. You can show it again anytime.' : 'Quick start is visible again.'
      });
    } catch (error) {
      setOnboardingStatus({ type: 'error', message: error.message || 'Failed to update quick start visibility' });
    }
  }

  function scrollToOnboardingTarget(stepId) {
    const targetId = onboardingTargets[stepId];
    if (!targetId) return;
    document.getElementById(targetId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

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

      {onboardingStatus ? <StatusMessage status={onboardingStatus} /> : null}

      {loadingOnboarding ? <p>Loading quick start…</p> : null}
      {!loadingOnboarding && onboarding && !onboarding.dismissed ? (
        <section style={cardStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
            <div>
              <h2 style={{ margin: 0 }}>Quick start</h2>
              <p style={{ margin: '6px 0 0', color: '#4b5563' }}>Complete the onboarding checklist to get routing live.</p>
            </div>
            <button
              type="button"
              onClick={() => toggleOnboardingDismissed(true)}
              style={{ ...buttonStyle, background: '#e5e7eb', color: '#111827' }}
            >
              Dismiss
            </button>
          </div>
          <div>
            <strong>{onboarding.completed_count} / {onboarding.total_count} completed</strong>
            <div style={{ height: 10, borderRadius: 999, background: '#e5e7eb', overflow: 'hidden', marginTop: 8 }}>
              <div
                style={{
                  width: `${Math.round((onboarding.completed_count / Math.max(1, onboarding.total_count)) * 100)}%`,
                  height: '100%',
                  borderRadius: 999,
                  background: '#16a34a'
                }}
              />
            </div>
          </div>
          <div style={{ display: 'grid', gap: 10 }}>
            {onboarding.steps.map((step) => (
              <div key={step.id} style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 12, display: 'grid', gap: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                  <strong>{step.complete ? '✅' : '⬜'} {step.label}</strong>
                  <button type="button" onClick={() => scrollToOnboardingTarget(step.id)} style={buttonStyle}>Go</button>
                </div>
                <span style={{ color: '#4b5563' }}>{step.description}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {!loadingOnboarding && onboarding?.dismissed ? (
        <section style={cardStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
            <div>
              <h2 style={{ margin: 0 }}>Quick start hidden</h2>
              <p style={{ margin: '6px 0 0', color: '#4b5563' }}>You dismissed onboarding for this workspace.</p>
            </div>
            <button type="button" onClick={() => toggleOnboardingDismissed(false)} style={buttonStyle}>Show quick start</button>
          </div>
        </section>
      ) : null}

      {managementStatus ? <StatusMessage status={managementStatus} /> : null}

      <section style={cardStyle} id="usage-dashboard">
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
          <StatCard label="Estimated cost" value={formatUsd(usage?.summary?.estimated_cost_usd)} />
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
                <span>Cost: {event.pricing_rule_missing ? 'not configured' : formatUsd(event.estimated_cost_usd)}</span>
                <span>Created: {formatDate(event.created_at)}</span>
                <ErrorExplanationPanel explanation={explainUsageEvent(event)} />
              </div>
            ))}
          </div>
        </div>
      </section>

      <section style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
          <div>
            <h2 style={{ margin: 0 }}>Usage analytics</h2>
            <p style={{ margin: '4px 0 0', color: '#6b7280' }}>Trends and breakdowns for the selected period.</p>
          </div>
          {usage?.analytics?.truncated ? (
            <span style={{ color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 999, padding: '4px 8px', fontSize: 12, fontWeight: 700 }}>
              First {formatInteger(usage.analytics.max_events)} events
            </span>
          ) : null}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
          <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 14, display: 'grid', gap: 12 }}>
            <h3 style={{ margin: 0 }}>Usage trend</h3>
            <UsageTrend buckets={usage?.charts?.usage_buckets} />
          </div>
          <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 14, display: 'grid', gap: 12 }}>
            <h3 style={{ margin: 0 }}>Status breakdown</h3>
            <StatusBreakdown statuses={usage?.breakdowns?.statuses} />
          </div>
          <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 14, display: 'grid', gap: 12 }}>
            <h3 style={{ margin: 0 }}>Provider breakdown</h3>
            <ProviderBreakdown providers={usage?.breakdowns?.providers} />
          </div>
          <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 14, display: 'grid', gap: 12 }}>
            <h3 style={{ margin: 0 }}>Model breakdown</h3>
            <ModelBreakdown models={usage?.breakdowns?.models} />
          </div>
        </div>
      </section>

      <section style={cardStyle}>
        <div>
          <h2 style={{ margin: 0 }}>Pricing rules</h2>
          <p style={{ margin: '6px 0 0', color: '#4b5563' }}>Estimate cost from prompt/completion tokens. Prices are USD per 1M tokens.</p>
        </div>
        {pricingStatus ? <StatusMessage status={pricingStatus} /> : null}
        <form onSubmit={createPricingRule} style={{ display: 'grid', gap: 14 }}>
          <label style={labelStyle}>
            Provider optional
            <select style={inputStyle} value={pricingForm.provider_connection_id} onChange={(event) => updatePricingField('provider_connection_id', event.target.value)}>
              <option value="">Workspace-wide / any provider</option>
              {providers.map((provider) => (
                <option key={provider.id} value={provider.id}>{provider.display_name} — {provider.status}</option>
              ))}
            </select>
          </label>
          <label style={labelStyle}>
            Model pattern exact match
            <input style={inputStyle} value={pricingForm.model_pattern} onChange={(event) => updatePricingField('model_pattern', event.target.value)} placeholder="gpt-4o-mini" />
          </label>
          <label style={labelStyle}>
            Input USD / 1M tokens
            <input style={inputStyle} type="number" min="0" step="0.000001" value={pricingForm.input_usd_per_1m_tokens} onChange={(event) => updatePricingField('input_usd_per_1m_tokens', event.target.value)} />
          </label>
          <label style={labelStyle}>
            Output USD / 1M tokens
            <input style={inputStyle} type="number" min="0" step="0.000001" value={pricingForm.output_usd_per_1m_tokens} onChange={(event) => updatePricingField('output_usd_per_1m_tokens', event.target.value)} />
          </label>
          <button style={buttonStyle} disabled={pricingPending} type="submit">{pricingPending ? 'Adding…' : 'Add pricing rule'}</button>
        </form>

        {loadingPricingRules ? <p>Loading pricing rules…</p> : null}
        {pricingRules.length === 0 && !loadingPricingRules ? <p style={{ color: '#4b5563' }}>No pricing rules yet. Usage cost will show as not configured.</p> : null}
        <div style={{ display: 'grid', gap: 12 }}>
          {pricingRules.map((rule) => (
            <div key={rule.id} style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 14, display: 'grid', gap: 8 }}>
              <strong>{rule.model_pattern}</strong>
              <span>Scope: {providerNameForId(providers, rule.provider_connection_id)}</span>
              <span>Input: ${formatPrice(rule.input_usd_per_1m_tokens)} / 1M tokens</span>
              <span>Output: ${formatPrice(rule.output_usd_per_1m_tokens)} / 1M tokens</span>
              <span>Created: {formatDate(rule.created_at)}</span>
              <button style={buttonStyle} disabled={pendingActionId === `pricing:${rule.id}`} onClick={() => disablePricingRule(rule.id)} type="button">
                {pendingActionId === `pricing:${rule.id}` ? 'Disabling…' : 'Disable rule'}
              </button>
            </div>
          ))}
        </div>
      </section>

      <section style={cardStyle} id="connected-providers">
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
              <div style={{ display: 'grid', gap: 8 }}>
                <strong>Routing hints</strong>
                <ProviderTagChips tags={providerTags(provider)} />
                <ProviderTagToggleGroup
                  selectedTags={providerTagDraft(provider)}
                  onToggle={(tag) => toggleProviderDraftTag(provider, tag)}
                  disabled={pendingActionId === `provider-tags:${provider.id}`}
                />
                <button
                  style={{ ...buttonStyle, width: 'fit-content' }}
                  type="button"
                  onClick={() => saveProviderTags(provider)}
                  disabled={pendingActionId === `provider-tags:${provider.id}`}
                >
                  {pendingActionId === `provider-tags:${provider.id}` ? 'Saving tags…' : 'Save tags'}
                </button>
              </div>
              <span>Health: {provider.quota_state?.health || 'unknown'}</span>
              <span>Last checked: {formatDate(provider.last_checked_at)}</span>
              {provider.quota_state?.last_error_message ? <span>Last error: {provider.quota_state.last_error_message}</span> : null}
              <span>Created: {formatDate(provider.created_at)}</span>
              <ErrorExplanationPanel explanation={explainProviderHealth(provider)} heading="Health explanation" />
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {provider.status !== 'disconnected' ? (
                  <>
                    <button style={buttonStyle} disabled={pendingActionId === `provider-check:${provider.id}`} onClick={() => checkProviderHealth(provider.id)} type="button">
                      {pendingActionId === `provider-check:${provider.id}` ? 'Checking…' : 'Check health'}
                    </button>
                    <button style={buttonStyle} disabled={pendingActionId === `provider:${provider.id}`} onClick={() => disconnectProvider(provider.id)} type="button">
                      {pendingActionId === `provider:${provider.id}` ? 'Disconnecting…' : 'Disconnect provider'}
                    </button>
                  </>
                ) : null}
                <button style={{ ...buttonStyle, background: '#e5e7eb', color: '#111827' }} type="button" onClick={() => startReconnect(provider)}>
                  Reconnect / rotate key
                </button>
              </div>
              {reconnectProviderId === provider.id ? (
                <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 14, display: 'grid', gap: 12 }}>
                  <strong>Reconnect provider</strong>
                  <label style={labelStyle}>
                    Provider name
                    <input
                      style={inputStyle}
                      value={reconnectForm.display_name}
                      onChange={(event) => updateReconnectField('display_name', event.target.value)}
                    />
                  </label>
                  <label style={labelStyle}>
                    Base URL
                    <input
                      style={inputStyle}
                      value={reconnectForm.base_url}
                      onChange={(event) => updateReconnectField('base_url', event.target.value)}
                      placeholder="https://api.example.com"
                    />
                  </label>
                  <label style={labelStyle}>
                    Default model
                    <input
                      style={inputStyle}
                      value={reconnectForm.default_model}
                      onChange={(event) => updateReconnectField('default_model', event.target.value)}
                      placeholder="gpt-4o-mini"
                    />
                  </label>
                  <label style={labelStyle}>
                    New provider API key
                    <input
                      style={inputStyle}
                      type="password"
                      value={reconnectForm.api_key}
                      onChange={(event) => updateReconnectField('api_key', event.target.value)}
                      placeholder="sk-..."
                    />
                  </label>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button
                      style={buttonStyle}
                      type="button"
                      onClick={() => reconnectProvider(provider.id)}
                      disabled={pendingActionId === `provider-reconnect:${provider.id}`}
                    >
                      {pendingActionId === `provider-reconnect:${provider.id}` ? 'Saving…' : 'Save reconnect'}
                    </button>
                    <button style={{ ...buttonStyle, background: '#e5e7eb', color: '#111827' }} type="button" onClick={cancelReconnect}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </section>

      <section style={cardStyle} id="default-fallback-chain">
        <div>
          <h2 style={{ margin: 0 }}>Default fallback chain</h2>
          <p style={{ margin: '6px 0 0', color: '#4b5563' }}>Router tries providers in this order for model <code>auto</code>.</p>
        </div>

        <TagBasedSuggestionPanel suggestion={tagBasedSuggestion} onApply={applyTagBasedSuggestion} />

        {presetStatus ? <StatusMessage status={presetStatus} /> : null}
        {loadingPreset ? <p>Loading default preset…</p> : null}

        <div style={{ display: 'grid', gap: 12 }}>
          {presetDraftSteps.length === 0 && !loadingPreset ? <p style={{ color: '#4b5563' }}>No providers in the fallback chain yet.</p> : null}
          {presetDraftSteps.map((step, index) => (
            <div key={step.provider_connection_id} style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 14, display: 'grid', gap: 10 }}>
              <strong>#{index + 1} {step.display_name}</strong>
              <span>Status: {step.status}</span>
              <span>Health: {step.health || 'unknown'}</span>
              <ProviderTagChips tags={providers.find((provider) => provider.id === step.provider_connection_id)?.metadata?.tags} />
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
              {availablePresetProviders.map((provider) => {
                const tags = providerTags(provider);
                const tagSuffix = tags.length > 0 ? ` · ${tags.map(providerTagLabel).join(', ')}` : '';
                return (
                  <option key={provider.id} value={provider.id}>
                    {provider.display_name} — {provider.status} / {provider.quota_state?.health || 'unknown'}{tagSuffix}
                  </option>
                );
              })}
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

      <section style={cardStyle} id="connect-provider">
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
          <label style={labelStyle}>
            Routing hint tags
            <ProviderTagToggleGroup selectedTags={providerForm.tags} onToggle={toggleProviderFormTag} disabled={providerPending} />
          </label>
          <button style={buttonStyle} disabled={providerPending} type="submit">{providerPending ? 'Connecting…' : 'Connect provider'}</button>
        </form>
        {providerStatus ? <StatusMessage status={providerStatus} /> : null}
      </section>

      <section style={cardStyle} id="generate-router-key">
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

      <section style={cardStyle} id="endpoint-config">
        <div>
          <h2 style={{ margin: 0 }}>Endpoint config</h2>
          <p style={{ margin: '6px 0 0', color: '#4b5563' }}>Router base URL: <code>{normalizedRouterBaseUrl}</code></p>
          <p style={{ margin: '6px 0 0', color: '#4b5563' }}>
            {rawApiKey ? 'Snippets include the API key you just generated. Copy it before leaving this page.' : 'Generate a router API key first; snippets use a placeholder until a raw key is available.'}
          </p>
        </div>
        <div style={{ display: 'grid', gap: 12 }}>
          {onboardingSnippets.map((snippet) => (
            <div key={snippet.id} style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 14, display: 'grid', gap: 8 }}>
              <div>
                <h3 style={{ margin: 0 }}>{snippet.label}</h3>
                <p style={{ margin: '6px 0 0', color: '#4b5563' }}>{snippet.description}</p>
              </div>
              <pre style={codeStyle}>{snippet.content}</pre>
              <button style={{ ...buttonStyle, width: 'fit-content' }} type="button" onClick={() => handleCopySnippet(snippet.content)}>
                Copy
              </button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function formatPercent(value) {
  return `${Math.round(Number(value || 0) * 100)}%`;
}

function formatNumber(value) {
  return formatInteger(value);
}

function formatDate(value) {
  if (!value) return 'Never';
  return new Date(value).toLocaleString();
}

function providerNameForId(providers, providerId) {
  if (!providerId) return 'Workspace-wide / any provider';
  const provider = providers.find((item) => item.id === providerId);
  return provider ? provider.display_name : providerId;
}

function formatPrice(value) {
  return Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 6 });
}

function formatUsd(value) {
  const amount = Number(value || 0);
  return `$${amount.toLocaleString(undefined, { minimumFractionDigits: 6, maximumFractionDigits: 6 })}`;
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
