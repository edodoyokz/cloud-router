import { NextResponse } from 'next/server';
import { normalizeProviderTags } from '../../../../../lib/provider-tags.js';
import { supabasePatch, supabaseSelect } from '../../../../../lib/supabase-admin.js';
import { resolveWorkspaceId } from '../../../../../lib/workspace.js';

function providerResponse(provider) {
  return {
    id: provider.id,
    provider_type: provider.provider_type,
    display_name: provider.display_name,
    auth_method: provider.auth_method,
    status: provider.status,
    metadata: provider.metadata,
    quota_state: provider.quota_state,
    last_checked_at: provider.last_checked_at,
    created_at: provider.created_at
  };
}

export async function PATCH(request, { params }) {
  try {
    const workspaceId = await resolveWorkspaceId(request);
    const { id } = await params;
    if (!id) throw Object.assign(new Error('provider id is required'), { status: 400, code: 'validation_error' });

    const body = await request.json();
    if (!Object.prototype.hasOwnProperty.call(body, 'tags') || !Array.isArray(body.tags)) {
      throw Object.assign(new Error('tags array is required'), { status: 400, code: 'validation_error' });
    }

    const existing = await supabaseSelect(
      'provider_connections',
      `?id=eq.${encodeURIComponent(id)}&workspace_id=eq.${encodeURIComponent(workspaceId)}&select=id,metadata&limit=1`
    );
    if (existing.length === 0) {
      throw Object.assign(new Error('provider not found'), { status: 404, code: 'not_found' });
    }

    const metadata = {
      ...(existing[0].metadata || {}),
      tags: normalizeProviderTags(body.tags)
    };

    const rows = await supabasePatch(
      'provider_connections',
      `?id=eq.${encodeURIComponent(id)}&workspace_id=eq.${encodeURIComponent(workspaceId)}`,
      { metadata }
    );

    if (!rows || rows.length === 0) {
      throw Object.assign(new Error('provider not found'), { status: 404, code: 'not_found' });
    }

    return NextResponse.json(providerResponse(rows[0]));
  } catch (error) {
    const status = error.status || 400;
    const code = error.code || (status >= 500 ? 'persistence_error' : 'validation_error');
    return NextResponse.json({ error: { code, message: error.message } }, { status });
  }
}
