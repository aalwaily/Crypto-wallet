import { describe, expect, it } from 'vitest';
import { formatTrx } from '../services/tronApi';
import { formatUnits, parseDecimalToUnits } from '../wallet/validators';

describe('tron unit conversion', () => {
  it('formats token base units at various decimals', () => {
    expect(formatUnits(1_500_000n, 6)).toBe('1.5'); // USDT-style 6dp
    expect(formatUnits(1n, 6)).toBe('0.000001');
    expect(formatUnits(1_500_000_000_000_000_000n, 18)).toBe('1.5'); // 18dp token
    expect(formatUnits(0n, 18)).toBe('0');
  });

  it('formats TRX from SUN', () => {
    expect(formatTrx(50_000_000)).toBe('50');
    expect(formatTrx(1_234_567)).toBe('1.234567');
  });

  it('round-trips user input to units and back for an 18-decimal token', () => {
    const units = parseDecimalToUnits('12.34', 18);
    expect(units).toBe(12_340_000_000_000_000_000n);
    expect(formatUnits(units!, 18)).toBe('12.34');
  });
});
