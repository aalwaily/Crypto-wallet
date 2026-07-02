/**
 * Thin async wrapper over chrome.storage.local with an in-memory fallback so
 * the same code runs in Vite dev mode and Vitest (where chrome.* is absent).
 */

const memoryStore = new Map<string, unknown>();

function hasChromeStorage(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.storage?.local;
}

export async function storageGet<T>(key: string): Promise<T | undefined> {
  if (hasChromeStorage()) {
    const result = await chrome.storage.local.get(key);
    return result[key] as T | undefined;
  }
  return memoryStore.get(key) as T | undefined;
}

export async function storageSet(key: string, value: unknown): Promise<void> {
  if (hasChromeStorage()) {
    await chrome.storage.local.set({ [key]: value });
    return;
  }
  memoryStore.set(key, value);
}

export async function storageRemove(key: string): Promise<void> {
  if (hasChromeStorage()) {
    await chrome.storage.local.remove(key);
    return;
  }
  memoryStore.delete(key);
}

/** Test-only helper to reset the fallback store between cases. */
export function __clearMemoryStorage(): void {
  memoryStore.clear();
}
