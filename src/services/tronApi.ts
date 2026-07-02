/**
 * Tron / USDT-TRC20 operations via TronWeb against the configured TronGrid
 * endpoint (Nile or Shasta testnet by default).
 */
import { z } from 'zod';
import { createTronWeb, deriveTronPrivateKey } from '../wallet/tron';
import { getTronNetworkConfig } from '../wallet/networks';
import {
  MIN_TRX_FOR_FEES_SUN,
  TRC20_FEE_LIMIT_SUN,
  USDT_DECIMALS,
  type TronNetworkId,
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

export interface TronBalances {
  trxSun: number;
  usdtUnits: bigint;
}

export async function fetchTronBalances(
  networkId: TronNetworkId,
  address: string,
): Promise<TronBalances> {
  const tronWeb = createTronWeb(networkId);
  // Contract read calls require an address context even without a private key.
  tronWeb.setAddress(address);
  const config = getTronNetworkConfig(networkId);
  try {
    const trxSun = await tronWeb.trx.getBalance(address);
    const contract = await tronWeb.contract().at(config.usdtContract);
    const rawBalance = await contract.balanceOf(address).call();
    return { trxSun, usdtUnits: BigInt(rawBalance.toString()) };
  } catch (error) {
    throw new TronApiError(
      `Failed to fetch Tron balances: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export interface UsdtTransferParams {
  mnemonic: string;
  networkId: TronNetworkId;
  toAddress: string;
  amountUnits: bigint;
}

/**
 * Signs and broadcasts a USDT transfer. Verifies the account holds enough TRX
 * for fees first. Returns the transaction id.
 */
export async function sendUsdt(params: UsdtTransferParams): Promise<string> {
  const { mnemonic, networkId, toAddress, amountUnits } = params;
  const config = getTronNetworkConfig(networkId);

  const privateKey = await deriveTronPrivateKey(mnemonic);
  const tronWeb = createTronWeb(networkId, privateKey);
  const ownAddress = tronWeb.defaultAddress.base58;
  if (!ownAddress) throw new TronApiError('Failed to resolve own Tron address.');

  const trxSun = await tronWeb.trx.getBalance(ownAddress);
  if (trxSun < MIN_TRX_FOR_FEES_SUN) {
    throw new InsufficientTrxError(trxSun);
  }

  try {
    const contract = await tronWeb.contract().at(config.usdtContract);
    const txid: string = await contract
      .transfer(toAddress, amountUnits.toString())
      .send({ feeLimit: TRC20_FEE_LIMIT_SUN });
    return txid;
  } catch (error) {
    throw new TronApiError(
      `USDT transfer failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

const trc20TransferSchema = z.object({
  transaction_id: z.string(),
  from: z.string(),
  to: z.string(),
  value: z.string(),
  block_timestamp: z.number(),
});

const trc20HistoryResponseSchema = z.object({
  data: z.array(trc20TransferSchema),
});

export interface UsdtTransfer {
  txid: string;
  direction: 'in' | 'out';
  amountUnits: bigint;
  counterparty: string;
  timestampMs: number;
}

/** Recent USDT transfers for an address via TronGrid's TRC20 endpoint. */
export async function fetchUsdtHistory(
  networkId: TronNetworkId,
  address: string,
  limit = 30,
): Promise<UsdtTransfer[]> {
  const config = getTronNetworkConfig(networkId);
  const url =
    `${config.fullHost}/v1/accounts/${address}/transactions/trc20` +
    `?limit=${limit}&contract_address=${config.usdtContract}`;
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
  }));
}

export function formatUsdt(units: bigint): string {
  return formatUnits(units, USDT_DECIMALS);
}

export function formatTrx(sun: number): string {
  return formatUnits(BigInt(sun), 6);
}
