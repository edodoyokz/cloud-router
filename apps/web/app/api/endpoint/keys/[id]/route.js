import { NextResponse } from 'next/server';
import { supabasePatch } from '../../../../../lib/supabase-admin.js';
import { resolveWorkspaceId } from '../../../../../lib/workspace.js';

export async function DELETE(request, { params }) {
  try {
    const workspaceId = await resolveWorkspaceId(request);
    const { id } = await params;
    if (!id) throw Object.assign(new Error('api key id is required'), { status: 400, code: 'validation_error' });

    const rows = await supabasePatch(
      'api_keys',
      `?id=eq.${encodeURIComponent(id)}&workspace_id=eq.${encodeURIComponent(workspaceId)}`,
      { revoked_at: new Date().toISOString() }
    );
    if (!rows || rows.length === 0) {
      throw Object.assign(new Error('api key not found'), { status: 404, code: 'not_found' });
    }

    return NextResponse.json({ revoked: true });
  } catch (error) {
    const status = error.status || 400;
    const code = error.code || (status >= 500 ? 'persistence_error' : 'validation_error');
    return NextResponse.json({ error: { code, message: error.message } }, { status });
  }
}
