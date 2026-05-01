import crypto from 'node:crypto';

export function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function generateApiKey() {
  const body = crypto.randomBytes(24).toString('base64url');
  return `nnr_${body}`;
}

export function apiKeyPrefix(rawKey) {
  return rawKey.length <= 10 ? rawKey : rawKey.slice(0, 10);
}

export function encryptCredential(keyHex, plaintext) {
  const key = Buffer.from(keyHex, 'hex');
  if (key.length !== 32) throw new Error('ENCRYPTION_KEY must be 32 bytes hex');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, encrypted, tag]).toString('base64');
}

export function decryptCredential(encrypted, keyHex = process.env.ENCRYPTION_KEY) {
  if (!encrypted) throw new Error('missing encrypted credential');
  if (!keyHex) throw new Error('ENCRYPTION_KEY is required');

  const key = Buffer.from(keyHex, 'hex');
  if (key.length !== 32) throw new Error('ENCRYPTION_KEY must be 32 bytes hex');

  const payload = Buffer.from(encrypted, 'base64');
  if (payload.length <= 28) throw new Error('invalid encrypted credential');

  const iv = payload.subarray(0, 12);
  const cipherText = payload.subarray(12, payload.length - 16);
  const tag = payload.subarray(payload.length - 16);

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(cipherText), decipher.final()]);

  return decrypted.toString('utf8');
}
