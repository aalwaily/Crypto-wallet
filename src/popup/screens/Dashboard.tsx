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
  IconLock,
  IconQr,
  IconRefresh,
  IconSend,
  IconUsdt,
} from '../components/icons';
import { useWallet } from '../state/WalletContext';
import { fetchBtcBalance, type BtcBalance } from '../../services/bitcoinApi';
import { fetchTronBalances, formatTrx, formatUsdt, type TronBalances } from '../../services/tronApi';
import { getBtcApiBaseUrl, getBtcNetworkConfig, getTronNetworkConfig } from '../../wallet/networks';
import { satsToBtc } from '../../wallet/validators';

type Loadable<T> =
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'ok'; data: T };

export function Dashboard() {
  const navigate = useNavigate();
  const { accounts, settings, lock } = useWallet();
  const [btcBalance, setBtcBalance] = useState<Loadable<BtcBalance>>({ state: 'loading' });
  const [tronBalances, setTronBalances] = useState<Loadable<TronBalances>>({ state: 'loading' });
  const [showQr, setShowQr] = useState<'btc' | 'tron' | null>(null);

  const refresh = useCallback(() => {
    if (!accounts) return;
    setBtcBalance({ state: 'loading' });
    setTronBalances({ state: 'loading' });
    fetchBtcBalance(getBtcApiBaseUrl(settings), accounts.btc.address)
      .then((data) => setBtcBalance({ state: 'ok', data }))
      .catch((e) => setBtcBalance({ state: 'error', message: formatError(e) }));
    fetchTronBalances(settings.tronNetwork, accounts.tron.address)
      .then((data) => setTronBalances({ state: 'ok', data }))
      .catch((e) => setTronBalances({ state: 'error', message: formatError(e) }));
  }, [accounts, settings]);

  useEffect(refresh, [refresh]);

  if (!accounts) return null;

  const btcConfig = getBtcNetworkConfig(settings.btcNetwork);
  const tronConfig = getTronNetworkConfig(settings.tronNetwork);

  return (
    <Screen
      title="Wallet"
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
                    {btcBalance.state === 'ok' ? satsToBtc(btcBalance.data.confirmedSats) : '—'}{' '}
                    BTC
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

      <Card>
        <div className="balance-card">
          <div className="row">
            <div className="asset-row">
              <div className="asset-icon usdt">
                <IconUsdt size={20} />
              </div>
              <div>
                {tronBalances.state === 'loading' ? (
                  <Skeleton width={120} height={22} />
                ) : (
                  <div className="balance-amount">
                    {tronBalances.state === 'ok' ? formatUsdt(tronBalances.data.usdtUnits) : '—'}{' '}
                    USDT
                  </div>
                )}
                {tronBalances.state === 'ok' && (
                  <div className="balance-sub">
                    {formatTrx(tronBalances.data.trxSun)} TRX for fees
                  </div>
                )}
              </div>
            </div>
            <NetworkBadge
              label={tronConfig.label.replace('Tron ', '').replace(' Testnet', '')}
              variant={settings.tronNetwork === 'mainnet' ? 'danger' : 'warn'}
            />
          </div>
          {tronBalances.state === 'error' && <Alert kind="error">{tronBalances.message}</Alert>}
          <AddressDisplay address={accounts.tron.address} />
          <div className="card-actions">
            <Button small onClick={() => navigate('/send/usdt')}>
              <IconSend size={15} />
              Send
            </Button>
            <Button
              variant="secondary"
              small
              aria-expanded={showQr === 'tron'}
              onClick={() => setShowQr(showQr === 'tron' ? null : 'tron')}
            >
              <IconQr size={15} />
              Receive
            </Button>
          </div>
          {showQr === 'tron' && <QrCode value={accounts.tron.address} />}
        </div>
      </Card>

      <p className="muted" style={{ fontSize: 11.5, textAlign: 'center' }}>
        {btcConfig.label} · {tronConfig.label}
      </p>
    </Screen>
  );
}
