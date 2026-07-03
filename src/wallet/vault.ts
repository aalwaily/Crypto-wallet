/**
 * Multi-wallet vault. A single record in chrome.storage.local holds a list of
 * wallets, each with its own AES-GCM encrypted mnemonic. All wallets share one
 * app password. Plaintext mnemonics are never persisted. Wallet names and BTC
 * address types are stored in cleartext (not sensitive) so the UI can list
 * wallets without unlocking.
 *
 * v1 stored a single wallet under the `vault` key; it is migrated on first read.
 */
import { z } from 'zod';
import { encryptString, decryptString, encryptedPayloadSchema } from './encryption';
import { validateMnemonic, normalizeMnemonic } from './mnemonic';
import { storageGet, storageSet, storageRemove } from './storage';
import type { BtcAddressType } from './bitcoin';

const STORE_KEY = 'walletStore';
const LEGACY_KEY = 'vault';

const btcAddressTypeSchema = z.enum(['legacy', 'nested', 'native']);

const walletRecordSchema = z.object({
  id: z.string(),
  name: z.string(),
  btcAddressType: btcAddressTypeSchema.default('native'),
  createdAt: z.string(),
  payload: encryptedPayloadSchema,
});

const walletStoreSchema = z.object({
  version: z.literal(2),
  activeId: z.string(),
  wallets: z.array(walletRecordSchema).min(1),
});

type WalletStore = z.infer<typeof walletStoreSchema>;

const legacyVaultSchema = z.object({
  version: z.literal(1),
  createdAt: z.string(),
  payload: encryptedPayloadSchema,
});

export interface WalletMeta {
  id: string;
  name: string;
  btcAddressType: BtcAddressType;
  createdAt: string;
}

export interface WalletStoreMeta {
  activeId: string;
  wallets: WalletMeta[];
}

export interface UnlockedWallet extends WalletMeta {
  mnemonic: string;
}

export interface UnlockedStore {
  activeId: string;
  wallets: UnlockedWallet[];
}

export class VaultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VaultError';
  }
}

/** Reads the store, migrating a legacy single vault into the new format if needed. */
async function readStore(): Promise<WalletStore | undefined> {
  const raw = await storageGet<unknown>(STORE_KEY);
  if (raw !== undefined) return walletStoreSchema.parse(raw);

  const legacyRaw = await storageGet<unknown>(LEGACY_KEY);
  if (legacyRaw === undefined) return undefined;

  const legacy = legacyVaultSchema.parse(legacyRaw);
  const id = crypto.randomUUID();
  const store: WalletStore = {
    version: 2,
    activeId: id,
    wallets: [
      {
        id,
        name: 'Wallet 1',
        btcAddressType: 'native',
        createdAt: legacy.createdAt,
        payload: legacy.payload,
      },
    ],
  };
  await storageSet(STORE_KEY, store);
  await storageRemove(LEGACY_KEY);
  return store;
}

function toMeta(w: WalletStore['wallets'][number]): WalletMeta {
  return { id: w.id, name: w.name, btcAddressType: w.btcAddressType, createdAt: w.createdAt };
}

export async function vaultExists(): Promise<boolean> {
  return (await readStore()) !== undefined;
}

/** Wallet list + active id, without decrypting anything. */
export async function loadWalletMeta(): Promise<WalletStoreMeta | undefined> {
  const store = await readStore();
  if (!store) return undefined;
  return { activeId: store.activeId, wallets: store.wallets.map(toMeta) };
}

/** Creates the very first wallet (no store must exist yet). Returns its id. */
export async function createFirstWallet(
  mnemonic: string,
  password: string,
  name = 'Wallet 1',
  btcAddressType: BtcAddressType = 'native',
): Promise<string> {
  const normalized = normalizeMnemonic(mnemonic);
  if (!validateMnemonic(normalized)) {
    throw new VaultError('Refusing to store an invalid mnemonic.');
  }
  if (await readStore()) {
    throw new VaultError('A wallet already exists. Use "Add wallet" instead.');
  }
  const id = crypto.randomUUID();
  const store: WalletStore = {
    version: 2,
    activeId: id,
    wallets: [
      {
        id,
        name,
        btcAddressType,
        createdAt: new Date().toISOString(),
        payload: await encryptString(normalized, password),
      },
    ],
  };
  await storageSet(STORE_KEY, store);
  return id;
}

/**
 * Adds another wallet to an existing store. The password must match the one
 * protecting the existing wallets (verified by decrypting the active wallet).
 * Rejects a seed that is already present. Returns the new wallet id.
 */
export async function addWallet(
  mnemonic: string,
  password: string,
  name: string,
  btcAddressType: BtcAddressType = 'native',
): Promise<string> {
  const normalized = normalizeMnemonic(mnemonic);
  if (!validateMnemonic(normalized)) {
    throw new VaultError('Refusing to store an invalid mnemonic.');
  }
  const store = await readStore();
  if (!store) throw new VaultError('No wallet exists yet. Create one first.');

  // Verifies the password against existing wallets (throws DecryptionError if wrong).
  for (const w of store.wallets) {
    const existing = await decryptString(w.payload, password);
    if (existing === normalized) {
      throw new VaultError('This wallet is already added.');
    }
  }

  const id = crypto.randomUUID();
  store.wallets.push({
    id,
    name: name.trim() || `Wallet ${store.wallets.length + 1}`,
    btcAddressType,
    createdAt: new Date().toISOString(),
    payload: await encryptString(normalized, password),
  });
  store.activeId = id;
  await storageSet(STORE_KEY, store);
  return id;
}

/**
 * Decrypts every wallet with the password. All wallets share the password, so a
 * wrong one throws DecryptionError on the first wallet.
 */
export async function unlockAll(password: string): Promise<UnlockedStore> {
  const store = await readStore();
  if (!store) throw new VaultError('No wallet found. Create or import one first.');

  const wallets: UnlockedWallet[] = [];
  for (const w of store.wallets) {
    const mnemonic = await decryptString(w.payload, password);
    if (!validateMnemonic(mnemonic)) {
      throw new VaultError('A wallet decrypted to an invalid mnemonic — it may be corrupted.');
    }
    wallets.push({ ...toMeta(w), mnemonic });
  }
  return { activeId: store.activeId, wallets };
}

/** Decrypts a single wallet's mnemonic (for the password-gated seed reveal). */
export async function revealWallet(id: string, password: string): Promise<string> {
  const store = await readStore();
  if (!store) throw new VaultError('No wallet found.');
  const w = store.wallets.find((x) => x.id === id);
  if (!w) throw new VaultError('Wallet not found.');
  return decryptString(w.payload, password);
}

export async function setActiveWallet(id: string): Promise<void> {
  const store = await readStore();
  if (!store) throw new VaultError('No wallet found.');
  if (!store.wallets.some((w) => w.id === id)) throw new VaultError('Wallet not found.');
  store.activeId = id;
  await storageSet(STORE_KEY, store);
}

export async function renameWallet(id: string, name: string): Promise<void> {
  const store = await readStore();
  if (!store) return;
  const w = store.wallets.find((x) => x.id === id);
  if (w) {
    w.name = name.trim() || w.name;
    await storageSet(STORE_KEY, store);
  }
}

export async function setWalletBtcAddressType(id: string, type: BtcAddressType): Promise<void> {
  const store = await readStore();
  if (!store) return;
  const w = store.wallets.find((x) => x.id === id);
  if (w) {
    w.btcAddressType = type;
    await storageSet(STORE_KEY, store);
  }
}

/** Removes a wallet. If it was active, activates another. Returns remaining count. */
export async function removeWallet(id: string): Promise<number> {
  const store = await readStore();
  if (!store) return 0;
  store.wallets = store.wallets.filter((w) => w.id !== id);
  if (store.wallets.length === 0) {
    await storageRemove(STORE_KEY);
    return 0;
  }
  if (store.activeId === id) store.activeId = store.wallets[0]!.id;
  await storageSet(STORE_KEY, store);
  return store.wallets.length;
}

/** Erases all wallets from this device. */
export async function deleteAllWallets(): Promise<void> {
  await storageRemove(STORE_KEY);
  await storageRemove(LEGACY_KEY);
}
