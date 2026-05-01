export const ALLOWED_PROVIDER_TAGS = ['primary', 'backup', 'free', 'cheap'];

const tagLabels = {
  primary: 'Primary',
  backup: 'Backup',
  free: 'Free',
  cheap: 'Cheap'
};

export function normalizeProviderTags(value) {
  if (!Array.isArray(value)) return [];
  const input = new Set(
    value
      .filter((tag) => typeof tag === 'string')
      .map((tag) => tag.trim().toLowerCase())
      .filter((tag) => ALLOWED_PROVIDER_TAGS.includes(tag))
  );

  return ALLOWED_PROVIDER_TAGS.filter((tag) => input.has(tag));
}

export function providerTagLabel(tag) {
  return tagLabels[tag] || tag;
}

export function mergeProviderMetadataTags(metadata, tags) {
  const current = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {};
  return {
    ...current,
    tags: normalizeProviderTags(tags)
  };
}
