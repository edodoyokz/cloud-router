import { NextResponse } from 'next/server';
import { decryptCredential } from '../../../../../lib/crypto.js';
import { runOpenAICompatibleHealthCheck } from '../../../../../lib/provider-health.js';
import { supabasePatch, supabaseSelect } from '../../../../../lib/supabase-admin.js';
import { resolveWorkspaceId } from '../../../../../lib/workspace.js';

export async function POST(request, { params }) {
  try {
    const workspaceId = await resolveWorkspaceId(request);
    const { id } = await params;

    if (!id) {
      return NextResponse.json({ error: { code: 'validation_error', message: 'Provider id is required' } }, { status: 400 });
    }

    const providers = await supabaseSelect(
      'provider_connections',
      `?id=eq.${encodeURIComponent(id)}&workspace_id=eq.${encodeURIComponent(workspaceId)}&select=id,provider_type,auth_method,status,metadata,credential_encrypted,quota_state,last_checked_at&limit=1`
    );

    if (providers.length === 0) {
      return NextResponse.json({ error: { code: 'not_found', message: 'Provider not found' } }, { status: 404 });
    }

    const provider = providers[0];
    if (provider.status === 'disconnected') {
      return NextResponse.json({ error: { code: 'validation_error', message: 'Disconnected providers cannot be checked' } }, { status: 400 });
    }

    if (provider.provider_type !== 'openai_compatible' || provider.auth_method !== 'api_key') {
      return NextResponse.json({
        error: {
          code: 'validation_error',
          message: 'Provider health checks only support OpenAI-compatible API-key providers'
        }
      }, { status: 400 });
    }

    const decrypted = decryptCredential(provider.credential_encrypted);
    const credentials = JSON.parse(decrypted);
    const apiKey = credentials?.api_key;

    if (!apiKey) {
      throw Object.assign(new Error('Provider credential is invalid'), { status: 400, code: 'validation_error' });
    }

    const metadata = provider.metadata || {};
    const result = await runOpenAICompatibleHealthCheck({
      baseUrl: metadata.base_url,
      apiKey,
      model: metadata.default_model
    });

    const checkedAt = new Date().toISOString();
    const quotaState = {
      ...(provider.quota_state || {}),
      health: result.ok ? 'healthy' : 'error',
      last_error_code: result.ok ? null : result.error_code,
      last_error_message: result.ok ? null : result.message
    };

    const patch = {
      status: result.ok ? 'active' : 'error',
      last_checked_at: checkedAt,
      quota_state: quotaState
    };

    const updated = await supabasePatch(
      'provider_connections',
      `?id=eq.${encodeURIComponent(id)}&workspace_id=eq.${encodeURIComponent(workspaceId)}`,
      patch
    );

    const row = updated[0] || patch;

    return NextResponse.json({
      id,
      status: row.status || patch.status,
      health: quotaState.health,
      last_checked_at: row.last_checked_at || checkedAt,
      ...(result.ok ? { message: result.message } : { error_code: result.error_code, message: result.message })
    });
  } catch (error) {
    const status = error.status || 500;
    const code = error.code || 'provider_check_error';
    return NextResponse.json({ error: { code, message: error.message || 'Provider check failed' } }, { status });
  }
}
