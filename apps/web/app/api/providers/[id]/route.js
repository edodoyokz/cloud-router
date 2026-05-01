import { NextResponse } from 'next/server';
import { encryptCredential } from '../../../../lib/crypto.js';
import { normalizeProviderInput } from '../../../../lib/provider-validation.js';
import { supabasePatch, supabaseSelect } from '../../../../lib/supabase-admin.js';
import { resolveWorkspaceId } from '../../../../lib/workspace.js';

export async function PATCH(request, { params }) {
  try {
    const workspaceId = await resolveWorkspaceId(request);
    const { id } = await params;
    if (!id) throw Object.assign(new Error('provider id is required'), { status: 400, code: 'validation_error' });

    const existing = await supabaseSelect(
      'provider_connections',
      `?id=eq.${encodeURIComponent(id)}&workspace_id=eq.${encodeURIComponent(workspaceId)}&select=id,provider_type,auth_method,created_at&limit=1`
    );
    if (existing.length === 0) {
      throw Object.assign(new Error('provider not found'), { status: 404, code: 'not_found' });
    }
    const provider = existing[0];
    if (provider.provider_type !== 'openai_compatible' || provider.auth_method !== 'api_key') {
      throw Object.assign(new Error('Only OpenAI-compatible API-key providers can be reconnected'), { status: 400, code: 'validation_error' });
    }

    const body = await request.json();
    const input = normalizeProviderInput({
      provider_type: provider.provider_type,
      auth_method: provider.auth_method,
      ...body
    });

    const encryptionKey = process.env.ENCRYPTION_KEY;
    if (!encryptionKey) {
      throw Object.assign(new Error('ENCRYPTION_KEY is required'), { status: 500, code: 'configuration_error' });
    }

    const credential_encrypted = encryptCredential(encryptionKey, JSON.stringify({ api_key: input.api_key }));
    const rows = await supabasePatch(
      'provider_connections',
      `?id=eq.${encodeURIComponent(id)}&workspace_id=eq.${encodeURIComponent(workspaceId)}`,
      {
        display_name: input.display_name,
        metadata: { base_url: input.base_url, default_model: input.default_model },
        credential_encrypted,
        status: 'active',
        quota_state: {},
        last_checked_at: null
      }
    );

    if (!rows || rows.length === 0) {
      throw Object.assign(new Error('provider not found'), { status: 404, code: 'not_found' });
    }

    const updated = rows[0];
    return NextResponse.json({
      id: updated.id,
      provider_type: updated.provider_type,
      display_name: updated.display_name,
      auth_method: updated.auth_method,
      status: updated.status,
      metadata: updated.metadata,
      quota_state: updated.quota_state,
      last_checked_at: updated.last_checked_at,
      created_at: updated.created_at
    });
  } catch (error) {
    const status = error.status || 400;
    const code = error.code || (status >= 500 ? 'persistence_error' : 'validation_error');
    return NextResponse.json({ error: { code, message: error.message } }, { status });
  }
}

export async function DELETE(request, { params }) {
  try {
    const workspaceId = await resolveWorkspaceId(request);
    const { id } = await params;
    if (!id) throw Object.assign(new Error('provider id is required'), { status: 400, code: 'validation_error' });

    const rows = await supabasePatch(
      'provider_connections',
      `?id=eq.${encodeURIComponent(id)}&workspace_id=eq.${encodeURIComponent(workspaceId)}`,
      { status: 'disconnected' }
    );
    if (!rows || rows.length === 0) {
      throw Object.assign(new Error('provider not found'), { status: 404, code: 'not_found' });
    }

    return NextResponse.json({ disconnected: true });
  } catch (error) {
    const status = error.status || 400;
    const code = error.code || (status >= 500 ? 'persistence_error' : 'validation_error');
    return NextResponse.json({ error: { code, message: error.message } }, { status });
  }
}
