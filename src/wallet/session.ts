/**
 * Unlocked-session state. The decrypted mnemonic is cached in
 * chrome.storage.session — memory-backed, never written to disk, cleared when
 * the browser exits, and (by default) readable only from trusted extension
 * contexts. The background service worker enforces auto-lock by clearing it
 * after a period of inactivity (see background/serviceWorker.ts).
 */

import type { UnlockedStore } from './vault';

const SESSION_KEY = 'unlockedSession';
export const LAST_ACTIVITY_KEY = 'lastActivityAt';

export interface UnlockedSession {
  /** All unlocked wallets (with decrypted mnemonics) + the active wallet id. */
  store: UnlockedStore;
  unlockedAt: number;
}

const memorySession = new Map<string, unknown>();

function hasSessionStorage(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.storage?.session;
}

async function sessionGet<T>(key: string): Promise<T | undefined> {
  if (hasSessionStorage()) {
    const result = await chrome.storage.session.get(key);
    return result[key] as T | undefined;
  }
  return memorySession.get(key) as T | undefined;
}

async function sessionSet(items: Record<string, unknown>): Promise<void> {
  if (hasSessionStorage()) {
    await chrome.storage.session.set(items);
    return;
  }
  for (const [k, v] of Object.entries(items)) memorySession.set(k, v);
}

export async function saveUnlockedSession(store: UnlockedStore): Promise<void> {
  await sessionSet({
    [SESSION_KEY]: { store, unlockedAt: Date.now() } satisfies UnlockedSession,
    [LAST_ACTIVITY_KEY]: Date.now(),
  });
}

export async function getUnlockedSession(): Promise<UnlockedSession | undefined> {
  return sessionGet<UnlockedSession>(SESSION_KEY);
}

export async function touchActivity(): Promise<void> {
  await sessionSet({ [LAST_ACTIVITY_KEY]: Date.now() });
}

export async function clearSession(): Promise<void> {
  if (hasSessionStorage()) {
    await chrome.storage.session.clear();
    return;
  }
  memorySession.clear();
}
