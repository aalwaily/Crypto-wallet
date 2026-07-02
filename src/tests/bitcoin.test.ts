import { describe, expect, it } from 'vitest';
import { Transaction } from 'bitcoinjs-lib';
import {
  buildAndSignBtcTx,
  deriveBtcAccount,
  estimateVsize,
  InsufficientFundsError,
  selectCoins,
} from '../wallet/bitcoin';
import type { Utxo } from '../services/bitcoinApi';

const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

const fakeUtxo = (value: number, index = 0): Utxo => ({
  txid: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  vout: index,
  value,
  status: { confirmed: true },
});

describe('bitcoin derivation', () => {
  it('matches the official BIP84 mainnet test vector', async () => {
    const account = await deriveBtcAccount(MNEMONIC, 'mainnet');
    expect(account.address).toBe('bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu');
    expect(account.derivationPath).toBe("m/84'/0'/0'/0/0");
  });

  it('derives a bech32 testnet address at m/84h/1h/0h/0/0', async () => {
    const account = await deriveBtcAccount(MNEMONIC, 'testnet');
    expect(account.address).toBe('tb1q6rz28mcfaxtmd6v789l9rrlrusdprr9pqcpvkl');
    expect(account.address.startsWith('tb1')).toBe(true);
    expect(account.derivationPath).toBe("m/84'/1'/0'/0/0");
  });

  it('is deterministic', async () => {
    const a = await deriveBtcAccount(MNEMONIC, 'testnet');
    const b = await deriveBtcAccount(MNEMONIC, 'testnet');
    expect(a.address).toBe(b.address);
  });
});

describe('coin selection', () => {
  it('selects inputs and computes change', () => {
    const selection = selectCoins([fakeUtxo(100_000)], 50_000, 2);
    expect(selection.inputs).toHaveLength(1);
    const expectedFee = Math.ceil(estimateVsize(1, 2) * 2);
    expect(selection.feeSats).toBe(expectedFee);
    expect(selection.changeSats).toBe(100_000 - 50_000 - expectedFee);
  });

  it('absorbs sub-dust change into the fee', () => {
    const selection = selectCoins([fakeUtxo(10_000)], 9_800, 1);
    expect(selection.changeSats).toBe(0);
    expect(selection.feeSats).toBe(200); // 10000 - 9800, all remainder to fee
  });

  it('throws InsufficientFundsError when funds cannot cover amount + fee', () => {
    expect(() => selectCoins([fakeUtxo(1_000)], 5_000, 2)).toThrow(InsufficientFundsError);
    expect(() => selectCoins([], 5_000, 2)).toThrow(InsufficientFundsError);
  });
});

describe('transaction building (testnet)', () => {
  it('builds and signs a valid P2WPKH transaction with change', async () => {
    const signed = await buildAndSignBtcTx({
      mnemonic: MNEMONIC,
      networkId: 'testnet',
      utxos: [fakeUtxo(100_000)],
      toAddress: 'tb1q6rz28mcfaxtmd6v789l9rrlrusdprr9pqcpvkl',
      amountSats: 50_000,
      feeRateSatPerVb: 2,
    });

    const tx = Transaction.fromHex(signed.hex);
    expect(tx.getId()).toBe(signed.txid);
    expect(tx.ins).toHaveLength(1);
    expect(tx.outs).toHaveLength(2); // recipient + change
    expect(tx.outs[0]!.value).toBe(50_000);
    const totalOut = tx.outs.reduce((sum, o) => sum + o.value, 0);
    expect(100_000 - totalOut).toBe(signed.feeSats);
    // Witness present on the input proves it is a signed SegWit spend.
    expect(tx.ins[0]!.witness.length).toBe(2);
  });

  it('propagates insufficient funds as a typed error', async () => {
    await expect(
      buildAndSignBtcTx({
        mnemonic: MNEMONIC,
        networkId: 'testnet',
        utxos: [fakeUtxo(1_000)],
        toAddress: 'tb1q6rz28mcfaxtmd6v789l9rrlrusdprr9pqcpvkl',
        amountSats: 50_000,
        feeRateSatPerVb: 2,
      }),
    ).rejects.toThrow(InsufficientFundsError);
  });
});
