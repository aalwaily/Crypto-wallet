/**
 * The vault is the encrypted-at-rest form of the wallet: a single record in
 * chrome.storage.local holding the AES-GCM encrypted mnemonic. The plaintext
 * mnemonic must never be written to persistent storage.
 */
import { z } from 'zod';
import {
  encryptString,
  decryptString,
  encryptedPayloadSchema,
} from './encryption';
import { validateMnemonic, normalizeMnemonic } from './mnemonic';
import { storageGet, storageSet, storageRemove } from './storage';

const VAULT_KEY = 'vault';

const vaultFileSchema = z.object({
  version: z.literal(1),
  createdAt: z.string(),
  payload: encryptedPayloadSchema,
});

export type VaultFile = z.infer<typeof vaultFileSchema>;

export class VaultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VaultError';
  }
}

export async function vaultExists(): Promise<boolean> {
  return (await storageGet<VaultFile>(VAULT_KEY)) !== undefined;
}

export async function createVault(mnemonic: string, password: string): Promise<void> {
  const normalized = normalizeMnemonic(mnemonic);
  if (!validateMnemonic(normalized)) {
    throw new VaultError('Refusing to store an invalid mnemonic.');
  }
  if (await vaultExists()) {
    throw new VaultError('A vault already exists. Delete it in Settings before creating a new one.');
  }
  const vault: VaultFile = {
    version: 1,
    createdAt: new Date().toISOString(),
    payload: await encryptString(normalized, password),
  };
  await storageSet(VAULT_KEY, vault);
}

/** Decrypts and returns the mnemonic. Throws DecryptionError on a wrong password. */
export async function unlockVault(password: string): Promise<string> {
  const raw = await storageGet<unknown>(VAULT_KEY);
  if (raw === undefined) {
    throw new VaultError('No wallet found. Create or import one first.');
  }
  const vault = vaultFileSchema.parse(raw);
  const mnemonic = await decryptString(vault.payload, password);
  if (!validateMnemonic(mnemonic)) {
    throw new VaultError('Vault decrypted to an invalid mnemonic — the vault may be corrupted.');
  }
  return mnemonic;
}

export async function deleteVault(): Promise<void> {
  await storageRemove(VAULT_KEY);
}
