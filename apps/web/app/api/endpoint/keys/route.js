import { NextResponse } from 'next/server';
import { apiKeyPrefix, generateApiKey, sha256Hex } from '../../../../lib/crypto.js';
import { supabaseInsert, supabaseSelect } from '../../../../lib/supabase-admin.js';
import { resolveWorkspaceId } from '../../../../lib/workspace.js';

export async function GET(request) {
  try {
    const workspaceId = await resolveWorkspaceId(request);
    const keys = await supabaseSelect(
      'api_keys',
      `?workspace_id=eq.${encodeURIComponent(workspaceId)}&select=id,name,prefix,created_at,last_used_at,revoked_at&order=created_at.desc`
    );
    return NextResponse.json(keys);
  } catch (error) {
    const status = error.status || 400;
    const code = error.code || (status >= 500 ? 'persistence_error' : 'validation_error');
    return NextResponse.json({ error: { code, message: error.message } }, { status });
  }
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const name = String(body?.name || 'Default key').trim();
    if (!name) throw new Error('name is required');

    const workspaceId = await resolveWorkspaceId(request);
    const rawKey = generateApiKey();
    const [record] = await supabaseInsert('api_keys', [{
      workspace_id: workspaceId,
      name,
      key_hash: sha256Hex(rawKey),
      prefix: apiKeyPrefix(rawKey)
    }]);

    return NextResponse.json({
      id: record.id,
      name: record.name,
      prefix: record.prefix,
      raw_key: rawKey,
      created_at: record.created_at
    }, { status: 201 });
  } catch (error) {
    const status = error.status || 400;
    const code = error.code || (status >= 500 ? 'persistence_error' : 'validation_error');
    return NextResponse.json({ error: { code, message: error.message } }, { status });
  }
}
