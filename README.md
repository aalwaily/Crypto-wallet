# Private BTC TRC20 Wallet

A non-custodial Chrome extension wallet for **Bitcoin (testnet)** and **USDT-TRC20 on Tron (Nile/Shasta testnet)**, built with React, TypeScript, Vite, and Manifest V3.

> ## ⚠️ Security warning
>
> **This wallet has NOT been professionally audited.** It defaults to test networks. Mainnet can be enabled per-chain in Settings behind an explicit risk acknowledgement — mainnet transactions move real, irreversible funds. Treat this as a hot wallet: keep only small amounts, and use a hardware wallet for anything you care about. The `MAINNET_ENABLED` flag in `src/config.ts` can be set to `false` to remove mainnet options entirely.

## Features

- 12-word BIP39 seed phrase, generated locally — never leaves your device
- Seed encrypted at rest with **AES-256-GCM**, key derived via **PBKDF2-SHA256 (600k iterations)** using the Web Crypto API
- Bitcoin native SegWit (bech32) address at `m/84'/1'/0'/0/0` (BIP84, testnet)
- Tron address at `m/44'/195'/0'/0/0` from the same seed
- BTC send with UTXO coin selection, live fee estimates, Max button, and confirmation screen
- USDT-TRC20 send via TronWeb with TRX fee-balance check and Max button
- Unified transaction history (BTC + USDT) with explorer links and pending indicators
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
- **Tron network** — Nile or Shasta testnet. USDT contract addresses per network live in `src/config.ts` (`TRON_NETWORKS`). Verify the testnet USDT contract on tronscan before relying on it — test contracts occasionally change.
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

- **Single address per chain** (index 0). No address rotation or account discovery.
- History shows recent transactions only (BTC: latest ~25 from Esplora; USDT: latest 30 TRC20 transfers). TRX-only transfers are not listed.
- Seed backup has no verification quiz; you confirm with a checkbox only.
- JavaScript cannot reliably zero memory; decrypted secrets live in GC-managed memory while unlocked.
- `ecpair` is used for signing; the ECC backend is `@bitcoinerlab/secp256k1` (pure JS, noble-based) rather than `tiny-secp256k1`, avoiding a WASM CSP exemption in MV3. Swap in `tiny-secp256k1` if you prefer — the interface is identical.
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
