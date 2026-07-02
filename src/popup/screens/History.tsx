import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  EmptyState,
  Screen,
  Skeleton,
  formatError,
  formatTime,
  shortAddress,
} from '../components/ui';
import { IconReceive, IconSend } from '../components/icons';
import { useWallet } from '../state/WalletContext';
import { fetchBtcHistory, type BtcTxSummary } from '../../services/bitcoinApi';
import { fetchTrc20History, type Trc20Transfer } from '../../services/tronApi';
import { getBtcApiBaseUrl, getBtcNetworkConfig, getTronNetworkConfig } from '../../wallet/networks';
import { formatUnits, satsToBtc } from '../../wallet/validators';

type Filter = 'all' | 'btc' | 'tron';

interface HistoryEntry {
  key: string;
  chain: 'btc' | 'tron';
  asset: string;
  direction: 'in' | 'out';
  amountLabel: string;
  subLabel: string;
  pending: boolean;
  timestampMs: number;
  explorerUrl: string;
}

function btcToEntry(tx: BtcTxSummary, explorerUrl: (txid: string) => string): HistoryEntry {
  const incoming = tx.deltaSats >= 0;
  return {
    key: `btc-${tx.txid}`,
    chain: 'btc',
    asset: 'BTC',
    direction: incoming ? 'in' : 'out',
    amountLabel: `${incoming ? '+' : '−'}${satsToBtc(Math.abs(tx.deltaSats))}`,
    subLabel: shortAddress(tx.txid),
    pending: !tx.confirmed,
    timestampMs: tx.timestampMs ?? Date.now(),
    explorerUrl: explorerUrl(tx.txid),
  };
}

function trc20ToEntry(t: Trc20Transfer, explorerUrl: (txid: string) => string): HistoryEntry {
  return {
    key: `trc20-${t.txid}-${t.symbol}`,
    chain: 'tron',
    asset: t.symbol,
    direction: t.direction,
    amountLabel: `${t.direction === 'in' ? '+' : '−'}${formatUnits(t.amountUnits, t.decimals)}`,
    subLabel: `${t.direction === 'in' ? 'From' : 'To'} ${shortAddress(t.counterparty)}`,
    pending: false,
    timestampMs: t.timestampMs,
    explorerUrl: explorerUrl(t.txid),
  };
}

export function History() {
  const { accounts, settings } = useWallet();
  const [filter, setFilter] = useState<Filter>('all');
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!accounts) return;
    setEntries(null);
    setError(null);
    const btcExplorer = getBtcNetworkConfig(settings.btcNetwork).explorerTxUrl;
    const tronExplorer = getTronNetworkConfig(settings.tronNetwork).explorerTxUrl;
    Promise.allSettled([
      fetchBtcHistory(getBtcApiBaseUrl(settings), accounts.btc.address),
      fetchTrc20History(settings.tronNetwork, accounts.tron.address),
    ]).then(([btcResult, tronResult]) => {
      if (btcResult.status === 'rejected' && tronResult.status === 'rejected') {
        setError(formatError(btcResult.reason));
        return;
      }
      const list: HistoryEntry[] = [
        ...(btcResult.status === 'fulfilled'
          ? btcResult.value.map((tx) => btcToEntry(tx, btcExplorer))
          : []),
        ...(tronResult.status === 'fulfilled'
          ? tronResult.value.map((t) => trc20ToEntry(t, tronExplorer))
          : []),
      ];
      // Pending first, then newest first.
      list.sort((a, b) => Number(b.pending) - Number(a.pending) || b.timestampMs - a.timestampMs);
      setEntries(list);
      if (btcResult.status === 'rejected') setError(`Bitcoin history: ${formatError(btcResult.reason)}`);
      if (tronResult.status === 'rejected') setError(`Tron history: ${formatError(tronResult.reason)}`);
    });
  }, [accounts, settings]);

  useEffect(load, [load]);

  if (!accounts) return null;

  const visible = entries?.filter((e) => filter === 'all' || e.chain === filter);

  return (
    <Screen title="History" withTabBar>
      <div className="segmented" role="group" aria-label="Filter transactions">
        {(['all', 'btc', 'tron'] as const).map((f) => (
          <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)}>
            {f === 'all' ? 'All' : f === 'btc' ? 'BTC' : 'Tron'}
          </button>
        ))}
      </div>

      {error && (
        <Alert kind="error">
          {error}{' '}
          <a
            href="#retry"
            onClick={(e) => {
              e.preventDefault();
              load();
            }}
          >
            Retry
          </a>
        </Alert>
      )}

      {entries === null && !error && (
        <div className="stack" aria-label="Loading history">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="row">
              <Skeleton width={34} height={34} />
              <div className="grow stack" style={{ gap: 6 }}>
                <Skeleton width="60%" height={13} />
                <Skeleton width="40%" height={11} />
              </div>
              <Skeleton width={70} height={14} />
            </div>
          ))}
        </div>
      )}

      {visible && visible.length === 0 && (
        <EmptyState
          title="No transactions yet"
          hint="Received and sent transactions will appear here."
        />
      )}

      {visible && visible.length > 0 && (
        <div className="tx-list">
          {visible.map((entry) => (
            <a
              key={entry.key}
              className="tx-item"
              href={entry.explorerUrl}
              target="_blank"
              rel="noreferrer"
              aria-label={`${entry.direction === 'in' ? 'Received' : 'Sent'} ${entry.amountLabel} ${entry.asset}, view on explorer`}
            >
              <span className={`tx-dir ${entry.direction}`}>
                {entry.direction === 'in' ? <IconReceive size={16} /> : <IconSend size={16} />}
              </span>
              <span className="tx-info">
                <span className="tx-title">
                  {entry.direction === 'in' ? 'Received' : 'Sent'}
                </span>
                <span className="tx-sub" style={{ display: 'block' }}>
                  {entry.pending && <span className="pending-dot" aria-label="Pending" />}
                  {entry.pending ? 'Pending · ' : ''}
                  {entry.pending ? entry.subLabel : formatTime(entry.timestampMs)}
                </span>
              </span>
              <span className={`tx-amount ${entry.direction}`}>
                {entry.amountLabel}
                <span className="tx-asset">{entry.asset}</span>
              </span>
            </a>
          ))}
        </div>
      )}

      <div className="grow" />
      {entries !== null && (
        <Button variant="secondary" onClick={load}>
          Refresh
        </Button>
      )}
    </Screen>
  );
}
