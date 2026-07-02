import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  broadcastTx,
  BtcApiError,
  fetchBtcBalance,
  fetchFeeEstimates,
  fetchUtxos,
} from '../services/bitcoinApi';

const BASE = 'https://example.test/api';
const ADDRESS = 'tb1q6rz28mcfaxtmd6v789l9rrlrusdprr9pqcpvkl';

function mockFetchOnce(body: unknown, init?: { status?: number; text?: boolean }) {
  const status = init?.status ?? 200;
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(init?.text ? String(body) : JSON.stringify(body), { status }),
    ),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('bitcoinApi (mocked)', () => {
  it('computes balance from chain and mempool stats', async () => {
    mockFetchOnce({
      chain_stats: { funded_txo_sum: 150_000, spent_txo_sum: 50_000 },
      mempool_stats: { funded_txo_sum: 10_000, spent_txo_sum: 25_000 },
    });
    const balance = await fetchBtcBalance(BASE, ADDRESS);
    expect(balance.confirmedSats).toBe(100_000);
    expect(balance.pendingSats).toBe(-15_000);
    expect(fetch).toHaveBeenCalledWith(`${BASE}/address/${ADDRESS}`, undefined);
  });

  it('parses the UTXO list', async () => {
    mockFetchOnce([
      {
        txid: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        vout: 1,
        value: 42_000,
        status: { confirmed: true },
      },
    ]);
    const utxos = await fetchUtxos(BASE, ADDRESS);
    expect(utxos).toHaveLength(1);
    expect(utxos[0]!.value).toBe(42_000);
  });

  it('rejects malformed API responses', async () => {
    mockFetchOnce({ unexpected: 'shape' });
    await expect(fetchBtcBalance(BASE, ADDRESS)).rejects.toThrow();
  });

  it('maps fee estimate targets to tiers with a 1 sat/vB floor', async () => {
    mockFetchOnce({ '1': 5.2, '3': 3.1, '6': 0.9, '144': 0.5 });
    const fees = await fetchFeeEstimates(BASE);
    expect(fees.fastSatPerVb).toBe(6);
    expect(fees.normalSatPerVb).toBe(4);
    expect(fees.slowSatPerVb).toBe(1);
  });

  it('broadcasts a transaction and returns the txid', async () => {
    mockFetchOnce('abc123txid\n', { text: true });
    const txid = await broadcastTx(BASE, '020000000001…');
    expect(txid).toBe('abc123txid');
    expect(fetch).toHaveBeenCalledWith(`${BASE}/tx`, expect.objectContaining({ method: 'POST' }));
  });

  it('surfaces HTTP errors as BtcApiError with status', async () => {
    mockFetchOnce('sendrawtransaction RPC error: dust', { status: 400, text: true });
    await expect(broadcastTx(BASE, 'deadbeef')).rejects.toThrow(BtcApiError);
    await expect(
      broadcastTx(BASE, 'deadbeef').catch((e: BtcApiError) => Promise.reject(e.status)),
    ).rejects.toBe(400);
  });

  it('wraps network failures in BtcApiError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(fetchBtcBalance(BASE, ADDRESS)).rejects.toThrow(BtcApiError);
  });
});
