import { useMemo, useRef, useState } from 'react';
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
  networkOf,
  normalizeWords,
  permutations,
} from './search';
import { addWallet, createFirstWallet, vaultExists } from '../wallet/vault';
import { clearSession } from '../wallet/session';
import { MIN_PASSWORD_LENGTH } from '../config';

const ENGLISH = wordlists.english as string[];
const VALID_LENGTHS = [12, 15, 18, 21, 24];
const CHUNK = 300;

type Phase = 'idle' | 'running' | 'found' | 'notfound' | 'stopped' | 'error';

interface Progress {
  checked: number;
  valid: number;
  total: number;
  elapsedMs: number;
}

function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export function Recover() {
  const [wordsInput, setWordsInput] = useState('');
  const [target, setTarget] = useState('');
  const [locked, setLocked] = useState<(string | null)[]>([]);
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState<Progress | null>(null);
  const [found, setFound] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stopRef = useRef(false);

  // Save-to-wallet form (shown after a successful find).
  const [hasVault, setHasVault] = useState(false);
  const [savePw, setSavePw] = useState('');
  const [savePw2, setSavePw2] = useState('');
  const [saveName, setSaveName] = useState('Recovered wallet');
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const words = useMemo(() => normalizeWords(wordsInput), [wordsInput]);

  const wordsError = useMemo(() => {
    if (!wordsInput.trim()) return undefined;
    if (!VALID_LENGTHS.includes(words.length)) {
      return `Enter 12–24 words (you have ${words.length}).`;
    }
    const bad = words.find((w) => !ENGLISH.includes(w));
    if (bad) return `"${bad}" is not a valid BIP39 word.`;
    return undefined;
  }, [wordsInput, words]);

  const wordsReady = words.length > 0 && !wordsError;

  // Keep the locked array sized to the word count.
  const effectiveLocked = locked.length === words.length ? locked : words.map(() => null);
  const freeCount = effectiveLocked.filter((w) => w === null).length;
  const totalOrderings = wordsReady ? factorial(freeCount) : 0;

  const addressError =
    target.trim() && !/^(bc1|tb1|[123mn])/.test(target.trim())
      ? 'Enter a valid Bitcoin address (bc1…, 1…, 3…, or testnet).'
      : undefined;
  const canStart = wordsReady && !!target.trim() && !addressError && phase !== 'running';

  const setLock = (pos: number, word: string) => {
    const next = effectiveLocked.slice();
    next[pos] = word === '' ? null : word;
    setLocked(next);
  };

  const run = async () => {
    setPhase('running');
    setError(null);
    setFound(null);
    setProgress(null);
    stopRef.current = false;

    const network = networkOf(target);
    const wanted = target.trim();
    const type = addressTypeOf(target);
    const plan = buildPlan(words, effectiveLocked);
    const gen = permutations(plan.freeWords);
    let checked = 0;
    let valid = 0;
    const t0 = Date.now();

    try {
      // Cooperative chunked loop keeps the tab responsive and cancellable.
      for (;;) {
        for (let n = 0; n < CHUNK; n++) {
          const it = gen.next();
          if (it.done) {
            setProgress({ checked, valid, total: plan.total, elapsedMs: Date.now() - t0 });
            setPhase('notfound');
            return;
          }
          const candidate = assemble(plan, it.value);
          const address = deriveAddress(candidate, network, type);
          checked++;
          if (address) {
            valid++;
            if (address === wanted) {
              setFound(candidate);
              setProgress({ checked, valid, total: plan.total, elapsedMs: Date.now() - t0 });
              setHasVault(await vaultExists());
              setPhase('found');
              return;
            }
          }
        }
        setProgress({ checked, valid, total: plan.total, elapsedMs: Date.now() - t0 });
        if (stopRef.current) {
          setPhase('stopped');
          return;
        }
        // Yield to the event loop so the UI updates and Stop is honored.
        await new Promise((r) => setTimeout(r, 0));
      }
    } catch (e) {
      setError(formatError(e));
      setPhase('error');
    }
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
      // Force the popup to re-read wallets on next open.
      await clearSession();
      setSaved(true);
    } catch (e) {
      setSaveError(formatError(e));
    } finally {
      setSaveBusy(false);
    }
  };

  const pct =
    progress && progress.total > 0
      ? Math.min(100, (progress.checked / progress.total) * 100)
      : 0;
  const rate = progress && progress.elapsedMs > 0 ? progress.checked / (progress.elapsedMs / 1000) : 0;
  const etaMs =
    progress && rate > 0 ? ((progress.total - progress.checked) / rate) * 1000 : 0;

  return (
    <div className="recover-wrap">
      <div className="recover-title">
        <div className="logo" style={{ width: 44, height: 44 }}>
          <IconWallet size={22} />
        </div>
        <h1>Recover wallet by word order</h1>
      </div>

      <Alert kind="info">
        You have all your words but not their order. This searches the correct order{' '}
        <strong>entirely on your device</strong> — your words never leave this computer. Only use
        words from a wallet you own.
      </Alert>

      <Card>
        <div className="stack">
          <Field label="Your 12–24 words (any order)" error={wordsError}>
            <TextArea
              rows={3}
              value={wordsInput}
              onChange={(e) => setWordsInput(e.target.value)}
              placeholder="word1 word2 word3 …"
              spellCheck={false}
            />
          </Field>
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
        </div>
      </Card>

      {wordsReady && (
        <Card>
          <div className="stack">
            <div className="row">
              <span style={{ fontSize: 13.5, fontWeight: 600 }}>Lock positions you're sure of</span>
              <span className="muted" style={{ fontSize: 12 }}>
                {freeCount} free · {totalOrderings.toLocaleString()} orderings
              </span>
            </div>
            <p className="muted" style={{ fontSize: 12, margin: 0 }}>
              For each position you remember, pick the word. Every locked position makes the search
              dramatically faster. Leave the rest as “unknown”.
            </p>
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
                With {totalOrderings.toLocaleString()} orderings this can take a very long time. Lock
                a few more positions, or use a desktop tool (btcrecover) for a fully unknown order.
              </Alert>
            )}
          </div>
        </Card>
      )}

      {phase === 'running' || progress ? (
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
                <div className="stat-label">Valid orderings</div>
                <div className="stat-value">{progress?.valid.toLocaleString() ?? 0}</div>
              </div>
              <div className="stat">
                <div className="stat-label">Speed</div>
                <div className="stat-value">{Math.round(rate).toLocaleString()}/s</div>
              </div>
              <div className="stat">
                <div className="stat-label">
                  {phase === 'running' ? 'Time left (est.)' : 'Elapsed'}
                </div>
                <div className="stat-value">
                  {phase === 'running'
                    ? formatDuration(etaMs)
                    : formatDuration(progress?.elapsedMs ?? 0)}
                </div>
              </div>
            </div>
          </div>
        </Card>
      ) : null}

      {phase === 'notfound' && (
        <Alert kind="error">
          No ordering produced that address. Double-check the words and the address, lock any
          positions you're certain of, and try again. If the wallet used a different address type
          or account index, the first receive address may differ.
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
              <strong style={{ fontSize: 15 }}>Found your wallet order!</strong>
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
              Write these 12 words down on paper in this exact order — this is your backup.
            </Alert>

            {saved ? (
              <Alert kind="success">
                Saved. Open the extension, unlock, and your recovered wallet will be there.
              </Alert>
            ) : (
              <>
                <hr className="divider" />
                <span style={{ fontSize: 13.5, fontWeight: 600 }}>Save to your wallet</span>
                <Field
                  label="Wallet name"
                >
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
                    <TextInput
                      type="password"
                      value={savePw2}
                      onChange={(e) => setSavePw2(e.target.value)}
                    />
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
          <Button variant="secondary" onClick={() => (stopRef.current = true)}>
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
