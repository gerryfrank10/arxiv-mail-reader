// Password + session helpers. No external deps: scrypt from node:crypto.
import { scryptSync, randomBytes, createHash, timingSafeEqual } from 'node:crypto';

const KEYLEN = 64;

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const key  = scryptSync(String(password), salt, KEYLEN).toString('hex');
  return `scrypt$${salt}$${key}`;
}

export function verifyPassword(password, stored) {
  if (!stored) return false;
  const [scheme, salt, key] = String(stored).split('$');
  if (scheme !== 'scrypt' || !salt || !key) return false;
  const expected = Buffer.from(key, 'hex');
  if (expected.length === 0) return false;
  const actual = scryptSync(String(password), salt, expected.length);
  return timingSafeEqual(expected, actual);
}

export function newSessionToken() {
  return randomBytes(32).toString('hex');
}

export function hashSessionToken(token) {
  return createHash('sha256').update(String(token)).digest('hex');
}
