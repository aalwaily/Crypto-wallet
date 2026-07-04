# Private BTC TRC20 Wallet

A non-custodial Chrome extension wallet for **Bitcoin (testnet)** and **USDT-TRC20 on Tron (Nile/Shasta testnet)**, built with React, TypeScript, Vite, and Manifest V3.

> ## ⚠️ Security warning
>
> **This wallet has NOT been professionally audited.** It defaults to test networks. Mainnet can be enabled per-chain in Settings behind an explicit risk acknowledgement — mainnet transactions move real, irreversible funds. Treat this as a hot wallet: keep only small amounts, and use a hardware wallet for anything you care about. The `MAINNET_ENABLED` flag in `src/config.ts` can be set to `false` to remove mainnet options entirely.

## Offline terminal recovery (no internet, no browser)

Recover a wallet from the command line — 100% local, all CPU cores, zero network:

```bash
npm run recover -- "excite high ? humor entire cabbage fantasy timber erosion smooth spell ?" "bc1q…youraddress"
```

Paste your words in order and use `?` for each missing/unknown word. The second
argument is one or **many** known native-SegWit (`bc1…`/`tb1…`) addresses:

- a single address, or a comma/space separated list, or a **file path** (one address per line):

```bash
npm run recover -- "excite high ? humor entire cabbage fantasy timber erosion smooth spell ?" my-addresses.txt
```

For each guess it derives the seed once, then scans a range of receive/change
address indices (default 25 + 5, override with `RECOVER_SCAN_RECEIVE` /
`RECOVER_SCAN_CHANGE`) and checks them against your whole address set — so it
finds the wallet no matter which of your addresses is index 0. Run `npm run
recover` with no arguments for interactive prompts. For maximum safety, run it on
an offline machine — it never makes a network request. It reconstructs *your own*
wallet; it cannot guess an unknown seed (mathematically impossible).

## Features

- **Wallet recovery** (offline): two modes against a known address of yours — **Missing words** (fill blank positions from the 2048-word BIP39 list, parallelised across all CPU cores via Web Workers; 1–2 missing words = seconds/minutes) and **Wrong order** (search the order of words you have). Runs entirely on-device; words never leave the computer. **Cannot** guess an unknown seed — only reconstructs your own words (missing 1–2 is feasible; missing many is mathematically impossible by design).
- **Multiple wallets**: add any number of wallets by their seed phrase, name them, and switch between them from the dashboard — one app password unlocks them all
- **All Bitcoin address types**: imports from Trust, legacy wallets, or any BIP39 wallet work — legacy (`1…`, BIP44), nested SegWit (`3…`, BIP49), and native SegWit (`bc1…`, BIP84) are all derived; the funded type is auto-detected on import, and sending works from any type
- 12-word BIP39 seed phrase, generated locally — never leaves your device
- Seed encrypted at rest with **AES-256-GCM**, key derived via **PBKDF2-SHA256 (600k iterations)** using the Web Crypto API
- Bitcoin native SegWit (bech32) address at `m/84'/1'/0'/0/0` (BIP84, testnet)
- Tron address at `m/44'/195'/0'/0/0` from the same seed
- BTC send with UTXO coin selection, live fee estimates, Max button, and confirmation screen
- Multi-token TRC20 support: the 10 most-used Tron tokens (USDT, USDC, USDD, TUSD, JST, WIN, SUN, BTT, NFT, USDJ) on mainnet, all at your single Tron address
- Any-token send via TronWeb with TRX fee-balance check and Max button
- Unified transaction history (BTC + all TRC20 tokens) with explorer links and pending indicators
- Password unlock, auto-lock after inactivity (enforced by the background service worker), manual lock
- Password-gated seed phrase reveal in Settings
- Minimal dark fintech UI: bottom tab navigation, QR receive codes, skeleton loading, SVG icon set
- Configurable Esplora provider (mempool.space / Blockstream) and Tron network (Nile / Shasta)

## Setup

```bash
npm install
```

## Development

```bash
npm run dev        # UI preview in a browser tab (chrome.* APIs fall back to memory)
npm test           # run the Vitest suite
npm run typecheck  # TypeScript only
```

## Build & load in Chrome

```bash
npm run build
```

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** and select the `dist/` folder
4. Pin the extension and open the popup

Rebuild and click the reload icon on the extension card after any code change.

## Using the wallet

1. **Create wallet** — choose a password (min 8 chars), then write down the 12-word seed phrase shown on the backup screen. The phrase is shown only from the unlocked session; keep a paper copy.
2. **Fund with testnet coins:**
   - **Bitcoin testnet faucets:** <https://coinfaucet.eu/en/btc-testnet/>, <https://bitcoinfaucet.uo1.net/> — send to your `tb1…` address.
   - **Tron Nile faucet:** <https://nileex.io/join/getJoinPage> — grants test TRX and USDT to your `T…` address.
   - **Tron Shasta faucet:** <https://shasta.tronex.io/> — test TRX (USDT contract on Shasta may require asking in the Tron Discord).
3. **Send** — use the Send buttons on the dashboard. Every send shows a confirmation screen with the exact fee before broadcasting.

## Switching networks

Open **Settings** (⚙ on the dashboard):

- **Bitcoin API provider** — mempool.space or Blockstream (same Esplora API; pick whichever is reliable for you).
- **Tron network** — Nile or Shasta testnet. Token contract addresses per network live in `src/config.ts` (`TRON_NETWORKS` / `TRON_MAINNET_TOKENS`). Verify contracts on tronscan before relying on them — test contracts occasionally change.
- **TronGrid rate limits** — the free public TronGrid endpoint is rate-limited and can return HTTP 429 if you refresh often. Balances are fetched in a single request to minimize this, but for heavy use get a free API key at <https://www.trongrid.io> and paste it into `TRONGRID_API_KEY` in `src/config.ts`, then rebuild.
- **Auto-lock** — minutes of inactivity before the session is wiped (default 5).

- **Mainnet** — selectable per chain in Settings. Switching to mainnet requires checking a risk acknowledgement. Bitcoin mainnet uses a different derivation path (`m/84'/0'/0'/0/0`), so your mainnet BTC address differs from your testnet one; the Tron address is the same on all Tron networks. For real funds, create a **fresh wallet** whose seed has never been displayed during testing, and verify receiving with a small amount before anything larger.

## Security model

| Data | Where it lives |
| --- | --- |
| Seed phrase (encrypted) | `chrome.storage.local`, AES-256-GCM, PBKDF2 key from your password |
| Seed phrase (decrypted) | `chrome.storage.session` — RAM only, cleared on browser exit, auto-lock, or manual lock |
| Private keys | Derived on demand at signing time; never persisted |
| Password | Never stored; only used to derive the encryption key |

Nothing is ever sent to a server except: signed transaction hex (broadcast), your public addresses (balance queries). No analytics, no telemetry, no logging of secrets.

## Testing

```bash
npm test
```

Covers mnemonic generation/validation, AES-GCM encrypt/decrypt (incl. tampering), vault lifecycle, BIP84 derivation against the official BIP84 test vector, Tron derivation against a known vector, address validation, decimal/unit conversion, coin selection (incl. dust handling), P2WPKH transaction building/signing, and mocked Esplora API responses.

## Known limitations

- **Single address per chain, per wallet** (index 0). No address rotation or gap-limit account discovery — an imported wallet's balance shows only if its funds are at the first address of a standard type. Auto-detection picks the address type (legacy/nested/native) that currently holds a balance.
- MetaMask seeds work but show only BTC/Tron — MetaMask holds Ethereum assets, which this wallet does not support.
- History shows recent transactions only (BTC: latest ~25 from Esplora; USDT: latest 30 TRC20 transfers). TRX-only transfers are not listed.
- Seed backup has no verification quiz; you confirm with a checkbox only.
- JavaScript cannot reliably zero memory; decrypted secrets live in GC-managed memory while unlocked.
- `ecpair` is used for signing; the ECC backend is `@bitcoinerlab/secp256k1` (pure JS, noble-based) rather than `tiny-secp256k1`, avoiding a WASM CSP exemption in MV3. Swap in `tiny-secp256k1` if you prefer — the interface is identical.
- **Token contract addresses** for the 10 mainnet tokens in `src/config.ts` (`TRON_MAINNET_TOKENS`) are provided for convenience and **must be verified on [tronscan.org](https://tronscan.org)** before real-fund use — scam tokens imitate popular names; only the contract address is authoritative. Edit that list to add/remove tokens.
- Testnet USDT contracts are community-deployed and may differ from what your faucet dispenses; adjust `src/config.ts` if balances don't appear.
- Fee estimation on Bitcoin testnet is often flat (1 sat/vB); the tiers matter more on mainnet.
- RBF (replace-by-fee) and custom change addresses are not implemented.

## Project structure

```
src/
  background/serviceWorker.ts   auto-lock enforcement (MV3 service worker)
  popup/                        React UI (screens, routes, components, state)
  wallet/                       vault, encryption, mnemonic, BTC/Tron derivation & signing
  services/                     Esplora + TronGrid API clients
  tests/                        Vitest suites
  config.ts                     networks, endpoints, contracts, safety flags
public/manifest.json            Manifest V3
```
