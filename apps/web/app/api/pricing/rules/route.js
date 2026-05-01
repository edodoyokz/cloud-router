import { NextResponse } from 'next/server';
import { normalizePricingRuleInput } from '../../../../lib/pricing.js';
import { supabaseInsert, supabaseSelect } from '../../../../lib/supabase-admin.js';
import { resolveWorkspaceId } from '../../../../lib/workspace.js';

export async function GET(request) {
  try {
    const workspaceId = await resolveWorkspaceId(request);
    const rules = await supabaseSelect(
      'model_pricing_rules',
      `?workspace_id=eq.${encodeURIComponent(workspaceId)}&status=eq.active&select=id,provider_connection_id,model_pattern,input_usd_per_1m_tokens,output_usd_per_1m_tokens,currency,status,created_at&order=created_at.desc`
    );
    return NextResponse.json(rules);
  } catch (error) {
    const status = error.status || 400;
    const code = error.code || (status >= 500 ? 'persistence_error' : 'validation_error');
    return NextResponse.json({ error: { code, message: error.message } }, { status });
  }
}

export async function POST(request) {
  try {
    const workspaceId = await resolveWorkspaceId(request);
    const input = normalizePricingRuleInput(await request.json());

    if (input.provider_connection_id) {
      const providers = await supabaseSelect(
        'provider_connections',
        `?id=eq.${encodeURIComponent(input.provider_connection_id)}&workspace_id=eq.${encodeURIComponent(workspaceId)}&select=id&limit=1`
      );
      if (providers.length === 0) {
        throw Object.assign(new Error('provider not found'), { status: 404, code: 'not_found' });
      }
    }

    const [rule] = await supabaseInsert('model_pricing_rules', [{
      workspace_id: workspaceId,
      provider_connection_id: input.provider_connection_id,
      model_pattern: input.model_pattern,
      input_usd_per_1m_tokens: input.input_usd_per_1m_tokens,
      output_usd_per_1m_tokens: input.output_usd_per_1m_tokens,
      currency: 'USD',
      status: 'active'
    }]);

    return NextResponse.json({
      id: rule.id,
      provider_connection_id: rule.provider_connection_id,
      model_pattern: rule.model_pattern,
      input_usd_per_1m_tokens: rule.input_usd_per_1m_tokens,
      output_usd_per_1m_tokens: rule.output_usd_per_1m_tokens,
      currency: rule.currency,
      status: rule.status,
      created_at: rule.created_at
    }, { status: 201 });
  } catch (error) {
    const status = error.status || 400;
    const code = error.code || (status >= 500 ? 'persistence_error' : 'validation_error');
    return NextResponse.json({ error: { code, message: error.message } }, { status });
  }
}
