export const APP_NAME = '9router Cloud';
export const DEFAULT_ROUTER_PORT = 8080;
export const DEFAULT_WEB_PORT = 3000;
export const DEFAULT_PRESETS = ['Hemat', 'Stabil', 'Kualitas', 'Fallback Aman'];

export function normalizeProviderType(type) {
  return String(type || '').trim().toLowerCase();
}

export function normalizeProviderFamily(family) {
  return String(family || '').trim().toLowerCase();
}
