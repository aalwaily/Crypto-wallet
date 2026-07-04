/**
 * Offline word-order recovery. When you have all your BIP39 words but not their
 * order, and you know one of your addresses, this searches orderings locally
 * (no network) and finds the one that produces your address. Nothing leaves the
 * device. This only ever reconstructs *your own* wallet from words you provide.
 */
import * as bip39 from 'bip39';
import { BIP32Factory } from 'bip32';
import * as ecc from '@bitcoinerlab/secp256k1';
import * as bitcoin from 'bitcoinjs-lib';
import { getBitcoinJsNetwork } from '../wallet/networks';
import { btcDerivationPath, type BtcAddressType } from '../wallet/bitcoin';
import { checksumValid, decodeNativeProgram, nativeMatches } from './fastDerive';
import type { BtcNetworkId } from '../config';

const bip32 = BIP32Factory(ecc);

export function normalizeWords(input: string): string[] {
  return input.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

/** Guess the address type from a target address prefix. */
export function addressTypeOf(address: string): BtcAddressType {
  const a = address.trim().toLowerCase();
  if (a.startsWith('bc1') || a.startsWith('tb1')) return 'native';
  if (a.startsWith('3') || a.startsWith('2')) return 'nested';
  return 'legacy';
}

/** Guess the network (mainnet/testnet) from a target address prefix. */
export function networkOf(address: string): BtcNetworkId {
  const a = address.trim();
  if (a.startsWith('bc1') || a.startsWith('1') || a.startsWith('3')) return 'mainnet';
  return 'testnet'; // tb1…, 2…, m…, n…
}

/**
 * Derives the address of the given type for a candidate word order.
 * Returns null when the ordering is not a checksum-valid BIP39 mnemonic.
 */
export function deriveAddress(
  words: string[],
  network: BtcNetworkId,
  addressType: BtcAddressType,
): string | null {
  const mnemonic = words.join(' ');
  if (!bip39.validateMnemonic(mnemonic)) return null;
  const seed = bip39.mnemonicToSeedSync(mnemonic);
  const net = getBitcoinJsNetwork(network);
  const node = bip32.fromSeed(seed, net).derivePath(btcDerivationPath(addressType, network));
  const pubkey = node.publicKey;
  if (addressType === 'legacy') {
    return bitcoin.payments.p2pkh({ pubkey, network: net }).address ?? null;
  }
  if (addressType === 'nested') {
    return (
      bitcoin.payments.p2sh({
        redeem: bitcoin.payments.p2wpkh({ pubkey, network: net }),
        network: net,
      }).address ?? null
    );
  }
  return bitcoin.payments.p2wpkh({ pubkey, network: net }).address ?? null;
}

/** Heap's algorithm — yields every permutation of `arr`. */
export function* permutations<T>(arr: readonly T[]): Generator<T[]> {
  const a = arr.slice();
  const n = a.length;
  const c = new Array(n).fill(0);
  yield a.slice();
  let i = 0;
  while (i < n) {
    if (c[i] < i) {
      const swap = i % 2 === 0 ? 0 : c[i];
      const tmp = a[swap]!;
      a[swap] = a[i]!;
      a[i] = tmp;
      yield a.slice();
      c[i]++;
      i = 0;
    } else {
      c[i] = 0;
      i++;
    }
  }
}

export function factorial(n: number): number {
  let r = 1;
  for (let k = 2; k <= n; k++) r *= k;
  return r;
}

export interface RecoveryPlan {
  /** length-N template; a fixed word at locked positions, null at free ones. */
  template: (string | null)[];
  freeWords: string[];
  freePositions: number[];
  /** Number of orderings to try (permutations of the free words). */
  total: number;
}

/**
 * Builds the search plan from all words and the positions the user is sure of.
 * `locked[i]` is the word fixed at position i, or null if that slot is free.
 */
export function buildPlan(words: string[], locked: (string | null)[]): RecoveryPlan {
  const template = locked.slice();
  const freeWords = [...words];
  for (const w of locked) {
    if (!w) continue;
    const idx = freeWords.indexOf(w);
    if (idx >= 0) freeWords.splice(idx, 1);
  }
  const freePositions: number[] = [];
  template.forEach((w, i) => {
    if (!w) freePositions.push(i);
  });
  return { template, freeWords, freePositions, total: factorial(freeWords.length) };
}

/** Assembles a full candidate ordering from a plan and one free-word permutation. */
export function assemble(plan: RecoveryPlan, perm: string[]): string[] {
  const candidate = plan.template.slice();
  plan.freePositions.forEach((pos, k) => {
    candidate[pos] = perm[k]!;
  });
  return candidate as string[];
}

/**
 * Yields full candidates by filling the null slots of `template` with every
 * combination of words from `wordlist` (an odometer of base wordlist.length).
 * Used to recover missing/unknown words at known positions.
 */
export function* missingWordCandidates(
  template: (string | null)[],
  wordlist: readonly string[],
): Generator<string[]> {
  const unknown: number[] = [];
  template.forEach((w, i) => {
    if (!w) unknown.push(i);
  });
  const k = unknown.length;
  const base = wordlist.length;
  const digits = new Array(k).fill(0);
  const candidate = template.slice();
  for (;;) {
    for (let j = 0; j < k; j++) candidate[unknown[j]!] = wordlist[digits[j]!]!;
    yield candidate.slice() as string[];
    let p = k - 1;
    while (p >= 0) {
      digits[p]!++;
      if (digits[p]! < base) break;
      digits[p] = 0;
      p--;
    }
    if (p < 0) break;
  }
}

/** Number of combinations for `unknownCount` missing words over a 2048-word list. */
export function missingWordTotal(unknownCount: number, wordlistSize = 2048): number {
  return wordlistSize ** unknownCount;
}

/**
 * Like missingWordCandidates but only the slice of the space where the FIRST
 * unknown slot falls in this shard's range. Used to split the search across
 * Web Workers: shard i of `shardCount` covers a disjoint part, and the union of
 * all shards is the full space.
 */
export function* missingWordCandidatesShard(
  template: (string | null)[],
  wordlist: readonly string[],
  shardIndex: number,
  shardCount: number,
): Generator<string[]> {
  const unknown: number[] = [];
  template.forEach((w, i) => {
    if (!w) unknown.push(i);
  });
  const k = unknown.length;
  const base = wordlist.length;
  const candidate = template.slice();

  if (k === 0) {
    if (shardIndex === 0) yield candidate.slice() as string[];
    return;
  }

  // Partition the first unknown slot's [0, base) range across shards.
  const per = Math.ceil(base / shardCount);
  const lo = shardIndex * per;
  const hi = Math.min(base, lo + per);
  const rest = unknown.slice(1);
  const digits = new Array(rest.length).fill(0);

  for (let first = lo; first < hi; first++) {
    candidate[unknown[0]!] = wordlist[first]!;
    digits.fill(0);
    for (;;) {
      for (let j = 0; j < rest.length; j++) candidate[rest[j]!] = wordlist[digits[j]!]!;
      yield candidate.slice() as string[];
      let p = rest.length - 1;
      while (p >= 0) {
        digits[p]!++;
        if (digits[p]! < base) break;
        digits[p] = 0;
        p--;
      }
      if (p < 0) break;
    }
  }
}

export interface FindResult {
  found: string[] | null;
  checked: number;
  checksumValid: number;
}

/**
 * Returns a per-candidate matcher: null = not a valid mnemonic, true = matches
 * the target address, false = valid but not a match. Uses the fast native path
 * (checksum + hash160 compare) when the target is a bc1/tb1 address.
 */
function makeMatcher(
  target: string,
  network: BtcNetworkId,
  addressType: BtcAddressType,
): (words: string[]) => boolean | null {
  const wanted = target.trim();
  if (addressType === 'native') {
    const program = decodeNativeProgram(wanted);
    if (program) {
      return (words) => (checksumValid(words) ? nativeMatches(words, network, program) : null);
    }
  }
  return (words) => {
    const address = deriveAddress(words, network, addressType);
    return address ? address === wanted : null;
  };
}

/**
 * Synchronous missing-word search: fills the null slots of `template` from the
 * wordlist and stops at the first ordering whose address equals `target`.
 */
export function findMissingSync(
  template: (string | null)[],
  wordlist: readonly string[],
  target: string,
  network: BtcNetworkId,
  maxChecks = Infinity,
): FindResult {
  const matcher = makeMatcher(target, network, addressTypeOf(target));
  let checked = 0;
  let checksumValid = 0;
  for (const candidate of missingWordCandidates(template, wordlist)) {
    const result = matcher(candidate);
    checked++;
    if (result !== null) {
      checksumValid++;
      if (result) return { found: candidate, checked, checksumValid };
    }
    if (checked >= maxChecks) break;
  }
  return { found: null, checked, checksumValid };
}

/**
 * Synchronous order search (used by tests and, in chunks, by the UI).
 * Stops at the first ordering whose derived address equals `target`.
 */
export function findOrderSync(
  words: string[],
  locked: (string | null)[],
  target: string,
  network: BtcNetworkId,
  maxChecks = Infinity,
): FindResult {
  const plan = buildPlan(words, locked);
  const matcher = makeMatcher(target, network, addressTypeOf(target));
  let checked = 0;
  let checksumValid = 0;
  for (const perm of permutations(plan.freeWords)) {
    const candidate = assemble(plan, perm);
    const result = matcher(candidate);
    checked++;
    if (result !== null) {
      checksumValid++;
      if (result) return { found: candidate, checked, checksumValid };
    }
    if (checked >= maxChecks) break;
  }
  return { found: null, checked, checksumValid };
}
