import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createVault, deleteVault, unlockVault, vaultExists } from '../../wallet/vault';
import {
  clearSession,
  getUnlockedSession,
  saveUnlockedSession,
  touchActivity,
} from '../../wallet/session';
import { deriveBtcAccount, type BtcAccount } from '../../wallet/bitcoin';
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
  /** Decrypted mnemonic; non-null only while unlocked. Never persist it. */
  mnemonic: string | null;
  unlock(password: string): Promise<void>;
  lock(): Promise<void>;
  createWallet(mnemonic: string, password: string): Promise<void>;
  removeWallet(): Promise<void>;
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
  const [mnemonic, setMnemonic] = useState<string | null>(null);
  const lastTouchRef = useRef(0);

  const deriveAccounts = useCallback(
    async (phrase: string, currentSettings: Settings): Promise<Accounts> => {
      const [btc, tron] = await Promise.all([
        deriveBtcAccount(phrase, currentSettings.btcNetwork),
        deriveTronAccount(phrase),
      ]);
      return { btc, tron };
    },
    [],
  );

  const becomeUnlocked = useCallback(
    async (phrase: string, currentSettings: Settings) => {
      const derived = await deriveAccounts(phrase, currentSettings);
      setMnemonic(phrase);
      setAccounts(derived);
      setStatus('unlocked');
    },
    [deriveAccounts],
  );

  const becomeLocked = useCallback(() => {
    setMnemonic(null);
    setAccounts(null);
    setStatus('locked');
  }, []);

  // Initial load: settings, vault existence, and any live session.
  useEffect(() => {
    void (async () => {
      const loaded = await loadSettings();
      setSettings(loaded);
      if (!(await vaultExists())) {
        setStatus('no-wallet');
        return;
      }
      const session = await getUnlockedSession();
      if (session) {
        await becomeUnlocked(session.mnemonic, loaded);
      } else {
        setStatus('locked');
      }
    })();
  }, [becomeUnlocked]);

  // Lock the UI immediately if the background worker wipes the session.
  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return;
    const listener = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area === 'session' && 'unlockedSession' in changes && !changes['unlockedSession']?.newValue) {
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
      const phrase = await unlockVault(password);
      await saveUnlockedSession(phrase);
      await becomeUnlocked(phrase, settings);
    },
    [becomeUnlocked, settings],
  );

  const lock = useCallback(async () => {
    await clearSession();
    becomeLocked();
  }, [becomeLocked]);

  const createWallet = useCallback(
    async (phrase: string, password: string) => {
      await createVault(phrase, password);
      await saveUnlockedSession(phrase);
      await becomeUnlocked(phrase, settings);
    },
    [becomeUnlocked, settings],
  );

  const removeWallet = useCallback(async () => {
    await clearSession();
    await deleteVault();
    setMnemonic(null);
    setAccounts(null);
    setStatus('no-wallet');
  }, []);

  const updateSettings = useCallback(
    async (patch: Partial<Settings>) => {
      const next = sanitizeSettings(settingsSchema.parse({ ...settings, ...patch }));
      setSettings(next);
      await storageSet(SETTINGS_KEY, next);
      // Network changes require re-deriving addresses.
      if (mnemonic && patch.btcNetwork) {
        setAccounts(await deriveAccounts(mnemonic, next));
      }
    },
    [settings, mnemonic, deriveAccounts],
  );

  return (
    <WalletContext.Provider
      value={{
        status,
        accounts,
        settings,
        mnemonic,
        unlock,
        lock,
        createWallet,
        removeWallet,
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
