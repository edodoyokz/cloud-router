import { NextResponse } from 'next/server';
import { supabaseSelect } from '../../../lib/supabase-admin.js';
import { resolveWorkspaceId } from '../../../lib/workspace.js';
import { clampUsageLimit, normalizeUsagePeriod, summarizeUsageEvents, usageSinceISOString } from '../../../lib/usage-summary.js';

export async function GET(request) {
  try {
    const workspaceId = await resolveWorkspaceId(request);
    const { searchParams } = new URL(request.url);
    const period = normalizeUsagePeriod(searchParams.get('period'));
    const limit = clampUsageLimit(searchParams.get('limit'));
    const since = usageSinceISOString(period);

    const events = await supabaseSelect(
      'usage_events',
      `?workspace_id=eq.${encodeURIComponent(workspaceId)}&created_at=gte.${encodeURIComponent(since)}&select=id,provider_connection_id,api_key_id,request_id,model_requested,model_resolved,total_tokens,status,error_code,created_at&order=created_at.desc&limit=${limit}`
    );

    return NextResponse.json({
      period,
      summary: summarizeUsageEvents(events),
      events
    });
  } catch (error) {
    const status = error.status || 400;
    const code = error.code || (status >= 500 ? 'persistence_error' : 'validation_error');
    return NextResponse.json({ error: { code, message: error.message } }, { status });
  }
}
