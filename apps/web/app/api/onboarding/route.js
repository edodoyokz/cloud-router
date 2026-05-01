import { NextResponse } from 'next/server';
import {
  buildOnboardingChecklist,
  mergeOnboardingMetadata,
  normalizeOnboardingState,
  validatePersistedOnboardingSteps
} from '../../../lib/onboarding.js';
import { supabasePatch, supabaseSelect } from '../../../lib/supabase-admin.js';
import { resolveWorkspaceId } from '../../../lib/workspace.js';

export async function GET(request) {
  try {
    const workspaceId = await resolveWorkspaceId(request);
    const checklist = await loadChecklistForWorkspace(workspaceId);
    return NextResponse.json(checklist);
  } catch (error) {
    const status = error.status || 400;
    const code = error.code || (status >= 500 ? 'persistence_error' : 'validation_error');
    return NextResponse.json({ error: { code, message: error.message } }, { status });
  }
}

export async function PATCH(request) {
  try {
    const workspaceId = await resolveWorkspaceId(request);
    const workspace = await fetchWorkspace(workspaceId);
    const body = await request.json();

    const onboardingPatch = {};
    if (Object.prototype.hasOwnProperty.call(body, 'completed_steps')) {
      onboardingPatch.completed_steps = validatePersistedOnboardingSteps(body.completed_steps);
    }
    if (Object.prototype.hasOwnProperty.call(body, 'dismissed')) {
      onboardingPatch.dismissed = Boolean(body.dismissed);
    }

    const metadata = mergeOnboardingMetadata(workspace.metadata, onboardingPatch);
    await supabasePatch(
      'workspaces',
      `?id=eq.${encodeURIComponent(workspaceId)}`,
      { metadata }
    );

    const checklist = await loadChecklistForWorkspace(workspaceId, metadata.onboarding);
    return NextResponse.json(checklist);
  } catch (error) {
    const status = error.status || 400;
    const code = error.code || (status >= 500 ? 'persistence_error' : 'validation_error');
    return NextResponse.json({ error: { code, message: error.message } }, { status });
  }
}

async function loadChecklistForWorkspace(workspaceId, onboardingStateOverride = null) {
  const [workspace, providers, apiKeys, usageEvents] = await Promise.all([
    fetchWorkspace(workspaceId),
    supabaseSelect('provider_connections', `?workspace_id=eq.${encodeURIComponent(workspaceId)}&status=neq.disconnected&select=id,quota_state&limit=50`),
    supabaseSelect('api_keys', `?workspace_id=eq.${encodeURIComponent(workspaceId)}&revoked_at=is.null&select=id&limit=1`),
    supabaseSelect('usage_events', `?workspace_id=eq.${encodeURIComponent(workspaceId)}&select=id&limit=1`)
  ]);

  return buildOnboardingChecklist({
    onboardingState: onboardingStateOverride || workspace.metadata?.onboarding,
    hasProvider: providers.length > 0,
    hasHealthyProvider: providers.some((provider) => provider.quota_state?.health === 'healthy'),
    hasApiKey: apiKeys.length > 0,
    hasUsageEvent: usageEvents.length > 0
  });
}

async function fetchWorkspace(workspaceId) {
  const workspaceRows = await supabaseSelect('workspaces', `?id=eq.${encodeURIComponent(workspaceId)}&select=id,metadata&limit=1`);
  if (!workspaceRows || workspaceRows.length === 0) {
    throw Object.assign(new Error('workspace not found'), { status: 404, code: 'workspace_not_found' });
  }
  return {
    ...workspaceRows[0],
    metadata: workspaceRows[0].metadata || { onboarding: normalizeOnboardingState(null) }
  };
}
