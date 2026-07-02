import { describe, expect, it } from 'vitest';
import { generateMnemonic, normalizeMnemonic, validateMnemonic } from '../wallet/mnemonic';

describe('mnemonic', () => {
  it('generates a valid 12-word phrase', () => {
    const mnemonic = generateMnemonic();
    expect(mnemonic.split(' ')).toHaveLength(12);
    expect(validateMnemonic(mnemonic)).toBe(true);
  });

  it('generates unique phrases', () => {
    expect(generateMnemonic()).not.toBe(generateMnemonic());
  });

  it('validates a known good phrase', () => {
    expect(
      validateMnemonic(
        'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
      ),
    ).toBe(true);
  });

  it('rejects a phrase with a bad checksum', () => {
    expect(
      validateMnemonic(
        'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon',
      ),
    ).toBe(false);
  });

  it('rejects non-wordlist words and wrong lengths', () => {
    expect(validateMnemonic('not a real mnemonic at all')).toBe(false);
    expect(validateMnemonic('abandon abandon')).toBe(false);
    expect(validateMnemonic('')).toBe(false);
  });

  it('normalizes case and whitespace', () => {
    const messy = '  ABANDON  abandon\tabandon abandon abandon abandon abandon abandon abandon abandon abandon ABOUT ';
    expect(normalizeMnemonic(messy)).toBe(
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
    );
    expect(validateMnemonic(messy)).toBe(true);
  });
});
