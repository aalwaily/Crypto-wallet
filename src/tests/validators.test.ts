import { describe, expect, it } from 'vitest';
import { networks } from 'bitcoinjs-lib';
import {
  btcToSats,
  formatUnits,
  isValidBtcAddress,
  isValidTronAddress,
  parseDecimalToUnits,
  satsToBtc,
} from '../wallet/validators';

describe('bitcoin address validation', () => {
  it('accepts a valid testnet bech32 address on testnet', () => {
    expect(isValidBtcAddress('tb1q6rz28mcfaxtmd6v789l9rrlrusdprr9pqcpvkl', networks.testnet)).toBe(
      true,
    );
  });

  it('rejects a mainnet address on testnet (and vice versa)', () => {
    expect(isValidBtcAddress('bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu', networks.testnet)).toBe(
      false,
    );
    expect(isValidBtcAddress('tb1q6rz28mcfaxtmd6v789l9rrlrusdprr9pqcpvkl', networks.bitcoin)).toBe(
      false,
    );
  });

  it('rejects malformed input', () => {
    expect(isValidBtcAddress('', networks.testnet)).toBe(false);
    expect(isValidBtcAddress('not-an-address', networks.testnet)).toBe(false);
    expect(isValidBtcAddress('tb1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq', networks.testnet)).toBe(
      false,
    );
  });
});

describe('tron address validation', () => {
  it('accepts a valid base58 Tron address', () => {
    expect(isValidTronAddress('TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH')).toBe(true);
  });

  it('rejects malformed input', () => {
    expect(isValidTronAddress('')).toBe(false);
    expect(isValidTronAddress('TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdX')).toBe(false); // bad checksum
    expect(isValidTronAddress('0x0000000000000000000000000000000000000000')).toBe(false);
  });
});

describe('amount parsing', () => {
  it('parses decimal strings to base units without float loss', () => {
    expect(parseDecimalToUnits('1', 6)).toBe(1_000_000n);
    expect(parseDecimalToUnits('0.000001', 6)).toBe(1n);
    expect(parseDecimalToUnits('123.456789', 6)).toBe(123_456_789n);
    expect(btcToSats('0.00000001')).toBe(1n);
    expect(btcToSats('21000000')).toBe(2_100_000_000_000_000n);
  });

  it('rejects invalid amounts', () => {
    expect(parseDecimalToUnits('0', 6)).toBeNull();
    expect(parseDecimalToUnits('-1', 6)).toBeNull();
    expect(parseDecimalToUnits('1.2345678', 6)).toBeNull(); // too many decimals
    expect(parseDecimalToUnits('1,5', 6)).toBeNull();
    expect(parseDecimalToUnits('abc', 6)).toBeNull();
    expect(parseDecimalToUnits('1e5', 6)).toBeNull();
    expect(parseDecimalToUnits('', 6)).toBeNull();
  });

  it('formats base units back to decimal strings', () => {
    expect(formatUnits(1_500_000n, 6)).toBe('1.5');
    expect(formatUnits(1n, 8)).toBe('0.00000001');
    expect(formatUnits(100_000_000n, 8)).toBe('1');
    expect(satsToBtc(12_345)).toBe('0.00012345');
  });
});
