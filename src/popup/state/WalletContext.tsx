import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  addWallet as vaultAddWallet,
  createFirstWallet,
  deleteAllWallets,
  removeWallet as vaultRemoveWallet,
  renameWallet as vaultRenameWallet,
  setActiveWallet,
  unlockAll,
  vaultExists,
  type UnlockedStore,
  type WalletMeta,
} from '../../wallet/vault';
import {
  clearSession,
  getUnlockedSession,
  saveUnlockedSession,
  touchActivity,
} from '../../wallet/session';
import { deriveBtcAccount, type BtcAccount, type BtcAddressType } from '../../wallet/bitcoin';
import { deriveTronAccount, type TronAccount } from '../../wallet/tron';
import {
  DEFAULT_SETTINGS,
  sanitizeSettings,
  settingsSchema,
  type Settings,
} from '../../wallet/networks';
import { storageGet, storageSet } from '../../wallet/storage';

const SETTINGS_KEY = 'settings';

export type WalletStatus = 'loading' | 'no-wallet' | 'locked' | 'unlocked';

export interface Accounts {
  btc: BtcAccount;
  tron: TronAccount;
}

interface WalletContextValue {
  status: WalletStatus;
  accounts: Accounts | null;
  settings: Settings;
  /** Active wallet's decrypted mnemonic; non-null only while unlocked. */
  mnemonic: string | null;
  /** Metadata for all wallets (name, id, btc type). */
  wallets: WalletMeta[];
  activeId: string | null;
  unlock(password: string): Promise<void>;
  lock(): Promise<void>;
  /** Creates the very first wallet. */
  createWallet(mnemonic: string, password: string, btcAddressType?: BtcAddressType): Promise<void>;
  /** Adds another wallet to an unlocked store (needs the app password). */
  addWallet(
    mnemonic: string,
    password: string,
    name: string,
    btcAddressType?: BtcAddressType,
  ): Promise<void>;
  switchWallet(id: string): Promise<void>;
  renameWallet(id: string, name: string): Promise<void>;
  /** Removes a wallet (defaults to the active one). */
  removeWallet(id?: string): Promise<void>;
  /** Deletes ALL wallets from the device. */
  deleteEverything(): Promise<void>;
  updateSettings(patch: Partial<Settings>): Promise<void>;
}

const WalletContext = createContext<WalletContextValue | null>(null);

async function loadSettings(): Promise<Settings> {
  const raw = await storageGet<unknown>(SETTINGS_KEY);
  const parsed = settingsSchema.safeParse(raw ?? {});
  return sanitizeSettings(parsed.success ? parsed.data : DEFAULT_SETTINGS);
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<WalletStatus>('loading');
  const [accounts, setAccounts] = useState<Accounts | null>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [wallets, setWallets] = useState<WalletMeta[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [mnemonic, setMnemonic] = useState<string | null>(null);
  // In-memory copy of the unlocked store (all decrypted mnemonics). Never persisted to disk.
  const storeRef = useRef<UnlockedStore | null>(null);
  const lastTouchRef = useRef(0);

  const deriveAccounts = useCallback(
    async (phrase: string, type: BtcAddressType, currentSettings: Settings): Promise<Accounts> => {
      const [btc, tron] = await Promise.all([
        deriveBtcAccount(phrase, currentSettings.btcNetwork, type),
        deriveTronAccount(phrase),
      ]);
      return { btc, tron };
    },
    [],
  );

  const applyActive = useCallback(
    async (store: UnlockedStore, currentSettings: Settings) => {
      const active =
        store.wallets.find((w) => w.id === store.activeId) ?? store.wallets[0];
      if (!active) return;
      setActiveId(active.id);
      setMnemonic(active.mnemonic);
      setAccounts(await deriveAccounts(active.mnemonic, active.btcAddressType, currentSettings));
    },
    [deriveAccounts],
  );

  const becomeUnlocked = useCallback(
    async (store: UnlockedStore | undefined, currentSettings: Settings) => {
      // Guard against a stale/old-format session so the app never hangs on load.
      if (!store || !Array.isArray(store.wallets) || store.wallets.length === 0) {
        setStatus('locked');
        return;
      }
      storeRef.current = store;
      setWallets(store.wallets.map(({ id, name, btcAddressType, createdAt }) => ({
        id,
        name,
        btcAddressType,
        createdAt,
      })));
      await applyActive(store, currentSettings);
      setStatus('unlocked');
    },
    [applyActive],
  );

  const becomeLocked = useCallback(() => {
    storeRef.current = null;
    setMnemonic(null);
    setAccounts(null);
    setActiveId(null);
    setStatus('locked');
  }, []);

  // Reflect the chosen theme on the document root so the CSS tokens switch.
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', settings.theme);
  }, [settings.theme]);

  // Initial load: settings, vault existence, and any live session.
  // Fully guarded — any storage/session error resolves to a usable state
  // (unlock or welcome) instead of an infinite loading spinner.
  useEffect(() => {
    void (async () => {
      let loaded = DEFAULT_SETTINGS;
      try {
        loaded = await loadSettings();
        setSettings(loaded);
      } catch {
        // Ignore — fall back to defaults.
      }
      try {
        if (!(await vaultExists())) {
          setStatus('no-wallet');
          return;
        }
        const session = await getUnlockedSession();
        // becomeUnlocked itself falls back to 'locked' if the session is invalid.
        await becomeUnlocked(session?.store, loaded);
      } catch {
        // Storage read/parse failed. If a vault of some form exists, show unlock;
        // otherwise welcome. Never leave the app stuck on 'loading'.
        try {
          setStatus((await vaultExists()) ? 'locked' : 'no-wallet');
        } catch {
          setStatus('no-wallet');
        }
      }
    })();
  }, [becomeUnlocked]);

  // Lock the UI immediately if the background worker wipes the session.
  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return;
    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (
        area === 'session' &&
        'unlockedSession' in changes &&
        !changes['unlockedSession']?.newValue
      ) {
        becomeLocked();
      }
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, [becomeLocked]);

  // Report user activity (throttled) so the auto-lock timer resets.
  useEffect(() => {
    if (status !== 'unlocked') return;
    const onActivity = () => {
      const now = Date.now();
      if (now - lastTouchRef.current > 10_000) {
        lastTouchRef.current = now;
        void touchActivity();
      }
    };
    window.addEventListener('click', onActivity);
    window.addEventListener('keydown', onActivity);
    onActivity();
    return () => {
      window.removeEventListener('click', onActivity);
      window.removeEventListener('keydown', onActivity);
    };
  }, [status]);

  const unlock = useCallback(
    async (password: string) => {
      const store = await unlockAll(password);
      await saveUnlockedSession(store);
      await becomeUnlocked(store, settings);
    },
    [becomeUnlocked, settings],
  );

  const lock = useCallback(async () => {
    await clearSession();
    becomeLocked();
  }, [becomeLocked]);

  const createWallet = useCallback(
    async (phrase: string, password: string, btcAddressType: BtcAddressType = 'native') => {
      await createFirstWallet(phrase, password, 'Wallet 1', btcAddressType);
      const store = await unlockAll(password);
      await saveUnlockedSession(store);
      await becomeUnlocked(store, settings);
    },
    [becomeUnlocked, settings],
  );

  const addWallet = useCallback(
    async (
      phrase: string,
      password: string,
      name: string,
      btcAddressType: BtcAddressType = 'native',
    ) => {
      await vaultAddWallet(phrase, password, name, btcAddressType);
      // Re-unlock to refresh the in-memory store (also verifies the password).
      const store = await unlockAll(password);
      await saveUnlockedSession(store);
      await becomeUnlocked(store, settings);
    },
    [becomeUnlocked, settings],
  );

  const switchWallet = useCallback(
    async (id: string) => {
      const store = storeRef.current;
      if (!store) return;
      const next: UnlockedStore = { ...store, activeId: id };
      storeRef.current = next;
      await setActiveWallet(id);
      await saveUnlockedSession(next);
      await applyActive(next, settings);
    },
    [applyActive, settings],
  );

  const renameWallet = useCallback(async (id: string, name: string) => {
    await vaultRenameWallet(id, name);
    setWallets((prev) => prev.map((w) => (w.id === id ? { ...w, name } : w)));
    if (storeRef.current) {
      storeRef.current = {
        ...storeRef.current,
        wallets: storeRef.current.wallets.map((w) => (w.id === id ? { ...w, name } : w)),
      };
    }
  }, []);

  const removeWallet = useCallback(
    async (id?: string) => {
      const targetId = id ?? activeId;
      if (!targetId) return;
      const remaining = await vaultRemoveWallet(targetId);
      if (remaining === 0) {
        await clearSession();
        becomeLocked();
        setWallets([]);
        setStatus('no-wallet');
        return;
      }
      const store = storeRef.current;
      if (!store) return;
      const filtered = store.wallets.filter((w) => w.id !== targetId);
      const nextActiveId = store.activeId === targetId ? filtered[0]!.id : store.activeId;
      const next: UnlockedStore = { activeId: nextActiveId, wallets: filtered };
      storeRef.current = next;
      setWallets(filtered.map(({ id: wid, name, btcAddressType, createdAt }) => ({
        id: wid,
        name,
        btcAddressType,
        createdAt,
      })));
      await saveUnlockedSession(next);
      await applyActive(next, settings);
    },
    [activeId, applyActive, becomeLocked, settings],
  );

  const deleteEverything = useCallback(async () => {
    await clearSession();
    await deleteAllWallets();
    storeRef.current = null;
    setMnemonic(null);
    setAccounts(null);
    setActiveId(null);
    setWallets([]);
    setStatus('no-wallet');
  }, []);

  const updateSettings = useCallback(
    async (patch: Partial<Settings>) => {
      const next = sanitizeSettings(settingsSchema.parse({ ...settings, ...patch }));
      setSettings(next);
      await storageSet(SETTINGS_KEY, next);
      // A BTC network change requires re-deriving the active wallet's addresses.
      if (storeRef.current && patch.btcNetwork) {
        await applyActive(storeRef.current, next);
      }
    },
    [settings, applyActive],
  );

  return (
    <WalletContext.Provider
      value={{
        status,
        accounts,
        settings,
        mnemonic,
        wallets,
        activeId,
        unlock,
        lock,
        createWallet,
        addWallet,
        switchWallet,
        renameWallet,
        removeWallet,
        deleteEverything,
        updateSettings,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet(): WalletContextValue {
  const value = useContext(WalletContext);
  if (!value) throw new Error('useWallet must be used inside WalletProvider');
  return value;
}
