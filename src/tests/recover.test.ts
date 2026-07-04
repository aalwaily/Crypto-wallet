import { describe, expect, it } from 'vitest';
import { wordlists } from 'bip39';
import {
  addressTypeOf,
  buildPlan,
  deriveAddress,
  factorial,
  findMissingSync,
  findOrderSync,
  missingWordCandidates,
  missingWordCandidatesShard,
  missingWordTotal,
  normalizeWords,
  permutations,
} from '../recover/search';

const ENGLISH = wordlists.english as string[];

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

describe('missing-word recovery', () => {
  it('enumerates combinations as an odometer over the wordlist', () => {
    const list = ['a', 'b', 'c', 'd'];
    // template with 2 unknown slots → 4^2 = 16 candidates
    const template = ['x', null, 'y', null];
    const all = [...missingWordCandidates(template, list)];
    expect(all).toHaveLength(16);
    expect(all[0]).toEqual(['x', 'a', 'y', 'a']);
    expect(all[5]).toEqual(['x', 'b', 'y', 'b']);
    expect(all[15]).toEqual(['x', 'd', 'y', 'd']);
    // fixed positions never change
    expect(all.every((c) => c[0] === 'x' && c[2] === 'y')).toBe(true);
  });

  it('yields exactly one candidate when nothing is missing', () => {
    expect([...missingWordCandidates(['a', 'b'], ['a', 'b', 'c'])]).toEqual([['a', 'b']]);
  });

  it('computes the combination count', () => {
    expect(missingWordTotal(1)).toBe(2048);
    expect(missingWordTotal(2)).toBe(2048 * 2048);
  });

  it('shards cover the full space with no overlap', () => {
    const list = ['a', 'b', 'c', 'd', 'e'];
    const template = ['x', null, null]; // 2 unknowns → 5^2 = 25 candidates
    const full = [...missingWordCandidates(template, list)].map((c) => c.join(','));
    const shardCount = 3;
    const sharded: string[] = [];
    for (let i = 0; i < shardCount; i++) {
      for (const c of missingWordCandidatesShard(template, list, i, shardCount)) {
        sharded.push(c.join(','));
      }
    }
    expect(sharded).toHaveLength(full.length);
    expect(new Set(sharded).size).toBe(full.length); // no duplicates
    expect(new Set(sharded)).toEqual(new Set(full)); // same coverage
  });

  it('recovers a single missing word from the full 2048-word list', () => {
    // Blank out position 4 ("entire") and let the search find it.
    const template = WORDS.map((w, i) => (i === 4 ? null : w));
    const res = findMissingSync(template, ENGLISH, ADDRESS, 'mainnet');
    expect(res.found).toEqual(WORDS);
  });

  it('returns not-found when the missing word cannot produce the address', () => {
    const template = WORDS.map((w, i) => (i === 4 ? null : w));
    const res = findMissingSync(template, ENGLISH, 'bc1qdefinitelynotyouraddressxxxxxxxxxxxxx', 'mainnet');
    expect(res.found).toBeNull();
    expect(res.checked).toBe(2048);
  });
});
