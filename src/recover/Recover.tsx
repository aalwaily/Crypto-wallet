import { useEffect, useMemo, useRef, useState } from 'react';
import { wordlists } from 'bip39';
import {
  Alert,
  Button,
  Card,
  CopyButton,
  Field,
  TextArea,
  TextInput,
  formatError,
} from '../popup/components/ui';
import { IconCheck, IconWallet } from '../popup/components/icons';
import {
  addressTypeOf,
  assemble,
  buildPlan,
  deriveAddress,
  factorial,
  missingWordCandidates,
  missingWordTotal,
  networkOf,
  normalizeWords,
  permutations,
} from './search';
import { addWallet, createFirstWallet, vaultExists } from '../wallet/vault';
import { clearSession } from '../wallet/session';
import { MIN_PASSWORD_LENGTH } from '../config';

const ENGLISH = wordlists.english as string[];
const ENGLISH_SET = new Set(ENGLISH);
const CHUNK = 300;

type Mode = 'missing' | 'order';
type Phase = 'idle' | 'running' | 'found' | 'notfound' | 'stopped' | 'error';

interface Progress {
  checked: number;
  valid: number;
  total: number;
  elapsedMs: number;
}

function formatDuration(ms: number): string {
  if (!isFinite(ms)) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

export function Recover() {
  const [mode, setMode] = useState<Mode>('missing');
  const [target, setTarget] = useState('');

  // Missing-word mode: ordered slots, blank = unknown word.
  const [length, setLength] = useState(12);
  const [slots, setSlots] = useState<string[]>(() => Array(12).fill(''));

  // Order mode: all words known, order unknown.
  const [wordsInput, setWordsInput] = useState('');
  const [locked, setLocked] = useState<(string | null)[]>([]);

  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState<Progress | null>(null);
  const [found, setFound] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stopRef = useRef(false);
  const workersRef = useRef<Worker[]>([]);

  // Terminate any running workers when the page unmounts.
  useEffect(() => () => workersRef.current.forEach((w) => w.terminate()), []);

  // Save-to-wallet form (after a successful find).
  const [hasVault, setHasVault] = useState(false);
  const [savePw, setSavePw] = useState('');
  const [savePw2, setSavePw2] = useState('');
  const [saveName, setSaveName] = useState('Recovered wallet');
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const addressError =
    target.trim() && !/^(bc1|tb1|[123mn])/.test(target.trim())
      ? 'Enter a valid Bitcoin address (bc1…, 1…, 3…, or testnet).'
      : undefined;

  // ---- Missing-word derived state ----
  const missingTemplate = useMemo(
    () => slots.map((s) => (s.trim() ? s.trim().toLowerCase() : null)),
    [slots],
  );
  const badWord = missingTemplate.find((w) => w && !ENGLISH_SET.has(w)) ?? undefined;
  const unknownCount = missingTemplate.filter((w) => !w).length;
  const missingTotal = missingWordTotal(unknownCount);
  const missingReady = !badWord && unknownCount >= 1 && unknownCount <= length;

  // ---- Order-mode derived state ----
  const words = useMemo(() => normalizeWords(wordsInput), [wordsInput]);
  const orderWordsError = useMemo(() => {
    if (!wordsInput.trim()) return undefined;
    if (![12, 15, 18, 21, 24].includes(words.length)) {
      return `Enter 12–24 words (you have ${words.length}).`;
    }
    const bad = words.find((w) => !ENGLISH_SET.has(w));
    return bad ? `"${bad}" is not a valid BIP39 word.` : undefined;
  }, [wordsInput, words]);
  const orderReady = words.length > 0 && !orderWordsError;
  const effectiveLocked = locked.length === words.length ? locked : words.map(() => null);
  const freeCount = effectiveLocked.filter((w) => w === null).length;
  const orderTotal = orderReady ? factorial(freeCount) : 0;

  const canStart =
    !!target.trim() &&
    !addressError &&
    phase !== 'running' &&
    (mode === 'missing' ? missingReady : orderReady);

  const changeLength = (n: number) => {
    setLength(n);
    setSlots(Array(n).fill(''));
  };
  const setSlot = (i: number, v: string) => {
    setSlots((prev) => prev.map((s, k) => (k === i ? v : s)));
  };
  const setLock = (pos: number, word: string) => {
    const next = effectiveLocked.slice();
    next[pos] = word === '' ? null : word;
    setLocked(next);
  };

  const terminateWorkers = () => {
    workersRef.current.forEach((w) => w.terminate());
    workersRef.current = [];
  };

  /** Single-threaded main-thread search (order mode, and fallback if no Workers). */
  const runSingle = async (gen: Generator<string[]>, total: number) => {
    const network = networkOf(target);
    const wanted = target.trim();
    const type = addressTypeOf(target);
    let checked = 0;
    let valid = 0;
    const t0 = Date.now();
    try {
      for (;;) {
        for (let n = 0; n < CHUNK; n++) {
          const it = gen.next();
          if (it.done) {
            setProgress({ checked, valid, total, elapsedMs: Date.now() - t0 });
            setPhase('notfound');
            return;
          }
          const address = deriveAddress(it.value, network, type);
          checked++;
          if (address) {
            valid++;
            if (address === wanted) {
              setFound(it.value);
              setProgress({ checked, valid, total, elapsedMs: Date.now() - t0 });
              setHasVault(await vaultExists());
              setPhase('found');
              return;
            }
          }
        }
        setProgress({ checked, valid, total, elapsedMs: Date.now() - t0 });
        if (stopRef.current) {
          setPhase('stopped');
          return;
        }
        await new Promise((r) => setTimeout(r, 0));
      }
    } catch (e) {
      setError(formatError(e));
      setPhase('error');
    }
  };

  /** Parallel missing-word search across one worker per CPU core. */
  const runParallel = () => {
    const network = networkOf(target);
    const wanted = target.trim();
    const type = addressTypeOf(target);
    const total = missingTotal;
    const cores = Math.max(1, Math.min(navigator.hardwareConcurrency || 4, 16));
    const checkedArr = new Array(cores).fill(0);
    const validArr = new Array(cores).fill(0);
    let done = 0;
    let finished = false;
    const t0 = Date.now();

    const update = () => {
      const checked = checkedArr.reduce((a, b) => a + b, 0);
      const valid = validArr.reduce((a, b) => a + b, 0);
      setProgress({ checked, valid, total, elapsedMs: Date.now() - t0 });
    };
    const finish = async (candidate: string[] | null) => {
      if (finished) return;
      finished = true;
      terminateWorkers();
      update();
      if (candidate) {
        setFound(candidate);
        setHasVault(await vaultExists());
        setPhase('found');
      } else {
        setPhase('notfound');
      }
    };

    for (let i = 0; i < cores; i++) {
      const worker = new Worker(new URL('./recoveryWorker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (e: MessageEvent) => {
        const m = e.data as { type: string; checked: number; valid: number; candidate?: string[] };
        checkedArr[i] = m.checked;
        validArr[i] = m.valid;
        if (m.type === 'found') {
          void finish(m.candidate ?? null);
        } else if (m.type === 'done') {
          done++;
          update();
          if (done === cores) void finish(null);
        } else {
          update();
        }
      };
      worker.onerror = () => {
        done++;
        if (done === cores) void finish(null);
      };
      worker.postMessage({
        template: missingTemplate,
        target: wanted,
        network,
        addressType: type,
        shardIndex: i,
        shardCount: cores,
      });
      workersRef.current.push(worker);
    }
  };

  const run = async () => {
    setPhase('running');
    setError(null);
    setFound(null);
    setProgress(null);
    setSaved(false);
    stopRef.current = false;
    terminateWorkers();

    if (mode === 'missing') {
      if (typeof Worker !== 'undefined') {
        runParallel();
      } else {
        await runSingle(missingWordCandidates(missingTemplate, ENGLISH), missingTotal);
      }
      return;
    }
    // Order mode runs on the main thread (kept small by locking positions).
    const plan = buildPlan(words, effectiveLocked);
    const gen = (function* () {
      for (const perm of permutations(plan.freeWords)) yield assemble(plan, perm);
    })();
    await runSingle(gen, plan.total);
  };

  const stop = () => {
    stopRef.current = true;
    terminateWorkers();
    setPhase('stopped');
  };

  const onSave = async () => {
    if (!found) return;
    const mnemonic = found.join(' ');
    setSaveBusy(true);
    setSaveError(null);
    try {
      const btcType = addressTypeOf(target);
      if (hasVault) {
        await addWallet(mnemonic, savePw, saveName, btcType);
      } else {
        if (savePw.length < MIN_PASSWORD_LENGTH) {
          throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
        }
        if (savePw !== savePw2) throw new Error('Passwords do not match.');
        await createFirstWallet(mnemonic, savePw, saveName, btcType);
      }
      await clearSession();
      setSaved(true);
    } catch (e) {
      setSaveError(formatError(e));
    } finally {
      setSaveBusy(false);
    }
  };

  const pct = progress && progress.total > 0 ? Math.min(100, (progress.checked / progress.total) * 100) : 0;
  const rate = progress && progress.elapsedMs > 0 ? progress.checked / (progress.elapsedMs / 1000) : 0;
  const etaMs = progress && rate > 0 ? ((progress.total - progress.checked) / rate) * 1000 : Infinity;

  return (
    <div className="recover-wrap">
      <datalist id="bip39-words">
        {ENGLISH.map((w) => (
          <option key={w} value={w} />
        ))}
      </datalist>

      <div className="recover-title">
        <div className="logo" style={{ width: 44, height: 44 }}>
          <IconWallet size={22} />
        </div>
        <h1>Recover wallet</h1>
      </div>

      <Alert kind="info">
        Searches for your wallet <strong>entirely on your device</strong> — your words never leave
        this computer. Only recovers a wallet you own, using a known address of yours.
      </Alert>

      <div className="segmented" role="group" aria-label="Recovery mode">
        <button aria-pressed={mode === 'missing'} onClick={() => setMode('missing')}>
          Missing words
        </button>
        <button aria-pressed={mode === 'order'} onClick={() => setMode('order')}>
          Wrong order
        </button>
      </div>

      <Card>
        <Field
          label="A known address from this wallet"
          error={addressError}
          hint="bc1… (SegWit), 1… (legacy), 3… (nested). The search matches this address."
        >
          <TextInput
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder="bc1q…"
            spellCheck={false}
          />
        </Field>
      </Card>

      {mode === 'missing' ? (
        <Card>
          <div className="stack">
            <div className="row">
              <span style={{ fontSize: 13.5, fontWeight: 600 }}>Your words (in order)</span>
              <select
                value={length}
                onChange={(e) => changeLength(Number(e.target.value))}
                style={{ width: 'auto', minHeight: 30, fontSize: 12.5 }}
              >
                <option value={12}>12 words</option>
                <option value={24}>24 words</option>
              </select>
            </div>
            <p className="muted" style={{ fontSize: 12, margin: 0 }}>
              Type each word you know in its position. Leave the missing ones <strong>blank</strong>
              — the tool tries all 2048 words for each blank.
            </p>
            <div className="pos-grid">
              {slots.map((val, i) => (
                <label
                  key={i}
                  className={`pos-slot${val.trim() && !ENGLISH_SET.has(val.trim().toLowerCase()) ? '' : val.trim() ? ' locked' : ''}`}
                >
                  <span className="pos-idx">{i + 1}</span>
                  <input
                    list="bip39-words"
                    value={val}
                    onChange={(e) => setSlot(i, e.target.value)}
                    placeholder="—"
                    spellCheck={false}
                    autoComplete="off"
                    style={{ minWidth: 0, flex: 1 }}
                  />
                </label>
              ))}
            </div>
            {badWord && <Alert kind="error">"{badWord}" is not a valid BIP39 word.</Alert>}
            {!badWord && unknownCount >= 1 && (
              <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>
                {unknownCount} missing · {missingTotal.toLocaleString()} combinations to try
              </p>
            )}
            {unknownCount === 0 && !badWord && (
              <Alert kind="info">Leave at least one word blank (the one you're missing).</Alert>
            )}
            {unknownCount >= 3 && (
              <Alert kind="warn">
                {unknownCount} missing words = {missingTotal.toLocaleString()} combinations. This may
                take a very long time (hours to days). 1–2 missing words is fast.
              </Alert>
            )}
          </div>
        </Card>
      ) : (
        <Card>
          <div className="stack">
            <Field label="All your 12–24 words (any order)" error={orderWordsError}>
              <TextArea
                rows={3}
                value={wordsInput}
                onChange={(e) => setWordsInput(e.target.value)}
                placeholder="word1 word2 word3 …"
                spellCheck={false}
              />
            </Field>
            {orderReady && (
              <>
                <div className="row">
                  <span style={{ fontSize: 13, fontWeight: 600 }}>Lock positions you're sure of</span>
                  <span className="muted" style={{ fontSize: 12 }}>
                    {freeCount} free · {orderTotal.toLocaleString()} orderings
                  </span>
                </div>
                <div className="pos-grid">
                  {effectiveLocked.map((val, i) => (
                    <label key={i} className={`pos-slot${val ? ' locked' : ''}`}>
                      <span className="pos-idx">{i + 1}</span>
                      <select value={val ?? ''} onChange={(e) => setLock(i, e.target.value)}>
                        <option value="">unknown</option>
                        {[...new Set(words)].map((w) => (
                          <option key={w} value={w}>
                            {w}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
                {freeCount > 9 && (
                  <Alert kind="warn">
                    {orderTotal.toLocaleString()} orderings can take a very long time. Lock more
                    positions, or use a desktop tool (btcrecover).
                  </Alert>
                )}
              </>
            )}
          </div>
        </Card>
      )}

      {(phase === 'running' || progress) && (
        <Card>
          <div className="stack">
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${pct}%` }} />
            </div>
            <div className="stat-grid">
              <div className="stat">
                <div className="stat-label">Checked</div>
                <div className="stat-value">
                  {progress?.checked.toLocaleString() ?? 0} / {progress?.total.toLocaleString() ?? 0}
                </div>
              </div>
              <div className="stat">
                <div className="stat-label">Valid so far</div>
                <div className="stat-value">{progress?.valid.toLocaleString() ?? 0}</div>
              </div>
              <div className="stat">
                <div className="stat-label">Speed</div>
                <div className="stat-value">{Math.round(rate).toLocaleString()}/s</div>
              </div>
              <div className="stat">
                <div className="stat-label">{phase === 'running' ? 'Time left (est.)' : 'Elapsed'}</div>
                <div className="stat-value">
                  {phase === 'running' ? formatDuration(etaMs) : formatDuration(progress?.elapsedMs ?? 0)}
                </div>
              </div>
            </div>
          </div>
        </Card>
      )}

      {phase === 'notfound' && (
        <Alert kind="error">
          No combination produced that address. Double-check your known words and the address. If the
          wallet used a different address type or account, the first receive address may differ.
        </Alert>
      )}
      {phase === 'stopped' && <Alert kind="warn">Search stopped.</Alert>}
      {error && <Alert kind="error">{error}</Alert>}

      {phase === 'found' && found && (
        <Card>
          <div className="stack">
            <div className="row" style={{ justifyContent: 'flex-start', gap: 8 }}>
              <div className="success-ring" style={{ width: 36, height: 36, margin: 0 }}>
                <IconCheck size={18} />
              </div>
              <strong style={{ fontSize: 15 }}>Found your wallet!</strong>
            </div>
            <div className="seed-grid">
              {found.map((w, i) => (
                <span key={i} className="seed-word">
                  <span className="idx">{i + 1}</span> {w}
                </span>
              ))}
            </div>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <CopyButton value={found.join(' ')} label="Copy phrase" />
            </div>
            <Alert kind="warn">
              Write these words down on paper in this exact order — this is your backup.
            </Alert>

            {saved ? (
              <Alert kind="success">
                Saved. Open the extension, unlock, and your recovered wallet will be there.
              </Alert>
            ) : (
              <>
                <hr className="divider" />
                <span style={{ fontSize: 13.5, fontWeight: 600 }}>Save to your wallet</span>
                <Field label="Wallet name">
                  <TextInput value={saveName} onChange={(e) => setSaveName(e.target.value)} maxLength={24} />
                </Field>
                <Field
                  label={hasVault ? 'Your app password' : 'Create a password'}
                  error={saveError ?? undefined}
                  hint={hasVault ? 'The password you unlock this wallet with.' : undefined}
                >
                  <TextInput type="password" value={savePw} onChange={(e) => setSavePw(e.target.value)} />
                </Field>
                {!hasVault && (
                  <Field label="Confirm password">
                    <TextInput type="password" value={savePw2} onChange={(e) => setSavePw2(e.target.value)} />
                  </Field>
                )}
                <Button onClick={onSave} loading={saveBusy} disabled={!savePw}>
                  Save recovered wallet
                </Button>
              </>
            )}
          </div>
        </Card>
      )}

      <div className="row" style={{ gap: 10 }}>
        {phase === 'running' ? (
          <Button variant="secondary" onClick={stop}>
            Stop
          </Button>
        ) : (
          <Button onClick={run} disabled={!canStart}>
            {phase === 'found' ? 'Search again' : 'Start recovery'}
          </Button>
        )}
      </div>
    </div>
  );
}
