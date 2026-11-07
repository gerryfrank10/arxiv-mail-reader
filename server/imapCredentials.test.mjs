import { describe, expect, it } from 'vitest';
import { decryptImapConfig, encryptImapConfig } from './imapCredentials.mjs';

describe('saved IMAP credentials encryption', () => {
  it('encrypts the mailbox config and round-trips it', () => {
    const previousKey = process.env.IMAP_CREDENTIALS_KEY;
    process.env.IMAP_CREDENTIALS_KEY = 'test-only-stable-key';
    try {
      const config = {
        host: 'imap.example.com',
        port: 993,
        username: 'reader@example.com',
        password: 'secret-app-password',
      };
      const encrypted = encryptImapConfig(config);
      expect(JSON.stringify(encrypted)).not.toContain(config.password);
      expect(decryptImapConfig(encrypted)).toEqual(config);
    } finally {
      if (previousKey === undefined) delete process.env.IMAP_CREDENTIALS_KEY;
      else process.env.IMAP_CREDENTIALS_KEY = previousKey;
    }
  });

  it('rejects a modified ciphertext', () => {
    const previousKey = process.env.IMAP_CREDENTIALS_KEY;
    process.env.IMAP_CREDENTIALS_KEY = 'test-only-stable-key';
    try {
      const encrypted = encryptImapConfig({ host: 'imap.example.com', password: 'secret' });
      encrypted.ciphertext = `${encrypted.ciphertext.slice(0, -4)}AAAA`;
      expect(() => decryptImapConfig(encrypted)).toThrow();
    } finally {
      if (previousKey === undefined) delete process.env.IMAP_CREDENTIALS_KEY;
      else process.env.IMAP_CREDENTIALS_KEY = previousKey;
    }
  });
});
