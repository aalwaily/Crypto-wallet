/**
 * Client for Esplora-compatible HTTP APIs (mempool.space, Blockstream).
 * The base URL is user-configurable in Settings; both providers share this
 * API shape so no provider-specific code is needed.
 */
import { z } from 'zod';
import { MAX_BTC_FEE_RATE_SAT_PER_VB } from '../config';

const addressStatsSchema = z.object({
  chain_stats: z.object({
    funded_txo_sum: z.number(),
    spent_txo_sum: z.number(),
  }),
  mempool_stats: z.object({
    funded_txo_sum: z.number(),
    spent_txo_sum: z.number(),
  }),
});

const utxoSchema = z.object({
  txid: z.string(),
  vout: z.number(),
  value: z.number(),
  status: z.object({ confirmed: z.boolean() }),
});

const utxoListSchema = z.array(utxoSchema);

export type Utxo = z.infer<typeof utxoSchema>;

export interface BtcBalance {
  confirmedSats: number;
  /** Net unconfirmed delta — can be negative while a spend is in the mempool. */
  pendingSats: number;
}

export interface FeeEstimates {
  fastSatPerVb: number;
  normalSatPerVb: number;
  slowSatPerVb: number;
}

export class BtcApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'BtcApiError';
  }
}

async function apiFetch(baseUrl: string, path: string, init?: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, init);
  } catch {
    throw new BtcApiError('Bitcoin API is unreachable. Check your connection or provider setting.');
  }
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new BtcApiError(
      `Bitcoin API error (${response.status}): ${body.slice(0, 200) || response.statusText}`,
      response.status,
    );
  }
  return response;
}

export async function fetchBtcBalance(baseUrl: string, address: string): Promise<BtcBalance> {
  const response = await apiFetch(baseUrl, `/address/${address}`);
  const stats = addressStatsSchema.parse(await response.json());
  return {
    confirmedSats: stats.chain_stats.funded_txo_sum - stats.chain_stats.spent_txo_sum,
    pendingSats: stats.mempool_stats.funded_txo_sum - stats.mempool_stats.spent_txo_sum,
  };
}

export async function fetchUtxos(baseUrl: string, address: string): Promise<Utxo[]> {
  const response = await apiFetch(baseUrl, `/address/${address}/utxo`);
  return utxoListSchema.parse(await response.json());
}

/**
 * Esplora returns `{ "<blocks>": <sat/vB> }`. Targets: ~1 block = fast,
 * ~3 = normal, ~6 = slow. Falls back to 1 sat/vB (testnet floor).
 */
export async function fetchFeeEstimates(baseUrl: string): Promise<FeeEstimates> {
  const response = await apiFetch(baseUrl, '/fee-estimates');
  const raw = z.record(z.string(), z.number()).parse(await response.json());
  const pick = (target: number) => {
    const keys = Object.keys(raw)
      .map(Number)
      .filter((k) => k >= target)
      .sort((a, b) => a - b);
    const key = keys[0];
    const value = key !== undefined ? raw[String(key)] : undefined;
    // Clamp to [1, MAX] — a hostile provider must not be able to inflate the fee.
    return Math.min(MAX_BTC_FEE_RATE_SAT_PER_VB, Math.max(1, Math.ceil(value ?? 1)));
  };
  return { fastSatPerVb: pick(1), normalSatPerVb: pick(3), slowSatPerVb: pick(6) };
}

/** Broadcasts a raw transaction; returns the txid. */
export async function broadcastTx(baseUrl: string, txHex: string): Promise<string> {
  const response = await apiFetch(baseUrl, '/tx', { method: 'POST', body: txHex });
  return (await response.text()).trim();
}

/** Full raw transaction hex — required to sign legacy (P2PKH) inputs. */
export async function fetchTxHex(baseUrl: string, txid: string): Promise<string> {
  const response = await apiFetch(baseUrl, `/tx/${txid}/hex`);
  return (await response.text()).trim();
}

const historyTxSchema = z.object({
  txid: z.string(),
  fee: z.number(),
  status: z.object({
    confirmed: z.boolean(),
    block_time: z.number().optional(),
  }),
  vin: z.array(
    z.object({
      prevout: z
        .object({
          scriptpubkey_address: z.string().optional(),
          value: z.number(),
        })
        .nullish(),
    }),
  ),
  vout: z.array(
    z.object({
      scriptpubkey_address: z.string().optional(),
      value: z.number(),
    }),
  ),
});

export interface BtcTxSummary {
  txid: string;
  /** Net wallet delta in sats: positive = received, negative = sent (incl. fee). */
  deltaSats: number;
  feeSats: number;
  confirmed: boolean;
  /** Unix ms; undefined while unconfirmed. */
  timestampMs?: number;
}

/** Recent transactions for an address, reduced to the wallet's net balance change. */
export async function fetchBtcHistory(baseUrl: string, address: string): Promise<BtcTxSummary[]> {
  const response = await apiFetch(baseUrl, `/address/${address}/txs`);
  const txs = z.array(historyTxSchema).parse(await response.json());
  return txs.map((tx) => {
    const received = tx.vout
      .filter((o) => o.scriptpubkey_address === address)
      .reduce((sum, o) => sum + o.value, 0);
    const spent = tx.vin
      .filter((i) => i.prevout?.scriptpubkey_address === address)
      .reduce((sum, i) => sum + (i.prevout?.value ?? 0), 0);
    return {
      txid: tx.txid,
      deltaSats: received - spent,
      feeSats: tx.fee,
      confirmed: tx.status.confirmed,
      timestampMs: tx.status.block_time ? tx.status.block_time * 1000 : undefined,
    };
  });
}
