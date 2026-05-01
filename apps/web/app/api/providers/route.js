import { NextResponse } from 'next/server';
import { normalizeProviderInput } from '../../../lib/provider-validation.js';
import { encryptCredential } from '../../../lib/crypto.js';
import { supabaseInsert, supabaseSelect } from '../../../lib/supabase-admin.js';
import { resolveWorkspaceId } from '../../../lib/workspace.js';
import { normalizeProviderTags } from '../../../lib/provider-tags.js';

export async function GET(request) {
  try {
    const workspaceId = await resolveWorkspaceId(request);
    const providers = await supabaseSelect(
      'provider_connections',
      `?workspace_id=eq.${encodeURIComponent(workspaceId)}&select=id,provider_type,display_name,auth_method,status,metadata,quota_state,last_checked_at,created_at&order=created_at.desc`
    );
    return NextResponse.json(providers);
  } catch (error) {
    const status = error.status || 400;
    const code = error.code || (status >= 500 ? 'persistence_error' : 'validation_error');
    return NextResponse.json({ error: { code, message: error.message } }, { status });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const input = normalizeProviderInput(body);
    const tags = normalizeProviderTags(body.tags);

    const workspaceId = await resolveWorkspaceId(request);
    const encryptionKey = process.env.ENCRYPTION_KEY;
    if (!encryptionKey) {
      throw Object.assign(new Error('ENCRYPTION_KEY is required'), { status: 500, code: 'configuration_error' });
    }

    const credential_encrypted = encryptCredential(encryptionKey, JSON.stringify({ api_key: input.api_key }));
    const [provider] = await supabaseInsert('provider_connections', [{
      workspace_id: workspaceId,
      provider_type: input.provider_type,
      display_name: input.display_name,
      auth_method: input.auth_method,
      provider_family: 'openai_compatible',
      capabilities: { chat_completions: true, model_selection: true, fallback: true },
      metadata: { base_url: input.base_url, default_model: input.default_model, tags },
      credential_encrypted,
      status: 'active',
      quota_state: {}
    }]);

    const preset = await ensureDefaultPreset(workspaceId);
    await appendPresetStep(preset.id, provider.id);

    return NextResponse.json({
      id: provider.id,
      provider_type: provider.provider_type,
      display_name: provider.display_name,
      auth_method: provider.auth_method,
      status: provider.status,
      metadata: provider.metadata,
      created_at: provider.created_at
    }, { status: 201 });
  } catch (error) {
    const status = error.status || 400;
    const code = error.code || (status >= 500 ? 'persistence_error' : 'validation_error');
    return NextResponse.json({ error: { code, message: error.message } }, { status });
  }
}

async function ensureDefaultPreset(workspaceId) {
  const existing = await supabaseSelect('routing_presets', `?workspace_id=eq.${encodeURIComponent(workspaceId)}&is_default=eq.true&select=*`);
  if (existing.length > 0) return existing[0];
  const [created] = await supabaseInsert('routing_presets', [{
    workspace_id: workspaceId,
    name: 'Default',
    description: 'Default routing preset',
    is_default: true
  }]);
  return created;
}

async function appendPresetStep(presetId, providerConnectionId) {
  const existing = await supabaseSelect('routing_preset_steps', `?preset_id=eq.${encodeURIComponent(presetId)}&select=order_index&order=order_index.desc&limit=1`);
  const nextOrder = existing.length > 0 ? Number(existing[0].order_index || 0) + 1 : 1;
  const [step] = await supabaseInsert('routing_preset_steps', [{
    preset_id: presetId,
    order_index: nextOrder,
    provider_connection_id: providerConnectionId,
    fallback_mode: 'failover'
  }]);
  return step;
}
