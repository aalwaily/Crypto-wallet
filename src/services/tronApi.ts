/**
 * Tron / TRC20 operations via TronWeb against the configured TronGrid endpoint.
 * All TRC20 tokens share one Tron address; a token is identified by its
 * contract + decimals (see TRON_NETWORKS[*].tokens in config.ts).
 */
import { z } from 'zod';
import { createTronWeb, deriveTronPrivateKey } from '../wallet/tron';
import { getTronNetworkConfig } from '../wallet/networks';
import {
  MIN_TRX_FOR_FEES_SUN,
  TRC20_ABI,
  TRC20_FEE_LIMIT_SUN,
  type TronNetworkId,
  type Trc20Token,
} from '../config';
import { formatUnits } from '../wallet/validators';

export class TronApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TronApiError';
  }
}

export class InsufficientTrxError extends Error {
  constructor(balanceSun: number) {
    super(
      `Not enough TRX to cover network fees. Balance: ${formatUnits(BigInt(balanceSun), 6)} TRX, ` +
        `required: ${formatUnits(BigInt(MIN_TRX_FOR_FEES_SUN), 6)} TRX. Use a faucet to top up.`,
    );
    this.name = 'InsufficientTrxError';
  }
}

export interface TokenBalance {
  token: Trc20Token;
  units: bigint;
}

export interface TronAssets {
  trxSun: number;
  tokens: TokenBalance[];
}

/**
 * Fetches TRX plus every configured TRC20 balance for the network in parallel.
 * A single token's failure yields a 0 balance rather than failing the whole set.
 */
export async function fetchTronAssets(
  networkId: TronNetworkId,
  address: string,
): Promise<TronAssets> {
  const tronWeb = createTronWeb(networkId);
  tronWeb.setAddress(address);
  const { tokens } = getTronNetworkConfig(networkId);

  let trxSun: number;
  try {
    trxSun = await tronWeb.trx.getBalance(address);
  } catch (error) {
    throw new TronApiError(
      `Failed to fetch TRX balance: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const balances = await Promise.all(
    tokens.map(async (token): Promise<TokenBalance> => {
      try {
        // Minimal ABI avoids a per-token on-chain ABI fetch, keeping this fast.
        const contract = tronWeb.contract(TRC20_ABI as unknown as never[], token.contract);
        const raw = await contract.balanceOf(address).call();
        return { token, units: BigInt(raw.toString()) };
      } catch {
        return { token, units: 0n };
      }
    }),
  );

  return { trxSun, tokens: balances };
}

/** Balance of a single TRC20 token (base units). Used by the send-screen Max button. */
export async function fetchTrc20Balance(
  networkId: TronNetworkId,
  address: string,
  token: Trc20Token,
): Promise<bigint> {
  const tronWeb = createTronWeb(networkId);
  tronWeb.setAddress(address);
  try {
    const contract = tronWeb.contract(TRC20_ABI as unknown as never[], token.contract);
    const raw = await contract.balanceOf(address).call();
    return BigInt(raw.toString());
  } catch (error) {
    throw new TronApiError(
      `Failed to fetch ${token.symbol} balance: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export interface Trc20TransferParams {
  mnemonic: string;
  networkId: TronNetworkId;
  token: Trc20Token;
  toAddress: string;
  amountUnits: bigint;
}

/**
 * Signs and broadcasts a TRC20 transfer for any token. Verifies the account
 * holds enough TRX for fees first. Returns the transaction id.
 */
export async function sendTrc20(params: Trc20TransferParams): Promise<string> {
  const { mnemonic, networkId, token, toAddress, amountUnits } = params;

  const privateKey = await deriveTronPrivateKey(mnemonic);
  const tronWeb = createTronWeb(networkId, privateKey);
  const ownAddress = tronWeb.defaultAddress.base58;
  if (!ownAddress) throw new TronApiError('Failed to resolve own Tron address.');

  const trxSun = await tronWeb.trx.getBalance(ownAddress);
  if (trxSun < MIN_TRX_FOR_FEES_SUN) {
    throw new InsufficientTrxError(trxSun);
  }

  try {
    const contract = tronWeb.contract(TRC20_ABI as unknown as never[], token.contract);
    const txid: string = await contract
      .transfer(toAddress, amountUnits.toString())
      .send({ feeLimit: TRC20_FEE_LIMIT_SUN });
    return txid;
  } catch (error) {
    throw new TronApiError(
      `${token.symbol} transfer failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

const trc20TransferSchema = z.object({
  transaction_id: z.string(),
  from: z.string(),
  to: z.string(),
  value: z.string(),
  block_timestamp: z.number(),
  token_info: z
    .object({
      symbol: z.string().optional(),
      decimals: z.number().optional(),
      address: z.string().optional(),
    })
    .optional(),
});

const trc20HistoryResponseSchema = z.object({
  data: z.array(trc20TransferSchema),
});

export interface Trc20Transfer {
  txid: string;
  direction: 'in' | 'out';
  amountUnits: bigint;
  counterparty: string;
  timestampMs: number;
  symbol: string;
  decimals: number;
}

/**
 * Recent TRC20 transfers (all tokens) for an address via TronGrid. Token symbol
 * and decimals come from the API's token_info, so any token is labeled correctly.
 */
export async function fetchTrc20History(
  networkId: TronNetworkId,
  address: string,
  limit = 30,
): Promise<Trc20Transfer[]> {
  const config = getTronNetworkConfig(networkId);
  const url = `${config.fullHost}/v1/accounts/${address}/transactions/trc20?limit=${limit}`;
  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    throw new TronApiError('Tron API is unreachable. Check your connection.');
  }
  if (!response.ok) {
    throw new TronApiError(`Tron API error (${response.status}).`);
  }
  const parsed = trc20HistoryResponseSchema.parse(await response.json());
  return parsed.data.map((t) => ({
    txid: t.transaction_id,
    direction: t.to === address ? ('in' as const) : ('out' as const),
    amountUnits: BigInt(t.value),
    counterparty: t.to === address ? t.from : t.to,
    timestampMs: t.block_timestamp,
    symbol: t.token_info?.symbol || 'TRC20',
    decimals: t.token_info?.decimals ?? 6,
  }));
}

export function formatTrx(sun: number): string {
  return formatUnits(BigInt(sun), 6);
}
