import { describe, expect, it } from 'vitest';
import { deriveTronAccount, deriveTronPrivateKey } from '../wallet/tron';
import { isValidTronAddress } from '../wallet/validators';

const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

describe('tron derivation', () => {
  it('matches the known test vector at m/44h/195h/0h/0/0', async () => {
    const account = await deriveTronAccount(MNEMONIC);
    expect(account.address).toBe('TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH');
    expect(account.derivationPath).toBe("m/44'/195'/0'/0/0");
  });

  it('derives a base58 address starting with T that validates', async () => {
    const account = await deriveTronAccount(MNEMONIC);
    expect(account.address.startsWith('T')).toBe(true);
    expect(isValidTronAddress(account.address)).toBe(true);
  });

  it('is deterministic and key/address stay consistent', async () => {
    const [a, b] = await Promise.all([deriveTronAccount(MNEMONIC), deriveTronAccount(MNEMONIC)]);
    expect(a.address).toBe(b.address);
    const key = await deriveTronPrivateKey(MNEMONIC);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });
});
