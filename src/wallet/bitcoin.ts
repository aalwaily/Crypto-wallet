import * as bitcoin from 'bitcoinjs-lib';
import { BIP32Factory, type BIP32Interface } from 'bip32';
import { ECPairFactory } from 'ecpair';
import * as ecc from '@bitcoinerlab/secp256k1';
import { mnemonicToSeed } from './mnemonic';
import { getBitcoinJsNetwork } from './networks';
import { BTC_DUST_SATS, MAX_BTC_FEE_RATE_SAT_PER_VB } from '../config';
import type { BtcNetworkId } from '../config';
import type { Utxo } from '../services/bitcoinApi';

bitcoin.initEccLib(ecc);
const bip32 = BIP32Factory(ecc);
const ECPair = ECPairFactory(ecc);

/**
 * Supported single-sig Bitcoin address types:
 *  - legacy: P2PKH   (BIP44, "1…" / "m…n…") — oldest
 *  - nested: P2SH-P2WPKH (BIP49, "3…" / "2…")
 *  - native: P2WPKH  (BIP84, "bc1…" / "tb1…") — default
 */
export type BtcAddressType = 'legacy' | 'nested' | 'native';

export const BTC_ADDRESS_TYPES: BtcAddressType[] = ['native', 'nested', 'legacy'];

const PURPOSE: Record<BtcAddressType, number> = { legacy: 44, nested: 49, native: 84 };

/** Approximate vBytes per input by type (for fee estimation). */
const INPUT_VBYTES: Record<BtcAddressType, number> = { legacy: 148, nested: 91, native: 68 };

export interface BtcAccount {
  address: string;
  publicKeyHex: string;
  derivationPath: string;
  networkId: BtcNetworkId;
  addressType: BtcAddressType;
}

export class InsufficientFundsError extends Error {
  constructor(requiredSats: number, availableSats: number) {
    super(
      `Insufficient funds: need ${requiredSats} sats (amount + fee), have ${availableSats} sats.`,
    );
    this.name = 'InsufficientFundsError';
  }
}

export function btcDerivationPath(addressType: BtcAddressType, networkId: BtcNetworkId): string {
  const coinType = networkId === 'mainnet' ? 0 : 1;
  return `m/${PURPOSE[addressType]}'/${coinType}'/0'/0/0`;
}

async function deriveBtcNode(
  mnemonic: string,
  networkId: BtcNetworkId,
  addressType: BtcAddressType,
): Promise<BIP32Interface> {
  const seed = await mnemonicToSeed(mnemonic);
  const network = getBitcoinJsNetwork(networkId);
  return bip32.fromSeed(seed, network).derivePath(btcDerivationPath(addressType, networkId));
}

function buildPayment(
  pubkey: Buffer,
  network: bitcoin.Network,
  addressType: BtcAddressType,
): bitcoin.Payment {
  if (addressType === 'legacy') return bitcoin.payments.p2pkh({ pubkey, network });
  if (addressType === 'nested') {
    return bitcoin.payments.p2sh({
      redeem: bitcoin.payments.p2wpkh({ pubkey, network }),
      network,
    });
  }
  return bitcoin.payments.p2wpkh({ pubkey, network });
}

export async function deriveBtcAccount(
  mnemonic: string,
  networkId: BtcNetworkId,
  addressType: BtcAddressType = 'native',
): Promise<BtcAccount> {
  const node = await deriveBtcNode(mnemonic, networkId, addressType);
  const network = getBitcoinJsNetwork(networkId);
  const { address } = buildPayment(node.publicKey, network, addressType);
  if (!address) throw new Error('Failed to derive Bitcoin address.');
  return {
    address,
    publicKeyHex: node.publicKey.toString('hex'),
    derivationPath: btcDerivationPath(addressType, networkId),
    networkId,
    addressType,
  };
}

/** Virtual-size estimate: ~10.5 vB overhead + per-input (by type) + ~31 vB per output. */
export function estimateVsize(
  inputCount: number,
  outputCount: number,
  addressType: BtcAddressType = 'native',
): number {
  return Math.ceil(10.5 + inputCount * INPUT_VBYTES[addressType] + outputCount * 31);
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
  addressType: BtcAddressType = 'native',
): CoinSelection {
  const sorted = [...utxos].sort((a, b) => b.value - a.value);
  const available = sorted.reduce((sum, u) => sum + u.value, 0);
  const inputs: Utxo[] = [];
  let inputTotal = 0;

  for (const utxo of sorted) {
    inputs.push(utxo);
    inputTotal += utxo.value;

    const feeWithChange = Math.ceil(estimateVsize(inputs.length, 2, addressType) * feeRateSatPerVb);
    const change = inputTotal - amountSats - feeWithChange;
    if (change >= BTC_DUST_SATS) {
      return { inputs, feeSats: feeWithChange, changeSats: change };
    }

    const feeNoChange = Math.ceil(estimateVsize(inputs.length, 1, addressType) * feeRateSatPerVb);
    const remainder = inputTotal - amountSats - feeNoChange;
    if (remainder >= 0) {
      // Sub-dust remainder is absorbed into the fee rather than creating dust.
      return { inputs, feeSats: feeNoChange + remainder, changeSats: 0 };
    }
  }

  const minFee = Math.ceil(estimateVsize(Math.max(utxos.length, 1), 1, addressType) * feeRateSatPerVb);
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
  addressType: BtcAddressType;
  utxos: Utxo[];
  toAddress: string;
  amountSats: number;
  feeRateSatPerVb: number;
  /** Required for legacy (P2PKH) inputs: returns the full raw previous tx hex. */
  fetchRawTx?: (txid: string) => Promise<string>;
}

/** Builds and signs a transaction spending from the wallet's single address (any type). */
export async function buildAndSignBtcTx(params: BuildTxParams): Promise<SignedTx> {
  const { mnemonic, networkId, addressType, utxos, toAddress, amountSats, feeRateSatPerVb } =
    params;
  const network = getBitcoinJsNetwork(networkId);
  const node = await deriveBtcNode(mnemonic, networkId, addressType);
  if (!node.privateKey) throw new Error('Derived node is missing its private key.');

  const payment = buildPayment(node.publicKey, network, addressType);
  if (!payment.output || !payment.address) throw new Error('Failed to build spending script.');

  // Defense in depth: refuse an out-of-range fee rate even if the API clamp was bypassed.
  if (feeRateSatPerVb < 1 || feeRateSatPerVb > MAX_BTC_FEE_RATE_SAT_PER_VB) {
    throw new Error(
      `Refusing to sign: fee rate ${feeRateSatPerVb} sat/vB is outside the safe range ` +
        `(1–${MAX_BTC_FEE_RATE_SAT_PER_VB}). The fee provider may be compromised.`,
    );
  }

  const selection = selectCoins(utxos, amountSats, feeRateSatPerVb, addressType);

  const psbt = new bitcoin.Psbt({ network });
  for (const utxo of selection.inputs) {
    if (addressType === 'legacy') {
      // P2PKH needs the full previous transaction (non-witness).
      if (!params.fetchRawTx) throw new Error('Legacy inputs require fetchRawTx.');
      const rawHex = await params.fetchRawTx(utxo.txid);
      psbt.addInput({
        hash: utxo.txid,
        index: utxo.vout,
        nonWitnessUtxo: Buffer.from(rawHex, 'hex'),
      });
    } else if (addressType === 'nested') {
      psbt.addInput({
        hash: utxo.txid,
        index: utxo.vout,
        witnessUtxo: { script: payment.output, value: utxo.value },
        redeemScript: payment.redeem?.output,
      });
    } else {
      psbt.addInput({
        hash: utxo.txid,
        index: utxo.vout,
        witnessUtxo: { script: payment.output, value: utxo.value },
      });
    }
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
