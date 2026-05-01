import { NextResponse } from 'next/server';
import { getDefaultPresetWithSteps, replaceDefaultPresetSteps } from '../../../../lib/presets.js';
import { resolveWorkspaceId } from '../../../../lib/workspace.js';

export async function GET(request) {
  try {
    const workspaceId = await resolveWorkspaceId(request);
    const preset = await getDefaultPresetWithSteps(workspaceId);
    return NextResponse.json(preset);
  } catch (error) {
    const status = error.status || 400;
    const code = error.code || (status >= 500 ? 'persistence_error' : 'validation_error');
    return NextResponse.json({ error: { code, message: error.message } }, { status });
  }
}

export async function PUT(request) {
  try {
    const workspaceId = await resolveWorkspaceId(request);
    const body = await request.json();
    const preset = await replaceDefaultPresetSteps(workspaceId, body?.steps);
    return NextResponse.json(preset);
  } catch (error) {
    const status = error.status || 400;
    const code = error.code || (status >= 500 ? 'persistence_error' : 'validation_error');
    return NextResponse.json({ error: { code, message: error.message } }, { status });
  }
}
