import { BTC_ADDRESS_TYPES, deriveBtcAccount, type BtcAddressType } from './bitcoin';
import { getBtcApiBaseUrl, type Settings } from './networks';
import { fetchBtcBalance } from '../services/bitcoinApi';

/**
 * Scans the standard BTC address types (native → nested → legacy) for one that
 * currently holds funds, and returns it. Lets an imported wallet from any app
 * (Trust, legacy wallets, etc.) show the right Bitcoin balance. Falls back to
 * 'native' when nothing is found or the network is unreachable.
 */
export async function detectFundedBtcType(
  mnemonic: string,
  settings: Settings,
): Promise<BtcAddressType> {
  const baseUrl = getBtcApiBaseUrl(settings);
  for (const type of BTC_ADDRESS_TYPES) {
    try {
      const account = await deriveBtcAccount(mnemonic, settings.btcNetwork, type);
      const balance = await fetchBtcBalance(baseUrl, account.address);
      if (balance.confirmedSats > 0 || balance.pendingSats !== 0) return type;
    } catch {
      // Ignore and try the next type.
    }
  }
  return 'native';
}
