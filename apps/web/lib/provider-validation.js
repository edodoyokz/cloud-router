export function normalizeProviderInput(input) {
  const provider_type = input?.provider_type || 'openai_compatible';
  const auth_method = input?.auth_method || 'api_key';
  const display_name = String(input?.display_name || '').trim();
  const base_url = String(input?.base_url || '').trim().replace(/\/+$/, '');
  const api_key = String(input?.api_key || '').trim();
  const default_model = String(input?.default_model || '').trim();

  if (provider_type !== 'openai_compatible') throw new Error('unsupported provider_type');
  if (auth_method !== 'api_key') throw new Error('unsupported auth_method');
  if (!display_name) throw new Error('display_name is required');
  if (!base_url || !/^https?:\/\//.test(base_url)) throw new Error('valid base_url is required');
  if (!api_key) throw new Error('api_key is required');
  if (!default_model) throw new Error('default_model is required');

  return { provider_type, auth_method, display_name, base_url, api_key, default_model };
}
