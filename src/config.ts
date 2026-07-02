/**
 * Central configuration. No secrets belong in this file — only public
 * endpoints, contract addresses, and safety limits.
 */

/**
 * SAFETY FLAG — enables mainnet network options in Settings.
 * The UI still defaults to testnet and requires an explicit, acknowledged
 * switch. This codebase has NOT been professionally audited: mainnet use is
 * at the owner's risk, with small amounts only.
 */
export const MAINNET_ENABLED = true;

export const BTC_NETWORKS = {
  testnet: {
    label: 'Bitcoin Testnet',
    derivationPath: "m/84'/1'/0'/0/0",
    // Esplora-compatible providers (mempool.space and Blockstream share the API shape).
    apiProviders: [
      { name: 'mempool.space', baseUrl: 'https://mempool.space/testnet/api' },
      { name: 'Blockstream', baseUrl: 'https://blockstream.info/testnet/api' },
    ],
    explorerTxUrl: (txid: string) => `https://mempool.space/testnet/tx/${txid}`,
  },
  mainnet: {
    label: 'Bitcoin Mainnet',
    derivationPath: "m/84'/0'/0'/0/0",
    apiProviders: [
      { name: 'mempool.space', baseUrl: 'https://mempool.space/api' },
      { name: 'Blockstream', baseUrl: 'https://blockstream.info/api' },
    ],
    explorerTxUrl: (txid: string) => `https://mempool.space/tx/${txid}`,
  },
} as const;

export type BtcNetworkId = keyof typeof BTC_NETWORKS;

/**
 * A TRC20 token. All TRC20 tokens live at the *same* Tron address; a token is
 * fully described by its contract address and decimals.
 *
 * ⚠️ MAINNET CONTRACT ADDRESSES BELOW ARE PROVIDED FOR CONVENIENCE AND MUST BE
 * VERIFIED ON https://tronscan.org BEFORE USE WITH REAL FUNDS. Scam tokens
 * imitate popular names; only the contract address is authoritative.
 */
export interface Trc20Token {
  symbol: string;
  name: string;
  contract: string;
  decimals: number;
  /** CSS color for the token's badge. */
  color: string;
}

/** The 10 most widely used TRC20 tokens on Tron mainnet. Verify each on tronscan. */
export const TRON_MAINNET_TOKENS: Trc20Token[] = [
  { symbol: 'USDT', name: 'Tether USD', contract: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', decimals: 6, color: '#26a17b' },
  { symbol: 'USDC', name: 'USD Coin', contract: 'TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8', decimals: 6, color: '#2775ca' },
  { symbol: 'USDD', name: 'Decentralized USD', contract: 'TPYmHEhy5n8TCEfYGqW2rPxsghSfzghPDn', decimals: 18, color: '#1c8a4d' },
  { symbol: 'TUSD', name: 'TrueUSD', contract: 'TUpMhErZL2fhh4sVNULAbNKLokS4GjC1F4', decimals: 18, color: '#1f5eff' },
  { symbol: 'JST', name: 'JUST', contract: 'TCFLL5dx5ZJdKnWuesXxi1VPwjLVmWZZy9', decimals: 18, color: '#7b3fe4' },
  { symbol: 'WIN', name: 'WINkLink', contract: 'TLa2f6VPqDgRE67v1736s7bJ8Ray5wYjU7', decimals: 6, color: '#c99400' },
  { symbol: 'SUN', name: 'SUN', contract: 'TSSMHYeV2uE9qYH95DqyoCuNCzEL1NvU3S', decimals: 18, color: '#e07b00' },
  { symbol: 'BTT', name: 'BitTorrent', contract: 'TAFjULxiVgT4qWk6UZwjqwZXTSaGaqnVp4', decimals: 18, color: '#3a3f4b' },
  { symbol: 'NFT', name: 'APENFT', contract: 'TFczxzPhnThNSqr5by8tvxsdCFRRz6cPNq', decimals: 6, color: '#e6007a' },
  { symbol: 'USDJ', name: 'JUST Stablecoin', contract: 'TMwFHYXLJaRUPeW6421aqXL4ZEzPRFGkGT', decimals: 18, color: '#089b96' },
];

export const TRON_NETWORKS = {
  nile: {
    label: 'Tron Nile Testnet',
    fullHost: 'https://nile.trongrid.io',
    explorerTxUrl: (txid: string) => `https://nile.tronscan.org/#/transaction/${txid}`,
    // Well-known Nile test USDT. Verify on nile.tronscan.org — testnet contracts change.
    tokens: [
      { symbol: 'USDT', name: 'Tether USD (test)', contract: 'TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf', decimals: 6, color: '#26a17b' },
    ] as Trc20Token[],
  },
  shasta: {
    label: 'Tron Shasta Testnet',
    fullHost: 'https://api.shasta.trongrid.io',
    explorerTxUrl: (txid: string) => `https://shasta.tronscan.org/#/transaction/${txid}`,
    tokens: [
      { symbol: 'USDT', name: 'Tether USD (test)', contract: 'TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs', decimals: 6, color: '#26a17b' },
    ] as Trc20Token[],
  },
  mainnet: {
    label: 'Tron Mainnet',
    fullHost: 'https://api.trongrid.io',
    explorerTxUrl: (txid: string) => `https://tronscan.org/#/transaction/${txid}`,
    tokens: TRON_MAINNET_TOKENS,
  },
} as const;

export type TronNetworkId = keyof typeof TRON_NETWORKS;

export const TRON_DERIVATION_PATH = "m/44'/195'/0'/0/0";

/** Minimal TRC20 ABI — enough for balanceOf/transfer without an on-chain ABI fetch. */
export const TRC20_ABI = [
  {
    constant: true,
    inputs: [{ name: 'who', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    constant: false,
    inputs: [
      { name: '_to', type: 'address' },
      { name: '_value', type: 'uint256' },
    ],
    name: 'transfer',
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;

/** Upper bound (in SUN, 1 TRX = 1e6 SUN) a TRC20 transfer may burn for energy/bandwidth. */
export const TRC20_FEE_LIMIT_SUN = 50_000_000; // 50 TRX

/** Minimum TRX balance (in SUN) required before we allow a USDT send. */
export const MIN_TRX_FOR_FEES_SUN = 30_000_000; // 30 TRX

/** Outputs below this value (sats) are treated as dust for P2WPKH. */
export const BTC_DUST_SATS = 294;

/**
 * Hard ceiling on the Bitcoin fee rate we will accept from a fee-estimate API.
 * Even congested mainnet rarely exceeds a few hundred sat/vB; anything above
 * this is treated as a hostile or broken provider response and rejected.
 */
export const MAX_BTC_FEE_RATE_SAT_PER_VB = 2_000;

/** PBKDF2 iteration count for the vault key (OWASP 2023 recommendation for SHA-256). */
export const PBKDF2_ITERATIONS = 600_000;

export const DEFAULT_AUTO_LOCK_MINUTES = 5;
export const MIN_PASSWORD_LENGTH = 8;
