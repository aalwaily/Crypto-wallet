import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AddressDisplay,
  Alert,
  Button,
  Card,
  NetworkBadge,
  QrCode,
  Screen,
  Skeleton,
  formatError,
} from '../components/ui';
import {
  IconBtc,
  IconChevronDown,
  IconChevronRight,
  IconLock,
  IconQr,
  IconRefresh,
  IconSend,
} from '../components/icons';
import { useWallet } from '../state/WalletContext';
import { fetchBtcBalance, type BtcBalance } from '../../services/bitcoinApi';
import { fetchTronAssets, formatTrx, type TronAssets } from '../../services/tronApi';
import { getBtcApiBaseUrl, getBtcNetworkConfig, getTronNetworkConfig } from '../../wallet/networks';
import { formatUnits, satsToBtc } from '../../wallet/validators';

type Loadable<T> =
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'ok'; data: T };

/** Circular colored badge showing a token ticker (no remote logos needed). */
function TokenBadge({ symbol, color }: { symbol: string; color: string }) {
  return (
    <span className="token-badge" style={{ background: color }} aria-hidden>
      {symbol}
    </span>
  );
}

export function Dashboard() {
  const navigate = useNavigate();
  const { accounts, settings, lock, wallets, activeId } = useWallet();
  const activeName = wallets.find((w) => w.id === activeId)?.name ?? 'Wallet';
  const [btcBalance, setBtcBalance] = useState<Loadable<BtcBalance>>({ state: 'loading' });
  const [tron, setTron] = useState<Loadable<TronAssets>>({ state: 'loading' });
  const [showQr, setShowQr] = useState<'btc' | 'tron' | null>(null);

  const refresh = useCallback(() => {
    if (!accounts) return;
    setBtcBalance({ state: 'loading' });
    setTron({ state: 'loading' });
    fetchBtcBalance(getBtcApiBaseUrl(settings), accounts.btc.address)
      .then((data) => setBtcBalance({ state: 'ok', data }))
      .catch((e) => setBtcBalance({ state: 'error', message: formatError(e) }));
    fetchTronAssets(settings.tronNetwork, accounts.tron.address)
      .then((data) => setTron({ state: 'ok', data }))
      .catch((e) => setTron({ state: 'error', message: formatError(e) }));
  }, [accounts, settings]);

  useEffect(refresh, [refresh]);

  if (!accounts) return null;

  const btcConfig = getBtcNetworkConfig(settings.btcNetwork);
  const tronConfig = getTronNetworkConfig(settings.tronNetwork);

  return (
    <Screen
      title={
        <button
          className="wallet-switcher"
          onClick={() => navigate('/wallets')}
          aria-label="Switch wallet"
        >
          <span className="wallet-name">{activeName}</span>
          <IconChevronDown size={16} />
        </button>
      }
      withTabBar
      actions={
        <>
          <Button variant="ghost" iconOnly aria-label="Refresh balances" onClick={refresh}>
            <IconRefresh size={16} />
          </Button>
          <Button variant="ghost" iconOnly aria-label="Lock wallet" onClick={() => void lock()}>
            <IconLock size={16} />
          </Button>
        </>
      }
    >
      {/* ---------- Bitcoin ---------- */}
      <Card>
        <div className="balance-card">
          <div className="row">
            <div className="asset-row">
              <div className="asset-icon btc">
                <IconBtc size={20} />
              </div>
              <div>
                {btcBalance.state === 'loading' ? (
                  <Skeleton width={120} height={22} />
                ) : (
                  <div className="balance-amount">
                    {btcBalance.state === 'ok' ? satsToBtc(btcBalance.data.confirmedSats) : '—'} BTC
                  </div>
                )}
                {btcBalance.state === 'ok' && btcBalance.data.pendingSats !== 0 && (
                  <div className="balance-sub">
                    {satsToBtc(btcBalance.data.pendingSats)} BTC pending
                  </div>
                )}
              </div>
            </div>
            <NetworkBadge
              label={settings.btcNetwork === 'testnet' ? 'Testnet' : 'Mainnet'}
              variant={settings.btcNetwork === 'mainnet' ? 'danger' : 'warn'}
            />
          </div>
          {btcBalance.state === 'error' && <Alert kind="error">{btcBalance.message}</Alert>}
          <AddressDisplay address={accounts.btc.address} />
          <div className="card-actions">
            <Button small onClick={() => navigate('/send/btc')}>
              <IconSend size={15} />
              Send
            </Button>
            <Button
              variant="secondary"
              small
              aria-expanded={showQr === 'btc'}
              onClick={() => setShowQr(showQr === 'btc' ? null : 'btc')}
            >
              <IconQr size={15} />
              Receive
            </Button>
          </div>
          {showQr === 'btc' && <QrCode value={accounts.btc.address} />}
        </div>
      </Card>

      {/* ---------- Tron: one address, many tokens ---------- */}
      <Card>
        <div className="stack">
          <div className="row">
            <span className="section-label">Tron</span>
            <NetworkBadge
              label={tronConfig.label.replace('Tron ', '').replace(' Testnet', '')}
              variant={settings.tronNetwork === 'mainnet' ? 'danger' : 'warn'}
            />
          </div>
          <AddressDisplay address={accounts.tron.address} />
          <Button
            variant="secondary"
            small
            aria-expanded={showQr === 'tron'}
            onClick={() => setShowQr(showQr === 'tron' ? null : 'tron')}
          >
            <IconQr size={15} />
            Receive to Tron address
          </Button>
          {showQr === 'tron' && <QrCode value={accounts.tron.address} />}

          {tron.state === 'error' && <Alert kind="error">{tron.message}</Alert>}

          <hr className="divider" />

          <div className="asset-list">
            {/* TRX — needed for fees; not sendable here */}
            <button className="asset-item" disabled aria-label="TRX balance for network fees">
              <TokenBadge symbol="TRX" color="#eb0029" />
              <span className="asset-meta">
                <span className="asset-symbol" style={{ display: 'block' }}>
                  TRX
                </span>
                <span className="asset-name">for network fees</span>
              </span>
              <span className="asset-balance">
                {tron.state === 'loading' ? (
                  <Skeleton width={60} height={16} />
                ) : tron.state === 'ok' ? (
                  formatTrx(tron.data.trxSun)
                ) : (
                  '—'
                )}
              </span>
            </button>

            {/* TRC20 tokens — tap a row to send that token */}
            {tronConfig.tokens.map((token) => {
              const balance =
                tron.state === 'ok'
                  ? tron.data.tokens.find((t) => t.token.symbol === token.symbol)
                  : undefined;
              return (
                <button
                  key={token.symbol}
                  className="asset-item"
                  onClick={() => navigate(`/send/trc20/${token.symbol}`)}
                  aria-label={`Send ${token.symbol}`}
                >
                  <TokenBadge symbol={token.symbol} color={token.color} />
                  <span className="asset-meta">
                    <span className="asset-symbol" style={{ display: 'block' }}>
                      {token.symbol}
                    </span>
                    <span className="asset-name">{token.name}</span>
                  </span>
                  <span className="asset-balance">
                    {tron.state === 'loading' ? (
                      <Skeleton width={60} height={16} />
                    ) : (
                      formatUnits(balance?.units ?? 0n, token.decimals)
                    )}
                    <IconChevronRight size={15} className="asset-chevron" />
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </Card>

      <p className="muted" style={{ fontSize: 11.5, textAlign: 'center' }}>
        {btcConfig.label} · {tronConfig.label}
      </p>
    </Screen>
  );
}
