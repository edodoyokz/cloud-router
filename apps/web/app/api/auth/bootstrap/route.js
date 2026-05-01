import { NextResponse } from 'next/server';
import { requireAuthenticatedWorkspaceId } from '../../../../lib/workspace.js';

export async function POST(request) {
  try {
    const workspaceId = await requireAuthenticatedWorkspaceId(request);
    return NextResponse.json({ workspace_id: workspaceId, status: 'ready' });
  } catch (error) {
    const status = error.status || 400;
    const code = error.code || (status >= 500 ? 'persistence_error' : 'auth_error');
    return NextResponse.json({ error: { code, message: error.message } }, { status });
  }
}
