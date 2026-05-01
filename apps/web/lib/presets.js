import { supabaseDelete, supabaseInsert, supabaseSelect } from './supabase-admin.js';

const maxPresetSteps = 10;

export async function ensureDefaultPreset(workspaceId) {
  const existing = await supabaseSelect(
    'routing_presets',
    `?workspace_id=eq.${encodeURIComponent(workspaceId)}&is_default=eq.true&select=*&limit=1`
  );
  if (existing.length > 0) return existing[0];

  const [created] = await supabaseInsert('routing_presets', [{
    workspace_id: workspaceId,
    name: 'Default',
    description: 'Default routing preset',
    is_default: true
  }]);
  return created;
}

export function normalizePresetStepInput(steps) {
  if (!Array.isArray(steps)) {
    throw Object.assign(new Error('steps must be an array'), { status: 400, code: 'validation_error' });
  }
  if (steps.length > maxPresetSteps) {
    throw Object.assign(new Error(`default preset supports at most ${maxPresetSteps} steps`), { status: 400, code: 'validation_error' });
  }

  const seen = new Set();
  return steps.map((step) => {
    const providerId = String(step?.provider_connection_id || '').trim();
    if (!providerId) {
      throw Object.assign(new Error('provider_connection_id is required'), { status: 400, code: 'validation_error' });
    }
    if (seen.has(providerId)) {
      throw Object.assign(new Error('provider_connection_id values must be unique'), { status: 400, code: 'validation_error' });
    }
    seen.add(providerId);

    const rawAlias = step?.model_alias;
    const modelAlias = rawAlias == null ? null : String(rawAlias).trim();
    if (modelAlias && modelAlias.length > 128) {
      throw Object.assign(new Error('model_alias must be at most 128 characters'), { status: 400, code: 'validation_error' });
    }

    return {
      provider_connection_id: providerId,
      model_alias: modelAlias || null
    };
  });
}

async function providersById(workspaceId, providerIds) {
  if (providerIds.length === 0) return new Map();
  const rows = await supabaseSelect(
    'provider_connections',
    `?workspace_id=eq.${encodeURIComponent(workspaceId)}&id=in.(${providerIds.map(encodeURIComponent).join(',')})&select=id,provider_type,display_name,status,quota_state,metadata`
  );
  return new Map(rows.map((provider) => [provider.id, provider]));
}

function enrichStep(step, provider) {
  return {
    id: step.id,
    order_index: step.order_index,
    provider_connection_id: step.provider_connection_id,
    provider_type: provider?.provider_type || null,
    display_name: provider?.display_name || 'Unknown provider',
    status: provider?.status || 'missing',
    health: provider?.quota_state?.health || 'unknown',
    model_alias: step.model_alias || null,
    fallback_mode: step.fallback_mode || 'failover'
  };
}

export async function getDefaultPresetWithSteps(workspaceId) {
  const preset = await ensureDefaultPreset(workspaceId);
  const steps = await supabaseSelect(
    'routing_preset_steps',
    `?preset_id=eq.${encodeURIComponent(preset.id)}&select=id,order_index,provider_connection_id,model_alias,fallback_mode&order=order_index.asc`
  );
  const providerIds = steps.map((step) => step.provider_connection_id);
  const providerMap = await providersById(workspaceId, providerIds);

  return {
    id: preset.id,
    name: preset.name,
    description: preset.description,
    is_default: preset.is_default,
    steps: steps.map((step) => enrichStep(step, providerMap.get(step.provider_connection_id)))
  };
}

export async function replaceDefaultPresetSteps(workspaceId, rawSteps) {
  const preset = await ensureDefaultPreset(workspaceId);
  const steps = normalizePresetStepInput(rawSteps);
  const providerIds = steps.map((step) => step.provider_connection_id);
  const providerMap = await providersById(workspaceId, providerIds);

  for (const providerId of providerIds) {
    const provider = providerMap.get(providerId);
    if (!provider) {
      throw Object.assign(new Error('Provider not found'), { status: 404, code: 'not_found' });
    }
    if (provider.status === 'disconnected') {
      throw Object.assign(new Error('Disconnected providers cannot be added to the default preset'), { status: 400, code: 'validation_error' });
    }
  }

  await supabaseDelete('routing_preset_steps', `?preset_id=eq.${encodeURIComponent(preset.id)}`);

  if (steps.length > 0) {
    await supabaseInsert('routing_preset_steps', steps.map((step, index) => ({
      preset_id: preset.id,
      order_index: index + 1,
      provider_connection_id: step.provider_connection_id,
      model_alias: step.model_alias,
      fallback_mode: 'failover'
    })));
  }

  return getDefaultPresetWithSteps(workspaceId);
}
