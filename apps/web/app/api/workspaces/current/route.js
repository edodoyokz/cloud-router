import { NextResponse } from 'next/server';
import { resolveWorkspaceContext } from '../../../../lib/workspace.js';

export async function GET(request) {
  try {
    const context = await resolveWorkspaceContext(request);
    return NextResponse.json({
      id: context.workspace.id,
      name: context.workspace.name,
      slug: context.workspace.slug,
      role: context.role,
      auth_mode: context.auth_mode,
      user: context.user ? { email: context.user.email } : null
    });
  } catch (error) {
    const status = error.status || 400;
    const code = error.code || (status >= 500 ? 'persistence_error' : 'workspace_error');
    return NextResponse.json({ error: { code, message: error.message } }, { status });
  }
}
