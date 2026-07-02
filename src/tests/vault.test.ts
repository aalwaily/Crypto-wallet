import { beforeEach, describe, expect, it } from 'vitest';
import { createVault, deleteVault, unlockVault, VaultError, vaultExists } from '../wallet/vault';
import { DecryptionError } from '../wallet/encryption';
import { __clearMemoryStorage } from '../wallet/storage';

const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PASSWORD = 'a strong enough password';

describe('vault', () => {
  beforeEach(() => {
    __clearMemoryStorage();
  });

  it('creates and unlocks a vault', async () => {
    expect(await vaultExists()).toBe(false);
    await createVault(MNEMONIC, PASSWORD);
    expect(await vaultExists()).toBe(true);
    expect(await unlockVault(PASSWORD)).toBe(MNEMONIC);
  });

  it('rejects the wrong password on unlock', async () => {
    await createVault(MNEMONIC, PASSWORD);
    await expect(unlockVault('nope nope nope')).rejects.toThrow(DecryptionError);
  });

  it('refuses to store an invalid mnemonic', async () => {
    await expect(createVault('definitely not valid words', PASSWORD)).rejects.toThrow(VaultError);
    expect(await vaultExists()).toBe(false);
  });

  it('refuses to overwrite an existing vault', async () => {
    await createVault(MNEMONIC, PASSWORD);
    await expect(createVault(MNEMONIC, 'other password')).rejects.toThrow(VaultError);
  });

  it('errors when unlocking a missing vault', async () => {
    await expect(unlockVault(PASSWORD)).rejects.toThrow(VaultError);
  });

  it('deletes the vault', async () => {
    await createVault(MNEMONIC, PASSWORD);
    await deleteVault();
    expect(await vaultExists()).toBe(false);
  });
});
