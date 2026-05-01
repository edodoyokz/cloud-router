import { NextResponse } from 'next/server';
import { supabaseSelect } from '../../../lib/supabase-admin.js';
import { resolveWorkspaceId } from '../../../lib/workspace.js';
import { enrichUsageEventsWithPricing } from '../../../lib/pricing.js';
import {
  ANALYTICS_USAGE_EVENT_LIMIT,
  buildUsageAnalytics,
  clampUsageLimit,
  normalizeUsagePeriod,
  summarizeUsageEvents,
  usageSinceISOString
} from '../../../lib/usage-summary.js';

export async function GET(request) {
  try {
    const workspaceId = await resolveWorkspaceId(request);
    const { searchParams } = new URL(request.url);
    const period = normalizeUsagePeriod(searchParams.get('period'));
    const limit = clampUsageLimit(searchParams.get('limit'));
    const since = usageSinceISOString(period);
    const eventSelect = 'id,provider_connection_id,api_key_id,request_id,model_requested,model_resolved,prompt_tokens,completion_tokens,total_tokens,status,error_code,created_at';

    const events = await supabaseSelect(
      'usage_events',
      `?workspace_id=eq.${encodeURIComponent(workspaceId)}&created_at=gte.${encodeURIComponent(since)}&select=${eventSelect}&order=created_at.desc&limit=${limit}`
    );

    const analyticsEvents = await supabaseSelect(
      'usage_events',
      `?workspace_id=eq.${encodeURIComponent(workspaceId)}&created_at=gte.${encodeURIComponent(since)}&select=${eventSelect}&order=created_at.asc&limit=${ANALYTICS_USAGE_EVENT_LIMIT}`
    );

    const pricingRules = await supabaseSelect(
      'model_pricing_rules',
      `?workspace_id=eq.${encodeURIComponent(workspaceId)}&status=eq.active&select=id,provider_connection_id,model_pattern,input_usd_per_1m_tokens,output_usd_per_1m_tokens,currency,status`
    );

    const providers = await supabaseSelect(
      'provider_connections',
      `?workspace_id=eq.${encodeURIComponent(workspaceId)}&select=id,provider_type,display_name`
    );

    const enrichedEvents = enrichUsageEventsWithPricing(events, pricingRules);
    const enrichedAnalyticsEvents = enrichUsageEventsWithPricing(analyticsEvents, pricingRules);
    const usageAnalytics = buildUsageAnalytics(enrichedAnalyticsEvents, providers, period);

    return NextResponse.json({
      period,
      summary: summarizeUsageEvents(enrichedAnalyticsEvents),
      events: enrichedEvents,
      ...usageAnalytics
    });
  } catch (error) {
    const status = error.status || 400;
    const code = error.code || (status >= 500 ? 'persistence_error' : 'validation_error');
    return NextResponse.json({ error: { code, message: error.message } }, { status });
  }
}
