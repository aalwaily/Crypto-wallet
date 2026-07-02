import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchBtcHistory } from '../services/bitcoinApi';
import { fetchTronAssets, fetchTrc20History } from '../services/tronApi';

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

describe('fetchTronAssets (mocked)', () => {
  it('reads TRX + all token balances from one account response', async () => {
    // USDT contract on Nile (per config) → 5 USDT; other tokens default to 0.
    mockFetchOnce({
      data: [
        {
          balance: 12_000_000, // 12 TRX in SUN
          trc20: [{ TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf: '5000000' }],
        },
      ],
    });
    const assets = await fetchTronAssets('nile', TRON_ADDRESS);
    expect(assets.trxSun).toBe(12_000_000);
    const usdt = assets.tokens.find((t) => t.token.symbol === 'USDT');
    expect(usdt!.units).toBe(5_000_000n);
    // Single request, not one-per-token.
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('returns all-zero balances for an unactivated account (empty data)', async () => {
    mockFetchOnce({ data: [] });
    const assets = await fetchTronAssets('nile', TRON_ADDRESS);
    expect(assets.trxSun).toBe(0);
    expect(assets.tokens.every((t) => t.units === 0n)).toBe(true);
  });

  it('surfaces a 429 as a rate-limit error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 429 })));
    await expect(fetchTronAssets('nile', TRON_ADDRESS)).rejects.toThrow(/rate limit/i);
  });
});

describe('fetchTrc20History (mocked)', () => {
  it('classifies direction, parses value, and reads token_info per transfer', async () => {
    mockFetchOnce({
      data: [
        {
          transaction_id: 'tx-in',
          from: 'TSenderAddress',
          to: TRON_ADDRESS,
          value: '5000000',
          block_timestamp: 1_750_000_000_000,
          token_info: { symbol: 'USDT', decimals: 6 },
        },
        {
          transaction_id: 'tx-out',
          from: TRON_ADDRESS,
          to: 'TRecipientAddress',
          value: '1500000000000000000',
          block_timestamp: 1_750_000_100_000,
          token_info: { symbol: 'JST', decimals: 18 },
        },
      ],
    });
    const history = await fetchTrc20History('nile', TRON_ADDRESS);
    expect(history).toHaveLength(2);
    expect(history[0]!.direction).toBe('in');
    expect(history[0]!.amountUnits).toBe(5_000_000n);
    expect(history[0]!.symbol).toBe('USDT');
    expect(history[0]!.decimals).toBe(6);
    expect(history[1]!.direction).toBe('out');
    expect(history[1]!.symbol).toBe('JST');
    expect(history[1]!.decimals).toBe(18);
  });

  it('falls back to sane defaults when token_info is missing', async () => {
    mockFetchOnce({
      data: [
        {
          transaction_id: 'tx',
          from: 'TSenderAddress',
          to: TRON_ADDRESS,
          value: '1',
          block_timestamp: 1_750_000_000_000,
        },
      ],
    });
    const [entry] = await fetchTrc20History('nile', TRON_ADDRESS);
    expect(entry!.symbol).toBe('TRC20');
    expect(entry!.decimals).toBe(6);
  });

  it('requests all TRC20 transfers for the address', async () => {
    mockFetchOnce({ data: [] });
    await fetchTrc20History('nile', TRON_ADDRESS);
    const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(url).toContain('nile.trongrid.io');
    expect(url).toContain(`/v1/accounts/${TRON_ADDRESS}/transactions/trc20`);
  });
});
