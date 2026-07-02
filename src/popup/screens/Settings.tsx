import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Button,
  Card,
  Field,
  Screen,
  Select,
  TextInput,
  formatError,
} from '../components/ui';
import { IconAlertTriangle, IconEye, IconEyeOff, IconLock } from '../components/icons';
import { useWallet } from '../state/WalletContext';
import { unlockVault } from '../../wallet/vault';
import { BTC_NETWORKS, MAINNET_ENABLED } from '../../config';
import type { BtcNetworkId, TronNetworkId } from '../../config';

type PendingSwitch = { chain: 'btc'; value: BtcNetworkId } | { chain: 'tron'; value: TronNetworkId };

export function Settings() {
  const navigate = useNavigate();
  const { settings, updateSettings, removeWallet, lock } = useWallet();
  const [deleteText, setDeleteText] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Mainnet switches are staged behind an explicit acknowledgement.
  const [pendingSwitch, setPendingSwitch] = useState<PendingSwitch | null>(null);
  const [mainnetAck, setMainnetAck] = useState(false);

  // Seed reveal requires re-entering the password even while unlocked.
  const [revealOpen, setRevealOpen] = useState(false);
  const [revealPassword, setRevealPassword] = useState('');
  const [revealBusy, setRevealBusy] = useState(false);
  const [revealError, setRevealError] = useState<string | null>(null);
  const [revealedSeed, setRevealedSeed] = useState<string | null>(null);

  const providers = BTC_NETWORKS[settings.btcNetwork].apiProviders;
  const onMainnet = settings.btcNetwork === 'mainnet' || settings.tronNetwork === 'mainnet';

  const onChange = async (patch: Parameters<typeof updateSettings>[0]) => {
    setError(null);
    try {
      await updateSettings(patch);
    } catch (e) {
      setError(formatError(e));
    }
  };

  const onBtcNetworkSelect = (value: BtcNetworkId) => {
    if (value === settings.btcNetwork) return;
    if (value === 'mainnet') {
      setPendingSwitch({ chain: 'btc', value });
      setMainnetAck(false);
      return;
    }
    // The API base URL is network-specific, so reset it on every switch.
    void onChange({ btcNetwork: value, btcApiBaseUrl: undefined });
  };

  const onTronNetworkSelect = (value: TronNetworkId) => {
    if (value === settings.tronNetwork) return;
    if (value === 'mainnet') {
      setPendingSwitch({ chain: 'tron', value });
      setMainnetAck(false);
      return;
    }
    void onChange({ tronNetwork: value });
  };

  const confirmPendingSwitch = async () => {
    if (!pendingSwitch) return;
    if (pendingSwitch.chain === 'btc') {
      await onChange({ btcNetwork: pendingSwitch.value as BtcNetworkId, btcApiBaseUrl: undefined });
    } else {
      await onChange({ tronNetwork: pendingSwitch.value as TronNetworkId });
    }
    setPendingSwitch(null);
    setMainnetAck(false);
  };

  const onReveal = async () => {
    setRevealBusy(true);
    setRevealError(null);
    try {
      setRevealedSeed(await unlockVault(revealPassword));
      setRevealPassword('');
    } catch (e) {
      setRevealError(formatError(e));
    } finally {
      setRevealBusy(false);
    }
  };

  const closeReveal = () => {
    setRevealOpen(false);
    setRevealedSeed(null);
    setRevealPassword('');
    setRevealError(null);
  };

  return (
    <Screen title="Settings" withTabBar>
      {onMainnet && (
        <Alert kind="error">
          <strong>Mainnet is active — real funds.</strong> This software is not professionally
          audited. Transactions are irreversible. Keep only small amounts in this wallet.
        </Alert>
      )}

      <Card>
        <div className="stack">
          <Field label="Bitcoin network">
            <Select
              value={settings.btcNetwork}
              onChange={(e) => onBtcNetworkSelect(e.target.value as BtcNetworkId)}
            >
              <option value="testnet">Testnet</option>
              {MAINNET_ENABLED && <option value="mainnet">Mainnet (real funds)</option>}
            </Select>
          </Field>
          <Field label="Tron network">
            <Select
              value={settings.tronNetwork}
              onChange={(e) => onTronNetworkSelect(e.target.value as TronNetworkId)}
            >
              <option value="nile">Nile testnet</option>
              <option value="shasta">Shasta testnet</option>
              {MAINNET_ENABLED && <option value="mainnet">Mainnet (real funds)</option>}
            </Select>
          </Field>
          <Field label="Bitcoin API provider">
            <Select
              value={settings.btcApiBaseUrl ?? providers[0]?.baseUrl}
              onChange={(e) => void onChange({ btcApiBaseUrl: e.target.value })}
            >
              {providers.map((p) => (
                <option key={p.baseUrl} value={p.baseUrl}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Auto-lock after (minutes)" hint="Session is wiped after this idle time.">
            <TextInput
              type="number"
              min={1}
              max={120}
              defaultValue={settings.autoLockMinutes}
              onBlur={(e) => {
                const minutes = Number(e.target.value);
                if (Number.isInteger(minutes) && minutes >= 1 && minutes <= 120) {
                  void onChange({ autoLockMinutes: minutes });
                }
              }}
            />
          </Field>
        </div>
      </Card>

      {pendingSwitch && (
        <Card>
          <div className="stack">
            <div className="row" style={{ justifyContent: 'flex-start', gap: 8 }}>
              <IconAlertTriangle size={18} style={{ color: 'var(--danger)' }} />
              <span className="danger-title">
                Switch {pendingSwitch.chain === 'btc' ? 'Bitcoin' : 'Tron'} to mainnet?
              </span>
            </div>
            <p className="muted" style={{ fontSize: 12.5 }}>
              You are about to leave the test network. On mainnet:
            </p>
            <ul className="muted" style={{ fontSize: 12.5, margin: 0, paddingLeft: 18 }}>
              <li>Every transaction moves <strong>real money</strong> and cannot be reversed.</li>
              <li>This wallet has <strong>not been professionally audited</strong>.</li>
              <li>This is a hot wallet on an internet-connected device — treat it like cash in a
                pocket, not a vault.</li>
              <li>Verify your first receive with a small test amount before sending anything
                larger.</li>
            </ul>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={mainnetAck}
                onChange={(e) => setMainnetAck(e.target.checked)}
              />
              <span>
                I understand the risks and accept full responsibility for funds in this wallet.
              </span>
            </label>
            <Button variant="danger" disabled={!mainnetAck} onClick={confirmPendingSwitch}>
              Switch to mainnet
            </Button>
            <Button variant="secondary" onClick={() => setPendingSwitch(null)}>
              Stay on testnet
            </Button>
          </div>
        </Card>
      )}

      <Card>
        <div className="stack">
          <div className="row">
            <span style={{ fontSize: 13.5, fontWeight: 600 }}>Seed phrase</span>
            <Button
              variant="secondary"
              small
              onClick={() => (revealOpen ? closeReveal() : setRevealOpen(true))}
            >
              {revealOpen ? <IconEyeOff size={15} /> : <IconEye size={15} />}
              {revealOpen ? 'Hide' : 'Reveal'}
            </Button>
          </div>
          {revealOpen && !revealedSeed && (
            <>
              <Alert kind="warn">
                Never share your seed phrase. Anyone who sees it can steal your funds.
              </Alert>
              <Field label="Confirm password" error={revealError ?? undefined}>
                <TextInput
                  type="password"
                  value={revealPassword}
                  onChange={(e) => setRevealPassword(e.target.value)}
                  autoFocus
                />
              </Field>
              <Button
                variant="secondary"
                disabled={!revealPassword}
                loading={revealBusy}
                onClick={onReveal}
              >
                Show seed phrase
              </Button>
            </>
          )}
          {revealedSeed && (
            <div className="seed-grid">
              {revealedSeed.split(' ').map((word, i) => (
                <span key={i} className="seed-word">
                  <span className="idx">{i + 1}</span> {word}
                </span>
              ))}
            </div>
          )}
        </div>
      </Card>

      {error && <Alert kind="error">{error}</Alert>}

      <Button variant="secondary" onClick={() => void lock()}>
        <IconLock size={15} />
        Lock wallet now
      </Button>

      <Card>
        <div className="stack">
          <span className="danger-title">Danger zone</span>
          <p className="muted" style={{ fontSize: 12.5 }}>
            Deleting the wallet erases the encrypted vault from this device. Without your seed
            phrase backup, funds are lost forever. Type <strong>DELETE</strong> to confirm.
          </p>
          <TextInput
            value={deleteText}
            onChange={(e) => setDeleteText(e.target.value)}
            placeholder="DELETE"
            aria-label="Type DELETE to confirm"
          />
          <Button
            variant="danger"
            disabled={deleteText !== 'DELETE'}
            onClick={async () => {
              await removeWallet();
              navigate('/', { replace: true });
            }}
          >
            Delete wallet from this device
          </Button>
        </div>
      </Card>
    </Screen>
  );
}
