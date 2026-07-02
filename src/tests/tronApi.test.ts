import { describe, expect, it } from 'vitest';
import { formatTrx, formatUsdt } from '../services/tronApi';
import { parseDecimalToUnits } from '../wallet/validators';
import { USDT_DECIMALS } from '../config';

describe('tron unit conversion', () => {
  it('formats USDT base units (6 decimals)', () => {
    expect(formatUsdt(1_500_000n)).toBe('1.5');
    expect(formatUsdt(1n)).toBe('0.000001');
    expect(formatUsdt(0n)).toBe('0');
  });

  it('formats TRX from SUN', () => {
    expect(formatTrx(50_000_000)).toBe('50');
    expect(formatTrx(1_234_567)).toBe('1.234567');
  });

  it('round-trips user input to units and back', () => {
    const units = parseDecimalToUnits('12.34', USDT_DECIMALS);
    expect(units).toBe(12_340_000n);
    expect(formatUsdt(units!)).toBe('12.34');
  });
});
