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

export const TRON_NETWORKS = {
  nile: {
    label: 'Tron Nile Testnet',
    fullHost: 'https://nile.trongrid.io',
    // Well-known Nile test USDT contract. Verify on nile.tronscan.org before relying on it —
    // testnet contracts occasionally change.
    usdtContract: 'TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf',
    explorerTxUrl: (txid: string) => `https://nile.tronscan.org/#/transaction/${txid}`,
  },
  shasta: {
    label: 'Tron Shasta Testnet',
    fullHost: 'https://api.shasta.trongrid.io',
    // Commonly referenced Shasta test USDT. Verify on shasta.tronscan.org before relying on it.
    usdtContract: 'TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs',
    explorerTxUrl: (txid: string) => `https://shasta.tronscan.org/#/transaction/${txid}`,
  },
  mainnet: {
    label: 'Tron Mainnet',
    fullHost: 'https://api.trongrid.io',
    usdtContract: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
    explorerTxUrl: (txid: string) => `https://tronscan.org/#/transaction/${txid}`,
  },
} as const;

export type TronNetworkId = keyof typeof TRON_NETWORKS;

export const TRON_DERIVATION_PATH = "m/44'/195'/0'/0/0";

/** USDT uses 6 decimal places on Tron. */
export const USDT_DECIMALS = 6;

/** Upper bound (in SUN, 1 TRX = 1e6 SUN) a TRC20 transfer may burn for energy/bandwidth. */
export const TRC20_FEE_LIMIT_SUN = 50_000_000; // 50 TRX

/** Minimum TRX balance (in SUN) required before we allow a USDT send. */
export const MIN_TRX_FOR_FEES_SUN = 30_000_000; // 30 TRX

/** Outputs below this value (sats) are treated as dust for P2WPKH. */
export const BTC_DUST_SATS = 294;

/** PBKDF2 iteration count for the vault key (OWASP 2023 recommendation for SHA-256). */
export const PBKDF2_ITERATIONS = 600_000;

export const DEFAULT_AUTO_LOCK_MINUTES = 5;
export const MIN_PASSWORD_LENGTH = 8;
