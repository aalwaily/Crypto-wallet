import { describe, expect, it } from 'vitest';
import { DecryptionError, decryptString, encryptString } from '../wallet/encryption';

describe('encryption', () => {
  const SECRET = 'test secret phrase for the vault';
  const PASSWORD = 'correct horse battery staple';

  it('round-trips plaintext through encrypt/decrypt', async () => {
    const payload = await encryptString(SECRET, PASSWORD);
    expect(await decryptString(payload, PASSWORD)).toBe(SECRET);
  });

  it('produces well-formed payload metadata', async () => {
    const payload = await encryptString(SECRET, PASSWORD);
    expect(payload.v).toBe(1);
    expect(payload.kdf).toBe('PBKDF2-SHA256');
    expect(payload.iterations).toBeGreaterThanOrEqual(600_000);
    expect(payload.ciphertext).not.toContain(SECRET);
  });

  it('uses a fresh salt and IV per encryption', async () => {
    const a = await encryptString(SECRET, PASSWORD);
    const b = await encryptString(SECRET, PASSWORD);
    expect(a.salt).not.toBe(b.salt);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it('rejects a wrong password', async () => {
    const payload = await encryptString(SECRET, PASSWORD);
    await expect(decryptString(payload, 'wrong password')).rejects.toThrow(DecryptionError);
  });

  it('rejects tampered ciphertext (GCM auth)', async () => {
    const payload = await encryptString(SECRET, PASSWORD);
    const bytes = Uint8Array.from(atob(payload.ciphertext), (c) => c.charCodeAt(0));
    bytes[0] = bytes[0]! ^ 0xff;
    const tampered = { ...payload, ciphertext: btoa(String.fromCharCode(...bytes)) };
    await expect(decryptString(tampered, PASSWORD)).rejects.toThrow(DecryptionError);
  });
});
