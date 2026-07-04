/// <reference lib="webworker" />
/**
 * Recovery worker — runs one shard of the missing-word search off the main
 * thread. Spawning one per CPU core parallelises the search. Everything stays
 * on-device; only the (public) candidate address is computed here.
 */
import { Buffer } from 'buffer';
// bip39/bitcoinjs expect a global Buffer, which isn't present in workers by default.
if (!(globalThis as unknown as { Buffer?: unknown }).Buffer) {
  (globalThis as unknown as { Buffer: unknown }).Buffer = Buffer;
}
import { wordlists } from 'bip39';
import { deriveAddress, missingWordCandidatesShard } from './search';
import { checksumValid, decodeNativeProgram, nativeMatches } from './fastDerive';
import type { BtcNetworkId } from '../config';
import type { BtcAddressType } from '../wallet/bitcoin';

const ENGLISH = wordlists.english as string[];

interface StartMsg {
  template: (string | null)[];
  target: string;
  network: BtcNetworkId;
  addressType: BtcAddressType;
  shardIndex: number;
  shardCount: number;
}

self.onmessage = (e: MessageEvent<StartMsg>) => {
  const { template, target, network, addressType, shardIndex, shardCount } = e.data;
  const wanted = target.trim();
  let checked = 0;
  let valid = 0;
  let last = Date.now();

  // Fast path for native SegWit (bc1/tb1): cheap checksum reject + byte compare.
  const targetProgram = addressType === 'native' ? decodeNativeProgram(wanted) : null;
  const useFast = addressType === 'native' && targetProgram !== null;

  const report = (): boolean => {
    if ((checked & 4095) === 0) {
      const now = Date.now();
      if (now - last > 200) {
        self.postMessage({ type: 'progress', checked, valid });
        last = now;
      }
    }
    return false;
  };

  for (const candidate of missingWordCandidatesShard(template, ENGLISH, shardIndex, shardCount)) {
    checked++;
    if (useFast) {
      if (checksumValid(candidate)) {
        valid++;
        if (nativeMatches(candidate, network, targetProgram!)) {
          self.postMessage({ type: 'found', candidate, checked, valid });
          return;
        }
      }
    } else {
      const address = deriveAddress(candidate, network, addressType);
      if (address) {
        valid++;
        if (address === wanted) {
          self.postMessage({ type: 'found', candidate, checked, valid });
          return;
        }
      }
    }
    report();
  }
  self.postMessage({ type: 'done', checked, valid });
};
