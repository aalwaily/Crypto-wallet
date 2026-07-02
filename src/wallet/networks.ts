import { networks, type Network } from 'bitcoinjs-lib';
import { z } from 'zod';
import {
  BTC_NETWORKS,
  TRON_NETWORKS,
  DEFAULT_AUTO_LOCK_MINUTES,
  MAINNET_ENABLED,
  type BtcNetworkId,
  type TronNetworkId,
} from '../config';

export const settingsSchema = z.object({
  btcNetwork: z.enum(['testnet', 'mainnet']).default('testnet'),
  tronNetwork: z.enum(['nile', 'shasta', 'mainnet']).default('nile'),
  /** Index into BTC_NETWORKS[network].apiProviders, or a custom Esplora base URL. */
  btcApiBaseUrl: z.string().url().optional(),
  autoLockMinutes: z.number().int().min(1).max(120).default(DEFAULT_AUTO_LOCK_MINUTES),
});

export type Settings = z.infer<typeof settingsSchema>;

export const DEFAULT_SETTINGS: Settings = settingsSchema.parse({});

/** Clamp any persisted settings back to testnet while mainnet is disabled. */
export function sanitizeSettings(settings: Settings): Settings {
  if (MAINNET_ENABLED) return settings;
  return {
    ...settings,
    btcNetwork: settings.btcNetwork === 'mainnet' ? 'testnet' : settings.btcNetwork,
    tronNetwork: settings.tronNetwork === 'mainnet' ? 'nile' : settings.tronNetwork,
  };
}

export function getBtcNetworkConfig(id: BtcNetworkId) {
  return BTC_NETWORKS[id];
}

export function getTronNetworkConfig(id: TronNetworkId) {
  return TRON_NETWORKS[id];
}

export function getBitcoinJsNetwork(id: BtcNetworkId): Network {
  return id === 'mainnet' ? networks.bitcoin : networks.testnet;
}

export function getBtcApiBaseUrl(settings: Settings): string {
  if (settings.btcApiBaseUrl) return settings.btcApiBaseUrl;
  const provider = BTC_NETWORKS[settings.btcNetwork].apiProviders[0];
  return provider.baseUrl;
}
