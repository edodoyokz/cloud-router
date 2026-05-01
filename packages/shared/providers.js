export const ProviderFamilies = {
  OAUTH: 'oauth',
  API_KEY: 'apikey',
  HYBRID: 'hybrid'
};

export const ProviderCapabilities = {
  MODEL_SELECTION: 'model_selection',
  STREAMING: 'streaming',
  FALLBACK: 'fallback',
  QUOTA: 'quota',
  TOOL_USE: 'tool_use'
};

export const ProviderRegistry = {
  codex: {
    slug: 'codex',
    displayName: 'Codex OAuth',
    family: ProviderFamilies.OAUTH,
    capabilities: [ProviderCapabilities.MODEL_SELECTION, ProviderCapabilities.STREAMING, ProviderCapabilities.FALLBACK, ProviderCapabilities.QUOTA, ProviderCapabilities.TOOL_USE]
  },
  kimi: {
    slug: 'kimi',
    displayName: 'Kimi',
    family: ProviderFamilies.API_KEY,
    capabilities: [ProviderCapabilities.MODEL_SELECTION, ProviderCapabilities.STREAMING, ProviderCapabilities.FALLBACK, ProviderCapabilities.QUOTA]
  },
  minimax: {
    slug: 'minimax',
    displayName: 'MiniMax',
    family: ProviderFamilies.API_KEY,
    capabilities: [ProviderCapabilities.MODEL_SELECTION, ProviderCapabilities.STREAMING, ProviderCapabilities.FALLBACK, ProviderCapabilities.QUOTA]
  },
  zai: {
    slug: 'zai',
    displayName: 'ZAI',
    family: ProviderFamilies.API_KEY,
    capabilities: [ProviderCapabilities.MODEL_SELECTION, ProviderCapabilities.STREAMING, ProviderCapabilities.FALLBACK, ProviderCapabilities.QUOTA]
  },
  alibaba: {
    slug: 'alibaba',
    displayName: 'Alibaba',
    family: ProviderFamilies.OAUTH,
    capabilities: [ProviderCapabilities.MODEL_SELECTION, ProviderCapabilities.STREAMING, ProviderCapabilities.FALLBACK, ProviderCapabilities.QUOTA]
  }
};

export function getProviderConfig(slug) {
  return ProviderRegistry[String(slug || '').toLowerCase()];
}
