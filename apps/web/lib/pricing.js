export function normalizePricingRuleInput(input) {
  const provider_connection_id = normalizeOptionalId(input?.provider_connection_id);
  const model_pattern = String(input?.model_pattern || '').trim();
  const input_usd_per_1m_tokens = normalizePrice(input?.input_usd_per_1m_tokens, 'input_usd_per_1m_tokens');
  const output_usd_per_1m_tokens = normalizePrice(input?.output_usd_per_1m_tokens, 'output_usd_per_1m_tokens');

  if (!model_pattern) {
    throw Object.assign(new Error('model_pattern is required'), { status: 400, code: 'validation_error' });
  }

  return {
    provider_connection_id,
    model_pattern,
    input_usd_per_1m_tokens,
    output_usd_per_1m_tokens
  };
}

export function enrichUsageEventsWithPricing(events, rules) {
  const safeEvents = Array.isArray(events) ? events : [];
  return safeEvents.map((event) => {
    const rule = findPricingRuleForEvent(event, rules);
    const estimatedCost = rule ? calculateEstimatedCost(event, rule) : 0;
    return {
      ...event,
      estimated_cost_usd: estimatedCost,
      pricing_rule_missing: !rule
    };
  });
}

export function calculateEstimatedCost(event, rule) {
  const promptTokens = Number(event?.prompt_tokens || 0);
  const completionTokens = Number(event?.completion_tokens || 0);
  const inputPrice = Number(rule?.input_usd_per_1m_tokens || 0);
  const outputPrice = Number(rule?.output_usd_per_1m_tokens || 0);
  return (promptTokens / 1_000_000 * inputPrice) + (completionTokens / 1_000_000 * outputPrice);
}

export function findPricingRuleForEvent(event, rules) {
  const model = String(event?.model_resolved || '').trim();
  if (!model) return null;
  const safeRules = Array.isArray(rules) ? rules : [];
  const activeMatches = safeRules.filter((rule) =>
    rule?.status === 'active' && String(rule?.model_pattern || '').trim() === model
  );
  const providerId = event?.provider_connection_id;
  const providerMatch = activeMatches.find((rule) => rule.provider_connection_id && rule.provider_connection_id === providerId);
  if (providerMatch) return providerMatch;
  return activeMatches.find((rule) => !rule.provider_connection_id) || null;
}

function normalizeOptionalId(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function normalizePrice(value, field) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw Object.assign(new Error(`${field} must be a non-negative number`), { status: 400, code: 'validation_error' });
  }
  return parsed;
}
