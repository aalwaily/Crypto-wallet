import { beforeEach, describe, expect, it } from 'vitest';
import {
  addWallet,
  createFirstWallet,
  deleteAllWallets,
  loadWalletMeta,
  removeWallet,
  renameWallet,
  revealWallet,
  setActiveWallet,
  unlockAll,
  VaultError,
  vaultExists,
} from '../wallet/vault';
import { encryptString } from '../wallet/encryption';
import { DecryptionError } from '../wallet/encryption';
import { __clearMemoryStorage, storageSet } from '../wallet/storage';

const MNEMONIC_A =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const MNEMONIC_B =
  'legal winner thank year wave sausage worth useful legal winner thank yellow';
const PASSWORD = 'a strong enough password';

describe('vault (multi-wallet)', () => {
  beforeEach(() => {
    __clearMemoryStorage();
  });

  it('creates and unlocks the first wallet', async () => {
    expect(await vaultExists()).toBe(false);
    await createFirstWallet(MNEMONIC_A, PASSWORD, 'Main');
    expect(await vaultExists()).toBe(true);
    const unlocked = await unlockAll(PASSWORD);
    expect(unlocked.wallets).toHaveLength(1);
    expect(unlocked.wallets[0]!.mnemonic).toBe(MNEMONIC_A);
    expect(unlocked.wallets[0]!.name).toBe('Main');
    expect(unlocked.activeId).toBe(unlocked.wallets[0]!.id);
  });

  it('adds a second wallet and makes it active', async () => {
    await createFirstWallet(MNEMONIC_A, PASSWORD, 'One');
    const id2 = await addWallet(MNEMONIC_B, PASSWORD, 'Two', 'legacy');
    const unlocked = await unlockAll(PASSWORD);
    expect(unlocked.wallets).toHaveLength(2);
    expect(unlocked.activeId).toBe(id2);
    const two = unlocked.wallets.find((w) => w.id === id2);
    expect(two!.mnemonic).toBe(MNEMONIC_B);
    expect(two!.btcAddressType).toBe('legacy');
  });

  it('rejects adding a wallet with the wrong password', async () => {
    await createFirstWallet(MNEMONIC_A, PASSWORD);
    await expect(addWallet(MNEMONIC_B, 'wrong password', 'Two')).rejects.toThrow(DecryptionError);
  });

  it('rejects adding a duplicate seed', async () => {
    await createFirstWallet(MNEMONIC_A, PASSWORD);
    await expect(addWallet(MNEMONIC_A, PASSWORD, 'Dup')).rejects.toThrow(/already added/);
  });

  it('rejects the wrong password on unlock', async () => {
    await createFirstWallet(MNEMONIC_A, PASSWORD);
    await expect(unlockAll('nope nope nope')).rejects.toThrow(DecryptionError);
  });

  it('reveals a single wallet with password re-entry', async () => {
    await createFirstWallet(MNEMONIC_A, PASSWORD);
    const meta = await loadWalletMeta();
    const id = meta!.wallets[0]!.id;
    expect(await revealWallet(id, PASSWORD)).toBe(MNEMONIC_A);
    await expect(revealWallet(id, 'bad')).rejects.toThrow(DecryptionError);
  });

  it('switches, renames, and removes wallets', async () => {
    const id1 = await createFirstWallet(MNEMONIC_A, PASSWORD, 'One');
    const id2 = await addWallet(MNEMONIC_B, PASSWORD, 'Two');
    await setActiveWallet(id1);
    expect((await loadWalletMeta())!.activeId).toBe(id1);
    await renameWallet(id1, 'Renamed');
    expect((await loadWalletMeta())!.wallets.find((w) => w.id === id1)!.name).toBe('Renamed');
    // Removing the active wallet re-activates a remaining one.
    const remaining = await removeWallet(id1);
    expect(remaining).toBe(1);
    expect((await loadWalletMeta())!.activeId).toBe(id2);
  });

  it('deleting the last wallet clears the store', async () => {
    const id = await createFirstWallet(MNEMONIC_A, PASSWORD);
    expect(await removeWallet(id)).toBe(0);
    expect(await vaultExists()).toBe(false);
  });

  it('refuses to store an invalid mnemonic', async () => {
    await expect(createFirstWallet('not valid words at all', PASSWORD)).rejects.toThrow(VaultError);
    expect(await vaultExists()).toBe(false);
  });

  it('migrates a legacy v1 single vault on first read', async () => {
    // Seed the old single-vault format directly.
    await storageSet('vault', {
      version: 1,
      createdAt: '2020-01-01T00:00:00.000Z',
      payload: await encryptString(MNEMONIC_A, PASSWORD),
    });
    expect(await vaultExists()).toBe(true);
    const unlocked = await unlockAll(PASSWORD);
    expect(unlocked.wallets).toHaveLength(1);
    expect(unlocked.wallets[0]!.mnemonic).toBe(MNEMONIC_A);
    expect(unlocked.wallets[0]!.name).toBe('Wallet 1');
    expect(unlocked.wallets[0]!.btcAddressType).toBe('native');
  });

  it('deletes all wallets', async () => {
    await createFirstWallet(MNEMONIC_A, PASSWORD);
    await deleteAllWallets();
    expect(await vaultExists()).toBe(false);
  });
});
