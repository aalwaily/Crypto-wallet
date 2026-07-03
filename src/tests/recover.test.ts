import { describe, expect, it } from 'vitest';
import {
  addressTypeOf,
  buildPlan,
  deriveAddress,
  factorial,
  findOrderSync,
  normalizeWords,
  permutations,
} from '../recover/search';

// Pinned vector: a valid 12-word mnemonic (distinct words) and its native address.
const MNEMONIC = 'excite high kitchen humor entire cabbage fantasy timber erosion smooth spell debris';
const ADDRESS = 'bc1qu9pdys0cmclr9cukcqqll2h3hwpf39mt3vzwfk';
const WORDS = MNEMONIC.split(' ');

describe('recovery search', () => {
  it('detects the address type from the prefix', () => {
    expect(addressTypeOf('bc1qxyz')).toBe('native');
    expect(addressTypeOf('tb1qxyz')).toBe('native');
    expect(addressTypeOf('3ABC')).toBe('nested');
    expect(addressTypeOf('2ABC')).toBe('nested');
    expect(addressTypeOf('1ABC')).toBe('legacy');
  });

  it('derives the native address for the correct order', () => {
    expect(deriveAddress(WORDS, 'mainnet', 'native')).toBe(ADDRESS);
  });

  it('returns null for a checksum-invalid ordering', () => {
    const scrambled = [...WORDS].reverse();
    // Reversed order is (almost certainly) not checksum-valid.
    expect(deriveAddress(scrambled, 'mainnet', 'native')).toBeNull();
  });

  it('recovers the correct order from a few free positions', () => {
    // Lock all but positions 2, 6, 10 → 3! = 6 orderings to try.
    const locked = WORDS.map((w, i) => (i === 2 || i === 6 || i === 10 ? null : w));
    const res = findOrderSync(WORDS, locked, ADDRESS, 'mainnet');
    expect(res.found).toEqual(WORDS);
  });

  it('returns not-found for a target address that is not derivable', () => {
    const locked = WORDS.map((w, i) => (i === 2 || i === 6 ? null : w));
    const res = findOrderSync(WORDS, locked, 'bc1qwrongaddressxxxxxxxxxxxxxxxxxxxxxxxxxx', 'mainnet');
    expect(res.found).toBeNull();
    expect(res.checked).toBeGreaterThan(0);
  });

  it('builds a plan with the right free words and permutation count', () => {
    const locked = WORDS.map((w, i) => (i < 9 ? w : null)); // 3 free
    const plan = buildPlan(WORDS, locked);
    expect(plan.freePositions).toEqual([9, 10, 11]);
    expect(plan.freeWords).toEqual(WORDS.slice(9));
    expect(plan.total).toBe(6);
  });

  it('permutations enumerates n! orderings', () => {
    expect([...permutations([1, 2, 3])]).toHaveLength(6);
    expect([...permutations(['a', 'b', 'c', 'd'])]).toHaveLength(24);
    expect(factorial(5)).toBe(120);
  });

  it('normalizes whitespace and case', () => {
    expect(normalizeWords('  Excite   HIGH\tkitchen ')).toEqual(['excite', 'high', 'kitchen']);
  });
});
