import { address as btcAddress } from 'bitcoinjs-lib';
import { TronWeb } from 'tronweb';
import type { Network } from 'bitcoinjs-lib';

export function isValidBtcAddress(value: string, network: Network): boolean {
  try {
    btcAddress.toOutputScript(value.trim(), network);
    return true;
  } catch {
    return false;
  }
}

export function isValidTronAddress(value: string): boolean {
  return TronWeb.isAddress(value.trim());
}

/**
 * Parses a positive decimal amount string into integer base units.
 * Uses string arithmetic to avoid floating-point precision loss.
 * Returns null for anything that is not a plain decimal number or that has
 * more fractional digits than the asset supports.
 */
export function parseDecimalToUnits(value: string, decimals: number): bigint | null {
  const trimmed = value.trim();
  const match = /^(\d+)(?:\.(\d+))?$/.exec(trimmed);
  if (!match) return null;
  const whole = match[1] ?? '0';
  const frac = match[2] ?? '';
  if (frac.length > decimals) return null;
  const units = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, '0') || '0');
  if (units <= 0n) return null;
  return units;
}

/** Formats integer base units back into a decimal string (no trailing zeros). */
export function formatUnits(units: bigint, decimals: number): string {
  const divisor = 10n ** BigInt(decimals);
  const whole = units / divisor;
  const frac = (units % divisor).toString().padStart(decimals, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole.toString();
}

export function btcToSats(value: string): bigint | null {
  return parseDecimalToUnits(value, 8);
}

export function satsToBtc(sats: bigint | number): string {
  return formatUnits(BigInt(sats), 8);
}
