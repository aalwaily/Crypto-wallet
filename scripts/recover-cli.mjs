#!/usr/bin/env node
/**
 * Offline word-order / missing-word recovery — terminal edition.
 *
 * 100% local, no internet. Reconstructs YOUR OWN wallet from words you provide,
 * matching a known native-SegWit (bc1…/tb1…) address. Uses one Node worker per
 * CPU core. It cannot guess an unknown seed — that is mathematically impossible.
 *
 *   node scripts/recover-cli.mjs
 *
 * At the prompt, paste your 12 (or 24) words in order and use "?" for each
 * missing/unknown word. Example:
 *   excite high ? humor entire cabbage fantasy timber erosion smooth spell ?
 */
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import os from 'node:os';
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

function decodeNativeProgram(address) {
  try {
    const d = bech32.decode(address.trim());
    if (d.words[0] !== 0) return null;
    const program = bech32.fromWords(d.words.slice(1));
    return program.length === 20 ? Uint8Array.from(program) : null;
  } catch {
    return null;
  }
}

function nativeMatches(words, network, target) {
  const seed = pbkdf2(sha512, enc.encode(words.join(' ').normalize('NFKD')), SALT, {
    c: 2048,
    dkLen: 64,
  });
  const path = network === 'mainnet' ? "m/84'/0'/0'/0/0" : "m/84'/1'/0'/0/0";
  const child = HDKey.fromMasterSeed(seed).derive(path);
  if (!child.publicKey) return false;
  const h = ripemd160(sha256(child.publicKey));
  for (let i = 0; i < 20; i++) if (h[i] !== target[i]) return false;
  return true;
}

function* shardCandidates(template, shardIndex, shardCount) {
  const unknown = [];
  template.forEach((w, i) => {
    if (!w) unknown.push(i);
  });
  const k = unknown.length;
  const base = WORDS.length;
  const candidate = template.slice();
  if (k === 0) {
    if (shardIndex === 0) yield candidate.slice();
    return;
  }
  const per = Math.ceil(base / shardCount);
  const lo = shardIndex * per;
  const hi = Math.min(base, lo + per);
  const rest = unknown.slice(1);
  const digits = new Array(rest.length).fill(0);
  for (let first = lo; first < hi; first++) {
    candidate[unknown[0]] = WORDS[first];
    digits.fill(0);
    for (;;) {
      for (let j = 0; j < rest.length; j++) candidate[rest[j]] = WORDS[digits[j]];
      yield candidate.slice();
      let p = rest.length - 1;
      while (p >= 0) {
        digits[p]++;
        if (digits[p] < base) break;
        digits[p] = 0;
        p--;
      }
      if (p < 0) break;
    }
  }
}

// ---- worker ----

if (!isMainThread) {
  const { template, targetArr, network, shardIndex, shardCount } = workerData;
  const target = Uint8Array.from(targetArr);
  let checked = 0;
  let valid = 0;
  let last = Date.now();
  for (const cand of shardCandidates(template, shardIndex, shardCount)) {
    checked++;
    if (checksumValid(cand)) {
      valid++;
      if (nativeMatches(cand, network, target)) {
        parentPort.postMessage({ type: 'found', candidate: cand, checked, valid });
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
  return `${h}h ${m % 60}m`;
}

async function readInputs() {
  // Non-interactive: node recover-cli.mjs "<words with ? for blanks>" "<address>"
  if (process.argv[2] && process.argv[3]) {
    return { wordsLine: process.argv[2].trim().toLowerCase(), address: process.argv[3].trim() };
  }
  const readline = await import('node:readline/promises');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log('\n  Offline wallet recovery (no internet) — bc1/tb1 addresses\n');
  console.log('  Paste your words IN ORDER. Use ? for each missing/unknown word.');
  console.log('  Example: excite high ? humor entire cabbage fantasy timber erosion smooth spell ?\n');
  const wordsLine = (await rl.question('  Words: ')).trim().toLowerCase();
  const address = (await rl.question('  Your address (bc1…): ')).trim();
  rl.close();
  return { wordsLine, address };
}

async function main() {
  const { wordsLine, address } = await readInputs();

  const raw = wordsLine.split(/\s+/).filter(Boolean);
  if (![12, 15, 18, 21, 24].includes(raw.length)) {
    console.error(`\n  ✗ Expected 12–24 words, got ${raw.length}.`);
    process.exit(1);
  }
  const template = raw.map((w) => (w === '?' || w === '_' ? null : w));
  const badWord = template.find((w) => w && !WORD_INDEX.has(w));
  if (badWord) {
    console.error(`\n  ✗ "${badWord}" is not a valid BIP39 word.`);
    process.exit(1);
  }
  const network = address.startsWith('bc1') ? 'mainnet' : address.startsWith('tb1') ? 'testnet' : null;
  const program = network ? decodeNativeProgram(address) : null;
  if (!program) {
    console.error('\n  ✗ This tool supports native-SegWit addresses only (bc1… / tb1…).');
    process.exit(1);
  }

  const unknownCount = template.filter((w) => !w).length;
  const total = 2048 ** unknownCount;
  if (unknownCount === 0) {
    console.error('\n  ✗ Nothing to search — leave at least one word as ?.');
    process.exit(1);
  }

  const cores = Math.max(1, Math.min(os.cpus().length, 32));
  console.log(
    `\n  ${unknownCount} unknown word(s) · ${total.toLocaleString()} combinations · ${cores} CPU cores\n`,
  );

  const targetArr = Array.from(program);
  const checkedArr = new Array(cores).fill(0);
  const validArr = new Array(cores).fill(0);
  const workers = [];
  const t0 = Date.now();
  let done = 0;
  let finished = false;
  const self = fileURLToPath(import.meta.url);

  const render = () => {
    const checked = checkedArr.reduce((a, b) => a + b, 0);
    const valid = validArr.reduce((a, b) => a + b, 0);
    const elapsed = Date.now() - t0;
    const rate = elapsed > 0 ? checked / (elapsed / 1000) : 0;
    const eta = rate > 0 ? ((total - checked) / rate) * 1000 : Infinity;
    const pct = total > 0 ? Math.min(100, (checked / total) * 100).toFixed(2) : '0';
    process.stdout.write(
      `\r  ${pct}%  ${checked.toLocaleString()}/${total.toLocaleString()}  ` +
        `${Math.round(rate).toLocaleString()}/s  valid ${valid.toLocaleString()}  ETA ${fmtDuration(eta)}   `,
    );
  };

  const finish = (candidate) => {
    if (finished) return;
    finished = true;
    workers.forEach((w) => w.terminate());
    render();
    if (candidate) {
      console.log('\n\n  ✓ FOUND YOUR WALLET ORDER:\n');
      candidate.forEach((w, i) => console.log(`     ${String(i + 1).padStart(2)}. ${w}`));
      console.log(`\n  Phrase: ${candidate.join(' ')}\n`);
      console.log('  Write these words on paper in this exact order. Import them in the extension.\n');
    } else {
      console.log('\n\n  ✗ No combination produced that address.');
      console.log('  Double-check the words and address, or you may be missing too many words.\n');
    }
    process.exit(0);
  };

  const timer = setInterval(render, 300);

  for (let i = 0; i < cores; i++) {
    const worker = new Worker(self, {
      workerData: { template, targetArr, network, shardIndex: i, shardCount: cores },
    });
    worker.on('message', (m) => {
      checkedArr[i] = m.checked;
      validArr[i] = m.valid;
      if (m.type === 'found') {
        clearInterval(timer);
        finish(m.candidate);
      } else if (m.type === 'done') {
        done++;
        if (done === cores) {
          clearInterval(timer);
          finish(null);
        }
      }
    });
    worker.on('error', (err) => {
      console.error('\n  worker error:', err.message);
    });
    workers.push(worker);
  }

  process.on('SIGINT', () => {
    workers.forEach((w) => w.terminate());
    console.log('\n\n  Stopped.\n');
    process.exit(0);
  });
}

main();
