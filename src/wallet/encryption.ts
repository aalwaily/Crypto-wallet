/**
 * AES-256-GCM encryption with a PBKDF2-SHA256 derived key, built entirely on
 * the Web Crypto API. A fresh random salt and IV are generated per encryption.
 */
import { z } from 'zod';
import { PBKDF2_ITERATIONS } from '../config';

export const encryptedPayloadSchema = z.object({
  v: z.literal(1),
  kdf: z.literal('PBKDF2-SHA256'),
  iterations: z.number().int().positive(),
  salt: z.string().min(1),
  iv: z.string().min(1),
  ciphertext: z.string().min(1),
});

export type EncryptedPayload = z.infer<typeof encryptedPayloadSchema>;

export class DecryptionError extends Error {
  constructor() {
    super('Decryption failed — wrong password or corrupted vault.');
    this.name = 'DecryptionError';
  }
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function deriveKey(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> {
  const passwordKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    passwordKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptString(
  plaintext: string,
  password: string,
): Promise<EncryptedPayload> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, PBKDF2_ITERATIONS);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    new TextEncoder().encode(plaintext),
  );
  return {
    v: 1,
    kdf: 'PBKDF2-SHA256',
    iterations: PBKDF2_ITERATIONS,
    salt: toBase64(salt),
    iv: toBase64(iv),
    ciphertext: toBase64(new Uint8Array(ciphertext)),
  };
}

export async function decryptString(
  payload: EncryptedPayload,
  password: string,
): Promise<string> {
  const parsed = encryptedPayloadSchema.parse(payload);
  const key = await deriveKey(password, fromBase64(parsed.salt), parsed.iterations);
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(parsed.iv) as BufferSource },
      key,
      fromBase64(parsed.ciphertext) as BufferSource,
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    // AES-GCM authentication failure — wrong key or tampered ciphertext.
    throw new DecryptionError();
  }
}
