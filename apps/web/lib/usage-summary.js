const allowedPeriods = new Set(['today', '7d', '30d']);

export const ANALYTICS_USAGE_EVENT_LIMIT = 5000;

export function normalizeUsagePeriod(period) {
  const value = String(period || 'today').trim();
  if (!allowedPeriods.has(value)) {
    throw Object.assign(new Error('invalid usage period'), { status: 400, code: 'validation_error' });
  }
  return value;
}

export function usageSinceISOString(period, now = new Date()) {
  const normalized = normalizeUsagePeriod(period);
  const since = new Date(now);

  if (normalized === 'today') {
    since.setUTCHours(0, 0, 0, 0);
    return since.toISOString();
  }

  const days = normalized === '7d' ? 7 : 30;
  since.setUTCDate(since.getUTCDate() - days);
  return since.toISOString();
}

export function clampUsageLimit(limit) {
  const parsed = Number.parseInt(String(limit || '50'), 10);
  if (Number.isNaN(parsed)) return 50;
  return Math.min(100, Math.max(1, parsed));
}

export function summarizeUsageEvents(events) {
  const safeEvents = Array.isArray(events) ? events : [];
  const totalRequests = safeEvents.length;
  const promptTokens = safeEvents.reduce((sum, event) => sum + Number(event.prompt_tokens || 0), 0);
  const completionTokens = safeEvents.reduce((sum, event) => sum + Number(event.completion_tokens || 0), 0);
  const totalTokens = safeEvents.reduce((sum, event) => sum + Number(event.total_tokens || 0), 0);
  const estimatedCostUsd = safeEvents.reduce((sum, event) => sum + Number(event.estimated_cost_usd || 0), 0);
  const failedCount = safeEvents.filter((event) => event.status === 'failed').length;
  const fallbackCount = safeEvents.filter((event) => event.status === 'fallback').length;
  const successRate = totalRequests === 0 ? 0 : (totalRequests - failedCount) / totalRequests;

  return {
    total_requests: totalRequests,
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: totalTokens,
    success_rate: successRate,
    fallback_count: fallbackCount,
    failed_count: failedCount,
    estimated_cost_usd: estimatedCostUsd
  };
}

function toDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfUtcHour(date) {
  const copy = new Date(date);
  copy.setUTCMinutes(0, 0, 0);
  return copy;
}

function startOfUtcDay(date) {
  const copy = new Date(date);
  copy.setUTCHours(0, 0, 0, 0);
  return copy;
}

function addHours(date, hours) {
  const copy = new Date(date);
  copy.setUTCHours(copy.getUTCHours() + hours);
  return copy;
}

function addDays(date, days) {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function formatBucketLabel(date, period) {
  if (period === 'today') {
    return `${String(date.getUTCHours()).padStart(2, '0')}:00`;
  }

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC'
  });
}

function emptyAggregate() {
  return {
    requests: 0,
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
    estimated_cost_usd: 0,
    failed_count: 0,
    fallback_count: 0
  };
}

function addEventToAggregate(aggregate, event) {
  aggregate.requests += 1;
  aggregate.prompt_tokens += Number(event.prompt_tokens || 0);
  aggregate.completion_tokens += Number(event.completion_tokens || 0);
  aggregate.total_tokens += Number(event.total_tokens || 0);
  aggregate.estimated_cost_usd += Number(event.estimated_cost_usd || 0);
  if (event.status === 'failed') aggregate.failed_count += 1;
  if (event.status === 'fallback') aggregate.fallback_count += 1;
  return aggregate;
}

function finalizeAggregate(aggregate) {
  return {
    ...aggregate,
    success_rate: aggregate.requests === 0 ? 0 : (aggregate.requests - aggregate.failed_count) / aggregate.requests
  };
}

export function buildUsageBuckets(events, period, now = new Date()) {
  const normalized = normalizeUsagePeriod(period);
  const safeEvents = Array.isArray(events) ? events : [];
  const since = new Date(usageSinceISOString(normalized, now));
  const bucketMap = new Map();

  let cursor;
  let end;
  let step;

  if (normalized === 'today') {
    cursor = startOfUtcHour(since);
    end = startOfUtcHour(now);
    step = (date) => addHours(date, 1);
  } else {
    cursor = startOfUtcDay(since);
    end = startOfUtcDay(now);
    step = (date) => addDays(date, 1);
  }

  while (cursor.getTime() <= end.getTime()) {
    bucketMap.set(cursor.toISOString(), emptyAggregate());
    cursor = step(cursor);
  }

  for (const event of safeEvents) {
    const eventDate = toDate(event.created_at);
    if (!eventDate) continue;
    const bucketDate = normalized === 'today' ? startOfUtcHour(eventDate) : startOfUtcDay(eventDate);
    const key = bucketDate.toISOString();
    if (!bucketMap.has(key)) continue;
    addEventToAggregate(bucketMap.get(key), event);
  }

  return Array.from(bucketMap.entries()).map(([bucket, aggregate]) => ({
    bucket,
    label: formatBucketLabel(new Date(bucket), normalized),
    ...finalizeAggregate(aggregate)
  }));
}

export function buildProviderBreakdown(events, providers = []) {
  const providerMap = new Map((Array.isArray(providers) ? providers : []).map((provider) => [provider.id, provider]));
  const groups = new Map();

  for (const event of Array.isArray(events) ? events : []) {
    const providerId = event.provider_connection_id || 'unknown';
    if (!groups.has(providerId)) groups.set(providerId, emptyAggregate());
    addEventToAggregate(groups.get(providerId), event);
  }

  return Array.from(groups.entries())
    .map(([providerId, aggregate]) => {
      const provider = providerMap.get(providerId);
      return {
        provider_connection_id: providerId === 'unknown' ? null : providerId,
        display_name: provider?.display_name || 'Unknown provider',
        provider_type: provider?.provider_type || null,
        ...finalizeAggregate(aggregate)
      };
    })
    .sort((a, b) => (b.requests - a.requests) || (b.total_tokens - a.total_tokens));
}

export function buildModelBreakdown(events) {
  const groups = new Map();
  const missingPricingCounts = new Map();

  for (const event of Array.isArray(events) ? events : []) {
    const model = event.model_resolved || event.model_requested || 'unknown';
    if (!groups.has(model)) groups.set(model, emptyAggregate());
    addEventToAggregate(groups.get(model), event);
    if (event.pricing_rule_missing) missingPricingCounts.set(model, (missingPricingCounts.get(model) || 0) + 1);
  }

  return Array.from(groups.entries())
    .map(([model, aggregate]) => ({
      model,
      ...finalizeAggregate(aggregate),
      pricing_rule_missing_count: missingPricingCounts.get(model) || 0
    }))
    .sort((a, b) => (b.total_tokens - a.total_tokens) || (b.requests - a.requests));
}

export function buildStatusBreakdown(events) {
  const safeEvents = Array.isArray(events) ? events : [];
  const groups = new Map();

  for (const event of safeEvents) {
    const status = event.status || 'unknown';
    if (!groups.has(status)) groups.set(status, emptyAggregate());
    addEventToAggregate(groups.get(status), event);
  }

  return Array.from(groups.entries())
    .map(([status, aggregate]) => ({
      status,
      ...finalizeAggregate(aggregate),
      percentage: safeEvents.length === 0 ? 0 : aggregate.requests / safeEvents.length
    }))
    .sort((a, b) => b.requests - a.requests);
}

export function buildUsageAnalytics(events, providers, period, now = new Date()) {
  const safeEvents = Array.isArray(events) ? events : [];
  return {
    analytics: {
      event_count: safeEvents.length,
      truncated: safeEvents.length >= ANALYTICS_USAGE_EVENT_LIMIT,
      max_events: ANALYTICS_USAGE_EVENT_LIMIT
    },
    charts: {
      usage_buckets: buildUsageBuckets(safeEvents, period, now)
    },
    breakdowns: {
      providers: buildProviderBreakdown(safeEvents, providers),
      models: buildModelBreakdown(safeEvents),
      statuses: buildStatusBreakdown(safeEvents)
    }
  };
}
