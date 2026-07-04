#!/usr/bin/env node
/**
 * Offline word-order / missing-word recovery — terminal edition.
 *
 * 100% local, no internet. Reconstructs YOUR OWN wallet from words you provide,
 * matching one or MANY known native-SegWit (bc1…/tb1…) addresses. It cannot
 * guess an unknown seed — that is mathematically impossible.
 *
 *   npm run recover -- [--random] "<words with ? for blanks>" "<addr1,addr2,…ORfile.txt>"
 *   npm run recover                (interactive prompts)
 *
 * Words: paste 12/24 words IN ORDER, using ? for each missing/unknown word.
 * Addresses: comma/space/newline separated, or a path to a file (one per line).
 *
 * --random : traverse the combinations in a shuffled (non-repeating) order via a
 *            bijection instead of sequential order. NOTE: this does NOT make it
 *            faster — the wallet's position is random, so expected time is the
 *            same. It only changes which combinations are tried first.
 */
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import os from 'node:os';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { wordlists } from 'bip39';
import { pbkdf2 } from '@noble/hashes/pbkdf2';
import { sha512 } from '@noble/hashes/sha512';
import { sha256 } from '@noble/hashes/sha256';
import { ripemd160 } from '@noble/hashes/ripemd160';
import { HDKey } from '@scure/bip32';
import { bech32 } from '@scure/base';

const WORDS = wordlists.english;
const WORD_INDEX = new Map(WORDS.map((w, i) => [w, i]));
const enc = new TextEncoder();
const SALT = enc.encode('mnemonic');
const BASE = 2048n;

// How many address indices to scan per candidate (receive branch 0, change branch 1).
const SCAN_RECEIVE = Number(process.env.RECOVER_SCAN_RECEIVE || 25);
const SCAN_CHANGE = Number(process.env.RECOVER_SCAN_CHANGE || 5);

// ---- shared crypto (mirrors src/recover/fastDerive.ts) ----

function checksumValid(words) {
  const L = words.length;
  const totalBits = L * 11;
  const csBits = totalBits / 33;
  if (!Number.isInteger(csBits)) return false;
  const entBits = totalBits - csBits;
  const entBytes = entBits / 8;
  const bytes = new Uint8Array(Math.ceil(totalBits / 8));
  let bitpos = 0;
  for (const w of words) {
    const idx = WORD_INDEX.get(w);
    if (idx === undefined) return false;
    for (let b = 10; b >= 0; b--) {
      if ((idx >> b) & 1) bytes[bitpos >> 3] |= 0x80 >> (bitpos & 7);
      bitpos++;
    }
  }
  const hash = sha256(bytes.subarray(0, entBytes));
  for (let i = 0; i < csBits; i++) {
    const hb = (hash[i >> 3] >> (7 - (i & 7))) & 1;
    const pos = entBits + i;
    const cb = (bytes[pos >> 3] >> (7 - (pos & 7))) & 1;
    if (hb !== cb) return false;
  }
  return true;
}

function toHex(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0');
  return s;
}

function decodeNativeHex(address) {
  try {
    const d = bech32.decode(address.trim());
    if (d.words[0] !== 0) return null;
    const program = bech32.fromWords(d.words.slice(1));
    return program.length === 20 ? toHex(program) : null;
  } catch {
    return null;
  }
}

function scanMatch(words, network, targetSet) {
  const seed = pbkdf2(sha512, enc.encode(words.join(' ').normalize('NFKD')), SALT, {
    c: 2048,
    dkLen: 64,
  });
  const coin = network === 'mainnet' ? 0 : 1;
  const account = HDKey.fromMasterSeed(seed).derive(`m/84'/${coin}'/0'`);
  for (const [branch, depth] of [
    [0, SCAN_RECEIVE],
    [1, SCAN_CHANGE],
  ]) {
    if (depth <= 0) continue;
    const branchNode = account.deriveChild(branch);
    for (let i = 0; i < depth; i++) {
      const child = branchNode.deriveChild(i);
      if (!child.publicKey) continue;
      const hex = toHex(ripemd160(sha256(child.publicKey)));
      if (targetSet.has(hex)) return { branch, index: i, hex };
    }
  }
  return null;
}

function unknownPositions(template) {
  const u = [];
  template.forEach((w, i) => {
    if (!w) u.push(i);
  });
  return u;
}

/** Fills the unknown slots of `candidate` from the base-2048 digits of index g. */
function fillCandidate(candidate, unknown, g) {
  for (let j = unknown.length - 1; j >= 0; j--) {
    candidate[unknown[j]] = WORDS[Number(g % BASE)];
    g = g / BASE;
  }
}

// ---- worker: iterate a disjoint slice of the index space ----

if (!isMainThread) {
  const { template, targets, network, iStart, iEnd, A, C, total, random } = workerData;
  const unknown = unknownPositions(template);
  const candidate = template.slice();
  const targetSet = new Set(targets);
  const end = BigInt(iEnd);
  const a = BigInt(A);
  const c = BigInt(C);
  const N = BigInt(total);
  let checked = 0;
  let valid = 0;
  let last = Date.now();
  for (let i = BigInt(iStart); i < end; i++) {
    // random ? shuffled index via bijection : sequential index
    fillCandidate(candidate, unknown, random ? (a * i + c) % N : i);
    checked++;
    if (checksumValid(candidate)) {
      valid++;
      const hit = scanMatch(candidate, network, targetSet);
      if (hit) {
        parentPort.postMessage({ type: 'found', candidate: candidate.slice(), checked, valid, hit });
        process.exit(0);
      }
    }
    if ((checked & 8191) === 0) {
      const now = Date.now();
      if (now - last > 250) {
        parentPort.postMessage({ type: 'progress', checked, valid });
        last = now;
      }
    }
  }
  parentPort.postMessage({ type: 'done', checked, valid });
  process.exit(0);
}

// ---- main ----

function fmtDuration(ms) {
  if (!isFinite(ms)) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

/** Uniform random BigInt in [0, n) where n is a power of two. */
function randBelow(n) {
  const bits = (n - 1n).toString(2).length;
  const bytes = Math.ceil(bits / 8);
  return BigInt('0x' + crypto.randomBytes(bytes).toString('hex')) % n;
}

async function readInputs(argv) {
  if (argv[0] && argv[1]) {
    return { wordsLine: argv[0], addressArg: argv[1] };
  }
  const readline = await import('node:readline/promises');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log('\n  Offline wallet recovery (no internet) — bc1/tb1 addresses\n');
  console.log('  Paste your words IN ORDER. Use ? for each missing/unknown word.\n');
  const wordsLine = await rl.question('  Words: ');
  const addressArg = await rl.question('  Address(es) — comma/space separated, or a file path: ');
  rl.close();
  return { wordsLine, addressArg };
}

function parseAddresses(arg) {
  const text = fs.existsSync(arg) ? fs.readFileSync(arg, 'utf8') : arg;
  return text
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

async function main() {
  const args = process.argv.slice(2);
  const random = args.includes('--random');
  const positional = args.filter((a) => a !== '--random');
  const { wordsLine, addressArg } = await readInputs(positional);

  const raw = wordsLine.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (![12, 15, 18, 21, 24].includes(raw.length)) {
    console.error(`\n  ✗ Expected 12–24 words (use ? for blanks), got ${raw.length}.`);
    process.exit(1);
  }
  const template = raw.map((w) => (w === '?' || w === '_' ? null : w));
  const badWord = template.find((w) => w && !WORD_INDEX.has(w));
  if (badWord) {
    console.error(`\n  ✗ "${badWord}" is not a valid BIP39 word.`);
    process.exit(1);
  }

  const targetMap = new Map();
  let network = null;
  for (const addr of parseAddresses(addressArg)) {
    const hex = decodeNativeHex(addr);
    if (!hex) {
      console.warn(`  ⚠ skipping non native-SegWit address: ${addr}`);
      continue;
    }
    targetMap.set(hex, addr);
    if (!network) network = addr.startsWith('tb1') ? 'testnet' : 'mainnet';
  }
  if (targetMap.size === 0) {
    console.error('\n  ✗ No valid bc1…/tb1… address given.');
    process.exit(1);
  }
  const targets = [...targetMap.keys()];

  const unknownCount = template.filter((w) => !w).length;
  if (unknownCount === 0) {
    console.error('\n  ✗ Nothing to search — leave at least one word as ?.');
    process.exit(1);
  }

  const total = BASE ** BigInt(unknownCount);
  const totalNum = Number(total);
  const cores = Math.max(1, Math.min(os.cpus().length, 32));

  // Random traversal: a bijection f(i) = (A·i + C) mod total over the index
  // space. A is odd (coprime to the power-of-two total), so f is a permutation —
  // every combination appears exactly once, in shuffled order, with no repeats,
  // even when split across cores.
  const A = random ? randBelow(total) | 1n : 1n;
  const C = random ? randBelow(total) : 0n;

  console.log(
    `\n  ${unknownCount} unknown word(s) · ${totalNum.toLocaleString()} combinations · ` +
      `${targetMap.size} address(es) · ${random ? 'RANDOM order' : 'sequential'} · ` +
      `scan ${SCAN_RECEIVE}+${SCAN_CHANGE} · ${cores} cores\n`,
  );
  if (random) {
    console.log('  (random order does not change how long it takes — same expected time)\n');
  }

  const checkedArr = new Array(cores).fill(0);
  const validArr = new Array(cores).fill(0);
  const workers = [];
  const t0 = Date.now();
  let done = 0;
  let finished = false;
  const self = fileURLToPath(import.meta.url);
  const per = total / BigInt(cores);

  const render = () => {
    const checked = checkedArr.reduce((a, b) => a + b, 0);
    const valid = validArr.reduce((a, b) => a + b, 0);
    const elapsed = Date.now() - t0;
    const rate = elapsed > 0 ? checked / (elapsed / 1000) : 0;
    const eta = rate > 0 ? ((totalNum - checked) / rate) * 1000 : Infinity;
    const pct = totalNum > 0 ? Math.min(100, (checked / totalNum) * 100).toFixed(2) : '0';
    process.stdout.write(
      `\r  ${pct}%  ${checked.toLocaleString()}/${totalNum.toLocaleString()}  ` +
        `${Math.round(rate).toLocaleString()}/s  valid ${valid.toLocaleString()}  ETA ${fmtDuration(eta)}   `,
    );
  };

  const finish = (candidate, hit) => {
    if (finished) return;
    finished = true;
    workers.forEach((w) => w.terminate());
    render();
    if (candidate) {
      console.log('\n\n  ✓ FOUND YOUR WALLET:\n');
      candidate.forEach((w, i) => console.log(`     ${String(i + 1).padStart(2)}. ${w}`));
      console.log(`\n  Phrase: ${candidate.join(' ')}`);
      if (hit) {
        const matched = targetMap.get(hit.hex);
        console.log(`  Matched: ${matched}  (${hit.branch === 0 ? 'receive' : 'change'} index ${hit.index})`);
      }
      console.log('\n  Write these words on paper in this exact order, then import them.\n');
    } else {
      console.log('\n\n  ✗ No combination produced any of those addresses.');
      console.log('  Check the words/addresses, or you may be missing too many words.\n');
    }
    process.exit(0);
  };

  const timer = setInterval(render, 300);

  for (let i = 0; i < cores; i++) {
    const iStart = BigInt(i) * per;
    const iEnd = i === cores - 1 ? total : BigInt(i + 1) * per;
    const worker = new Worker(self, {
      workerData: {
        template,
        targets,
        network,
        iStart: iStart.toString(),
        iEnd: iEnd.toString(),
        A: A.toString(),
        C: C.toString(),
        total: total.toString(),
        random,
      },
    });
    worker.on('message', (m) => {
      checkedArr[i] = m.checked;
      validArr[i] = m.valid;
      if (m.type === 'found') {
        clearInterval(timer);
        finish(m.candidate, m.hit);
      } else if (m.type === 'done') {
        done++;
        if (done === cores) {
          clearInterval(timer);
          finish(null);
        }
      }
    });
    worker.on('error', (err) => console.error('\n  worker error:', err.message));
    workers.push(worker);
  }

  process.on('SIGINT', () => {
    workers.forEach((w) => w.terminate());
    console.log('\n\n  Stopped.\n');
    process.exit(0);
  });
}

main();
