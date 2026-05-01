import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTagBasedFallbackSuggestion } from './provider-routing-suggestions.js';

function provider(overrides) {
  return {
    id: overrides.id,
    display_name: overrides.display_name || overrides.id,
    status: overrides.status || 'active',
    quota_state: overrides.quota_state || {},
    metadata: overrides.metadata || {}
  };
}

test('orders providers by tag priority and excludes disconnected providers', () => {
  const suggestion = buildTagBasedFallbackSuggestion([
    provider({ id: 'backup', display_name: 'Backup', metadata: { tags: ['backup'] } }),
    provider({ id: 'cheap', display_name: 'Cheap', metadata: { tags: ['cheap'] } }),
    provider({ id: 'primary', display_name: 'Primary', metadata: { tags: ['primary'] } }),
    provider({ id: 'free', display_name: 'Free', metadata: { tags: ['free'] } }),
    provider({ id: 'old', display_name: 'Old', status: 'disconnected', metadata: { tags: ['primary'] } })
  ]);

  assert.deepEqual(suggestion.steps.map((step) => step.provider_connection_id), ['primary', 'cheap', 'free', 'backup']);
  assert.equal(suggestion.excluded.length, 1);
  assert.equal(suggestion.excluded[0].display_name, 'Old');
});

test('allows error providers but ranks unhealthy providers later within the same tag', () => {
  const suggestion = buildTagBasedFallbackSuggestion([
    provider({ id: 'bad', display_name: 'Bad Primary', status: 'error', quota_state: { health: 'error' }, metadata: { tags: ['primary'] } }),
    provider({ id: 'good', display_name: 'Good Primary', quota_state: { health: 'healthy' }, metadata: { tags: ['primary'] } })
  ]);

  assert.deepEqual(suggestion.steps.map((step) => step.provider_connection_id), ['good', 'bad']);
  assert.equal(suggestion.steps[1].status, 'error');
});

test('uses highest priority tag when provider has multiple tags', () => {
  const suggestion = buildTagBasedFallbackSuggestion([
    provider({ id: 'backup', metadata: { tags: ['backup'] } }),
    provider({ id: 'multi', metadata: { tags: ['backup', 'primary', 'cheap'] } })
  ]);

  assert.deepEqual(suggestion.steps.map((step) => step.provider_connection_id), ['multi', 'backup']);
});
