const allowedPeriods = new Set(['today', '7d', '30d']);

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
  const totalTokens = safeEvents.reduce((sum, event) => sum + Number(event.total_tokens || 0), 0);
  const failedCount = safeEvents.filter((event) => event.status === 'failed').length;
  const fallbackCount = safeEvents.filter((event) => event.status === 'fallback').length;
  const successRate = totalRequests === 0 ? 0 : (totalRequests - failedCount) / totalRequests;

  return {
    total_requests: totalRequests,
    total_tokens: totalTokens,
    success_rate: successRate,
    fallback_count: fallbackCount,
    failed_count: failedCount,
    estimated_cost_usd: 0
  };
}
