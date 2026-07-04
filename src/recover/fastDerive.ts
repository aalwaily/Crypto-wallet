/**
 * High-speed native-SegWit (bc1/tb1) derivation for the recovery search, built
 * on @noble/hashes and @scure/bip32 (audited, optimized). Two structural wins
 * over the general path:
 *   1) checksumValid() rejects ~15/16 candidates with only a SHA-256 — no
 *      mnemonic string, no PBKDF2, no key derivation.
 *   2) the target address is decoded once to its 20-byte hash160, so each valid
 *      candidate is compared as raw bytes (no per-candidate address encoding).
 * Only checksum-valid candidates pay the (deliberately slow) PBKDF2 seed cost.
 */
import { pbkdf2 } from '@noble/hashes/pbkdf2';
import { sha512 } from '@noble/hashes/sha512';
import { sha256 } from '@noble/hashes/sha256';
import { ripemd160 } from '@noble/hashes/ripemd160';
import { HDKey } from '@scure/bip32';
import { bech32 } from '@scure/base';
import { wordlists } from 'bip39';
import type { BtcNetworkId } from '../config';

const WORDS = wordlists.english as string[];
const WORD_INDEX = new Map<string, number>();
WORDS.forEach((w, i) => WORD_INDEX.set(w, i));

const encoder = new TextEncoder();
const MNEMONIC_SALT = encoder.encode('mnemonic');

/**
 * BIP39 checksum check straight from word indices — no string building.
 * Returns false for any word not in the list or a bad checksum.
 */
export function checksumValid(words: string[]): boolean {
  const L = words.length;
  const totalBits = L * 11;
  const csBits = totalBits / 33; // 4 bits per 12 words; integer for valid lengths
  if (!Number.isInteger(csBits)) return false;
  const entBits = totalBits - csBits;
  const entBytes = entBits / 8;

  const bytes = new Uint8Array(Math.ceil(totalBits / 8));
  let bitpos = 0;
  for (const w of words) {
    const idx = WORD_INDEX.get(w);
    if (idx === undefined) return false;
    for (let b = 10; b >= 0; b--) {
      if ((idx >> b) & 1) bytes[bitpos >> 3]! |= 0x80 >> (bitpos & 7);
      bitpos++;
    }
  }
  const hash = sha256(bytes.subarray(0, entBytes));
  for (let i = 0; i < csBits; i++) {
    const hb = (hash[i >> 3]! >> (7 - (i & 7))) & 1;
    const pos = entBits + i;
    const cb = (bytes[pos >> 3]! >> (7 - (pos & 7))) & 1;
    if (hb !== cb) return false;
  }
  return true;
}

/** Decodes a native-SegWit (v0) address to its 20-byte hash160, or null. */
export function decodeNativeProgram(address: string): Uint8Array | null {
  try {
    const decoded = bech32.decode(address.trim() as `${string}1${string}`);
    if (decoded.words[0] !== 0) return null; // only witness v0
    const program = bech32.fromWords(decoded.words.slice(1));
    return program.length === 20 ? Uint8Array.from(program) : null;
  } catch {
    return null;
  }
}

/**
 * Returns true if the candidate ordering derives to `targetProgram` (the
 * hash160 of the target native address). Assumes checksum was already checked.
 */
export function nativeMatches(
  words: string[],
  network: BtcNetworkId,
  targetProgram: Uint8Array,
): boolean {
  const password = encoder.encode(words.join(' ').normalize('NFKD'));
  const seed = pbkdf2(sha512, password, MNEMONIC_SALT, { c: 2048, dkLen: 64 });
  const path = network === 'mainnet' ? "m/84'/0'/0'/0/0" : "m/84'/1'/0'/0/0";
  const child = HDKey.fromMasterSeed(seed).derive(path);
  if (!child.publicKey) return false;
  const h160 = ripemd160(sha256(child.publicKey));
  if (h160.length !== targetProgram.length) return false;
  for (let i = 0; i < h160.length; i++) {
    if (h160[i] !== targetProgram[i]) return false;
  }
  return true;
}
