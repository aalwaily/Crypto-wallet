import { BIP32Factory } from 'bip32';
import * as ecc from '@bitcoinerlab/secp256k1';
import { TronWeb } from 'tronweb';
import { mnemonicToSeed } from './mnemonic';
import { getTronNetworkConfig } from './networks';
import { TRON_DERIVATION_PATH } from '../config';
import type { TronNetworkId } from '../config';

const bip32 = BIP32Factory(ecc);

export interface TronAccount {
  address: string;
  derivationPath: string;
}

/**
 * Derives the Tron private key from the shared mnemonic at m/44'/195'/0'/0/0.
 * The hex private key is returned to the caller for immediate signing only —
 * never persist it.
 */
export async function deriveTronPrivateKey(mnemonic: string): Promise<string> {
  const seed = await mnemonicToSeed(mnemonic);
  const node = bip32.fromSeed(seed).derivePath(TRON_DERIVATION_PATH);
  if (!node.privateKey) throw new Error('Derived node is missing its private key.');
  return node.privateKey.toString('hex');
}

export async function deriveTronAccount(mnemonic: string): Promise<TronAccount> {
  const privateKey = await deriveTronPrivateKey(mnemonic);
  const address = TronWeb.address.fromPrivateKey(privateKey);
  if (!address) throw new Error('Failed to derive Tron address.');
  return { address, derivationPath: TRON_DERIVATION_PATH };
}

export function createTronWeb(networkId: TronNetworkId, privateKey?: string): TronWeb {
  const config = getTronNetworkConfig(networkId);
  return new TronWeb({ fullHost: config.fullHost, privateKey });
}
