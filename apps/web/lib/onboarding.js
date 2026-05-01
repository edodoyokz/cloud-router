export const ONBOARDING_STEPS = [
  {
    id: 'connect_provider',
    label: 'Connect a provider',
    description: 'Add an OpenAI-compatible API-key provider.',
    source: 'derived'
  },
  {
    id: 'check_provider_health',
    label: 'Run a provider health check',
    description: 'Verify NusaNexus Router can reach at least one provider.',
    source: 'derived'
  },
  {
    id: 'generate_router_key',
    label: 'Generate a router API key',
    description: 'Create a key for Claude Code, Codex, OpenClaw, Cursor, or cURL.',
    source: 'derived'
  },
  {
    id: 'copy_client_snippet',
    label: 'Copy a client snippet',
    description: 'Copy a ready-to-use setup snippet from Endpoint config.',
    source: 'persisted'
  },
  {
    id: 'send_first_request',
    label: 'Send your first request',
    description: 'Make one successful request through the hosted router.',
    source: 'derived'
  }
];

export const PERSISTED_ONBOARDING_STEP_IDS = ['copy_client_snippet'];

export function normalizeOnboardingState(value) {
  const state = value && typeof value === 'object' ? value : {};
  const completedSteps = Array.isArray(state.completed_steps) ? state.completed_steps : [];
  return {
    dismissed: Boolean(state.dismissed),
    completed_steps: completedSteps.filter((step) => PERSISTED_ONBOARDING_STEP_IDS.includes(step)),
    updated_at: typeof state.updated_at === 'string' ? state.updated_at : null
  };
}

export function validatePersistedOnboardingSteps(steps) {
  if (!Array.isArray(steps)) {
    throw Object.assign(new Error('completed_steps must be an array'), { status: 400, code: 'validation_error' });
  }
  const unknown = steps.filter((step) => !PERSISTED_ONBOARDING_STEP_IDS.includes(step));
  if (unknown.length > 0) {
    throw Object.assign(new Error(`unknown onboarding step: ${unknown[0]}`), { status: 400, code: 'validation_error' });
  }
  return Array.from(new Set(steps));
}

export function buildOnboardingChecklist({ onboardingState, hasProvider, hasHealthyProvider, hasApiKey, hasUsageEvent }) {
  const state = normalizeOnboardingState(onboardingState);
  const derivedCompletion = {
    connect_provider: Boolean(hasProvider),
    check_provider_health: Boolean(hasHealthyProvider),
    generate_router_key: Boolean(hasApiKey),
    send_first_request: Boolean(hasUsageEvent)
  };
  const persisted = new Set(state.completed_steps);
  const steps = ONBOARDING_STEPS.map((step) => {
    const complete = step.source === 'persisted' ? persisted.has(step.id) : Boolean(derivedCompletion[step.id]);
    return { ...step, complete };
  });
  return {
    dismissed: state.dismissed,
    steps,
    completed_count: steps.filter((step) => step.complete).length,
    total_count: steps.length
  };
}

export function mergeOnboardingMetadata(metadata, onboardingPatch) {
  return {
    ...(metadata || {}),
    onboarding: {
      ...normalizeOnboardingState(metadata?.onboarding),
      ...onboardingPatch,
      updated_at: new Date().toISOString()
    }
  };
}
