import * as bitcoin from 'bitcoinjs-lib';
import { BIP32Factory, type BIP32Interface } from 'bip32';
import { ECPairFactory } from 'ecpair';
import * as ecc from '@bitcoinerlab/secp256k1';
import { mnemonicToSeed } from './mnemonic';
import { getBitcoinJsNetwork, getBtcNetworkConfig } from './networks';
import { BTC_DUST_SATS, MAX_BTC_FEE_RATE_SAT_PER_VB } from '../config';
import type { BtcNetworkId } from '../config';
import type { Utxo } from '../services/bitcoinApi';

bitcoin.initEccLib(ecc);
const bip32 = BIP32Factory(ecc);
const ECPair = ECPairFactory(ecc);

export interface BtcAccount {
  address: string;
  publicKeyHex: string;
  derivationPath: string;
  networkId: BtcNetworkId;
}

export class InsufficientFundsError extends Error {
  constructor(requiredSats: number, availableSats: number) {
    super(
      `Insufficient funds: need ${requiredSats} sats (amount + fee), have ${availableSats} sats.`,
    );
    this.name = 'InsufficientFundsError';
  }
}

async function deriveBtcNode(mnemonic: string, networkId: BtcNetworkId): Promise<BIP32Interface> {
  const seed = await mnemonicToSeed(mnemonic);
  const network = getBitcoinJsNetwork(networkId);
  const root = bip32.fromSeed(seed, network);
  return root.derivePath(getBtcNetworkConfig(networkId).derivationPath);
}

export async function deriveBtcAccount(
  mnemonic: string,
  networkId: BtcNetworkId,
): Promise<BtcAccount> {
  const node = await deriveBtcNode(mnemonic, networkId);
  const network = getBitcoinJsNetwork(networkId);
  const { address } = bitcoin.payments.p2wpkh({ pubkey: node.publicKey, network });
  if (!address) throw new Error('Failed to derive Bitcoin address.');
  return {
    address,
    publicKeyHex: node.publicKey.toString('hex'),
    derivationPath: getBtcNetworkConfig(networkId).derivationPath,
    networkId,
  };
}

/**
 * Virtual-size estimate for a P2WPKH tx: ~10.5 vB overhead, ~68 vB per input,
 * ~31 vB per output.
 */
export function estimateVsize(inputCount: number, outputCount: number): number {
  return Math.ceil(10.5 + inputCount * 68 + outputCount * 31);
}

export interface CoinSelection {
  inputs: Utxo[];
  feeSats: number;
  changeSats: number;
}

/**
 * Largest-first accumulation. Recomputes the fee as inputs are added; drops
 * the change output into the fee when it would be dust.
 */
export function selectCoins(
  utxos: Utxo[],
  amountSats: number,
  feeRateSatPerVb: number,
): CoinSelection {
  const sorted = [...utxos].sort((a, b) => b.value - a.value);
  const available = sorted.reduce((sum, u) => sum + u.value, 0);
  const inputs: Utxo[] = [];
  let inputTotal = 0;

  for (const utxo of sorted) {
    inputs.push(utxo);
    inputTotal += utxo.value;

    const feeWithChange = Math.ceil(estimateVsize(inputs.length, 2) * feeRateSatPerVb);
    const change = inputTotal - amountSats - feeWithChange;
    if (change >= BTC_DUST_SATS) {
      return { inputs, feeSats: feeWithChange, changeSats: change };
    }

    const feeNoChange = Math.ceil(estimateVsize(inputs.length, 1) * feeRateSatPerVb);
    const remainder = inputTotal - amountSats - feeNoChange;
    if (remainder >= 0) {
      // Sub-dust remainder is absorbed into the fee rather than creating dust.
      return { inputs, feeSats: feeNoChange + remainder, changeSats: 0 };
    }
  }

  const minFee = Math.ceil(estimateVsize(Math.max(utxos.length, 1), 1) * feeRateSatPerVb);
  throw new InsufficientFundsError(amountSats + minFee, available);
}

export interface SignedTx {
  hex: string;
  txid: string;
  feeSats: number;
  vsize: number;
}

export interface BuildTxParams {
  mnemonic: string;
  networkId: BtcNetworkId;
  utxos: Utxo[];
  toAddress: string;
  amountSats: number;
  feeRateSatPerVb: number;
}

/** Builds and signs a P2WPKH transaction spending from the wallet's single address. */
export async function buildAndSignBtcTx(params: BuildTxParams): Promise<SignedTx> {
  const { mnemonic, networkId, utxos, toAddress, amountSats, feeRateSatPerVb } = params;
  const network = getBitcoinJsNetwork(networkId);
  const node = await deriveBtcNode(mnemonic, networkId);
  if (!node.privateKey) throw new Error('Derived node is missing its private key.');

  const payment = bitcoin.payments.p2wpkh({ pubkey: node.publicKey, network });
  if (!payment.output || !payment.address) throw new Error('Failed to build P2WPKH script.');

  // Defense in depth: refuse an out-of-range fee rate even if the API clamp was bypassed.
  if (feeRateSatPerVb < 1 || feeRateSatPerVb > MAX_BTC_FEE_RATE_SAT_PER_VB) {
    throw new Error(
      `Refusing to sign: fee rate ${feeRateSatPerVb} sat/vB is outside the safe range ` +
        `(1–${MAX_BTC_FEE_RATE_SAT_PER_VB}). The fee provider may be compromised.`,
    );
  }

  const selection = selectCoins(utxos, amountSats, feeRateSatPerVb);

  const psbt = new bitcoin.Psbt({ network });
  for (const utxo of selection.inputs) {
    psbt.addInput({
      hash: utxo.txid,
      index: utxo.vout,
      witnessUtxo: { script: payment.output, value: utxo.value },
    });
  }
  psbt.addOutput({ address: toAddress, value: amountSats });
  if (selection.changeSats > 0) {
    psbt.addOutput({ address: payment.address, value: selection.changeSats });
  }

  const signer = ECPair.fromPrivateKey(node.privateKey, { network });
  psbt.signAllInputs(signer);
  psbt.validateSignaturesOfAllInputs((pubkey, msghash, signature) =>
    ecc.verify(msghash, pubkey, signature),
  );
  psbt.finalizeAllInputs();

  const tx = psbt.extractTransaction();
  return {
    hex: tx.toHex(),
    txid: tx.getId(),
    feeSats: selection.feeSats,
    vsize: tx.virtualSize(),
  };
}
