/**
 * MV3 background service worker. Its only job is enforcing auto-lock: a
 * 1-minute alarm compares the last recorded popup activity against the
 * configured timeout and wipes the RAM-only session (decrypted mnemonic)
 * when it expires. The browser itself clears chrome.storage.session on exit.
 */
import { DEFAULT_AUTO_LOCK_MINUTES } from '../config';

const ALARM_NAME = 'auto-lock-check';
const SESSION_KEY = 'unlockedSession';
const LAST_ACTIVITY_KEY = 'lastActivityAt';
const SETTINGS_KEY = 'settings';

chrome.runtime.onInstalled.addListener(() => {
  void chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 });
});

chrome.runtime.onStartup.addListener(() => {
  void chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== ALARM_NAME) return;
  void enforceAutoLock();
});

async function enforceAutoLock(): Promise<void> {
  const session = await chrome.storage.session.get([SESSION_KEY, LAST_ACTIVITY_KEY]);
  if (session[SESSION_KEY] === undefined) return; // already locked

  const settings = (await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY] as
    | { autoLockMinutes?: number }
    | undefined;
  const timeoutMs = (settings?.autoLockMinutes ?? DEFAULT_AUTO_LOCK_MINUTES) * 60_000;
  const lastActivity = (session[LAST_ACTIVITY_KEY] as number | undefined) ?? 0;

  if (Date.now() - lastActivity >= timeoutMs) {
    await chrome.storage.session.clear();
  }
}
