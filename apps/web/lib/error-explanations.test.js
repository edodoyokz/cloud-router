import assert from 'node:assert/strict';
import test from 'node:test';
import { explainErrorCode, explainProviderHealth, explainUsageEvent } from './error-explanations.js';

test('explains unsupported streaming usage events', () => {
  const explanation = explainUsageEvent({ status: 'failed', error_code: 'unsupported_streaming' });

  assert.equal(explanation.severity, 'error');
  assert.match(explanation.title, /streaming/i);
  assert.ok(explanation.nextActions.some((action) => action.includes('stream')));
});

test('explains fallback status as warning even without error code', () => {
  const explanation = explainUsageEvent({ status: 'fallback', error_code: null });

  assert.equal(explanation.severity, 'warning');
  assert.match(explanation.title, /fallback/i);
});

test('returns null for clean success usage event', () => {
  assert.equal(explainUsageEvent({ status: 'success', error_code: null }), null);
});

test('explains invalid api key by code', () => {
  const explanation = explainErrorCode('invalid_api_key');

  assert.equal(explanation.severity, 'error');
  assert.match(explanation.title, /api key/i);
});

test('explains provider auth health failures from sanitized messages', () => {
  const explanation = explainProviderHealth({
    quota_state: {
      health: 'error',
      last_error_message: 'Provider returned 401 unauthorized'
    }
  });

  assert.equal(explanation.severity, 'error');
  assert.match(explanation.title, /credential|auth/i);
  assert.ok(explanation.nextActions.some((action) => action.toLowerCase().includes('api key')));
});

test('explains unknown provider health', () => {
  const explanation = explainProviderHealth({ quota_state: { health: 'unknown' } });

  assert.equal(explanation.severity, 'warning');
  assert.match(explanation.title, /unknown/i);
});

test('does not show panel for healthy provider', () => {
  assert.equal(explainProviderHealth({ quota_state: { health: 'healthy' } }), null);
});
