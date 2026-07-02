import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchBtcHistory } from '../services/bitcoinApi';
import { fetchUsdtHistory } from '../services/tronApi';

const ADDRESS = 'tb1q6rz28mcfaxtmd6v789l9rrlrusdprr9pqcpvkl';
const TRON_ADDRESS = 'TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH';

function mockFetchOnce(body: unknown) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body))));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchBtcHistory (mocked)', () => {
  it('computes a positive delta for received transactions', async () => {
    mockFetchOnce([
      {
        txid: 'aa'.repeat(32),
        fee: 141,
        status: { confirmed: true, block_time: 1_750_000_000 },
        vin: [{ prevout: { scriptpubkey_address: 'tb1qother', value: 200_000 } }],
        vout: [
          { scriptpubkey_address: ADDRESS, value: 158_241 },
          { scriptpubkey_address: 'tb1qother', value: 41_618 },
        ],
      },
    ]);
    const history = await fetchBtcHistory('https://x/api', ADDRESS);
    expect(history).toHaveLength(1);
    expect(history[0]!.deltaSats).toBe(158_241);
    expect(history[0]!.confirmed).toBe(true);
    expect(history[0]!.timestampMs).toBe(1_750_000_000_000);
  });

  it('computes a negative delta (incl. fee) for sent transactions', async () => {
    mockFetchOnce([
      {
        txid: 'bb'.repeat(32),
        fee: 141,
        status: { confirmed: false },
        vin: [{ prevout: { scriptpubkey_address: ADDRESS, value: 158_241 } }],
        vout: [
          { scriptpubkey_address: 'tb1qrecipient', value: 50_000 },
          { scriptpubkey_address: ADDRESS, value: 108_100 },
        ],
      },
    ]);
    const history = await fetchBtcHistory('https://x/api', ADDRESS);
    expect(history[0]!.deltaSats).toBe(-50_141); // amount + fee
    expect(history[0]!.confirmed).toBe(false);
    expect(history[0]!.timestampMs).toBeUndefined();
  });

  it('handles coinbase-style inputs with null prevout', async () => {
    mockFetchOnce([
      {
        txid: 'cc'.repeat(32),
        fee: 0,
        status: { confirmed: true, block_time: 1_750_000_000 },
        vin: [{ prevout: null }],
        vout: [{ scriptpubkey_address: ADDRESS, value: 100_000 }],
      },
    ]);
    const history = await fetchBtcHistory('https://x/api', ADDRESS);
    expect(history[0]!.deltaSats).toBe(100_000);
  });
});

describe('fetchUsdtHistory (mocked)', () => {
  it('classifies direction and parses value as bigint', async () => {
    mockFetchOnce({
      data: [
        {
          transaction_id: 'tx-in',
          from: 'TSenderAddress',
          to: TRON_ADDRESS,
          value: '5000000',
          block_timestamp: 1_750_000_000_000,
        },
        {
          transaction_id: 'tx-out',
          from: TRON_ADDRESS,
          to: 'TRecipientAddress',
          value: '1500000',
          block_timestamp: 1_750_000_100_000,
        },
      ],
    });
    const history = await fetchUsdtHistory('nile', TRON_ADDRESS);
    expect(history).toHaveLength(2);
    expect(history[0]!.direction).toBe('in');
    expect(history[0]!.amountUnits).toBe(5_000_000n);
    expect(history[0]!.counterparty).toBe('TSenderAddress');
    expect(history[1]!.direction).toBe('out');
    expect(history[1]!.counterparty).toBe('TRecipientAddress');
  });

  it('requests the configured USDT contract', async () => {
    mockFetchOnce({ data: [] });
    await fetchUsdtHistory('nile', TRON_ADDRESS);
    const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(url).toContain('nile.trongrid.io');
    expect(url).toContain('contract_address=');
    expect(url).toContain(`/v1/accounts/${TRON_ADDRESS}/transactions/trc20`);
  });
});
