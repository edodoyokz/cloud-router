import { normalizeProviderTags, providerTagLabel } from './provider-tags.js';

const tagPriority = ['primary', 'cheap', 'free', 'backup'];
const healthPriority = new Map([
  ['ok', 0],
  ['healthy', 0],
  ['unknown', 1],
  ['error', 2]
]);

function providerHealth(provider) {
  return provider?.quota_state?.health || 'unknown';
}

function providerDisplayName(provider) {
  return provider?.display_name || 'Unnamed provider';
}

function tagRank(provider) {
  const tags = normalizeProviderTags(provider?.metadata?.tags);
  const ranks = tags.map((tag) => tagPriority.indexOf(tag)).filter((rank) => rank >= 0);
  return ranks.length > 0 ? Math.min(...ranks) : tagPriority.length;
}

function primaryTag(provider) {
  const tags = normalizeProviderTags(provider?.metadata?.tags);
  return tagPriority.find((tag) => tags.includes(tag)) || null;
}

function healthRank(provider) {
  return healthPriority.get(providerHealth(provider)) ?? 1;
}

function compareProviders(left, right) {
  const rankDelta = tagRank(left) - tagRank(right);
  if (rankDelta !== 0) return rankDelta;

  const healthDelta = healthRank(left) - healthRank(right);
  if (healthDelta !== 0) return healthDelta;

  const nameDelta = providerDisplayName(left).localeCompare(providerDisplayName(right));
  if (nameDelta !== 0) return nameDelta;

  return String(left?.id || '').localeCompare(String(right?.id || ''));
}

export function buildTagBasedFallbackSuggestion(providers) {
  const rows = Array.isArray(providers) ? providers : [];
  const excluded = [];
  const eligible = [];

  for (const provider of rows) {
    if (provider?.status === 'disconnected') {
      excluded.push({
        id: provider?.id || null,
        display_name: providerDisplayName(provider),
        reason: 'Disconnected providers cannot be added to the default fallback chain.'
      });
      continue;
    }

    if (provider?.status === 'active' || provider?.status === 'error') {
      eligible.push(provider);
    }
  }

  const steps = [...eligible].sort(compareProviders).map((provider) => ({
    provider_connection_id: provider.id,
    display_name: providerDisplayName(provider),
    status: provider.status,
    health: providerHealth(provider),
    model_alias: '',
    suggestion_tag: primaryTag(provider),
    suggestion_label: primaryTag(provider) ? providerTagLabel(primaryTag(provider)) : 'No tag'
  }));

  return {
    steps,
    reasons: [
      'Primary providers are tried first.',
      'Cheap/free providers are preferred before backup providers.',
      'Disconnected providers are excluded.'
    ],
    excluded
  };
}
