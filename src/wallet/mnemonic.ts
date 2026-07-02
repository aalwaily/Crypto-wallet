import * as bip39 from 'bip39';

/** Generates a 12-word BIP39 mnemonic (128 bits of entropy). */
export function generateMnemonic(): string {
  return bip39.generateMnemonic(128);
}

/** Lowercases and collapses whitespace so user-pasted phrases validate reliably. */
export function normalizeMnemonic(input: string): string {
  return input.trim().toLowerCase().split(/\s+/).join(' ');
}

export function validateMnemonic(mnemonic: string): boolean {
  return bip39.validateMnemonic(normalizeMnemonic(mnemonic));
}

export async function mnemonicToSeed(mnemonic: string): Promise<Buffer> {
  return bip39.mnemonicToSeed(normalizeMnemonic(mnemonic));
}
