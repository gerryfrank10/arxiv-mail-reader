import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

function encryptionKey() {
  // Set IMAP_CREDENTIALS_KEY to a stable, high-entropy secret in production.
  // The fallbacks keep existing single-server deployments working without an
  // immediate config change; rotating DATABASE_URL will require users to save
  // their mailbox credentials again if the explicit key is not configured.
  const secret = process.env.IMAP_CREDENTIALS_KEY
    || process.env.APP_AUTH_TOKEN
    || process.env.DATABASE_URL;
  if (!secret) throw new Error('Set IMAP_CREDENTIALS_KEY to encrypt mailbox credentials.');
  return createHash('sha256')
    .update('arxiv-mail-reader:imap-credentials:v1:')
    .update(secret)
    .digest();
}

export function encryptImapConfig(config) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(config), 'utf8'),
    cipher.final(),
  ]);
  return {
    version: 1,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
}

export function decryptImapConfig(envelope) {
  if (!envelope || envelope.version !== 1) {
    throw new Error('Stored mailbox credentials use an unsupported encryption format.');
  }
  const decipher = createDecipheriv(
    'aes-256-gcm',
    encryptionKey(),
    Buffer.from(envelope.iv, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
  return JSON.parse(plaintext);
}
