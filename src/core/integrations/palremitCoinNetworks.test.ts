import { describe, it, expect } from 'vitest';
import {
  palremitNetworkOptionsFromCoinData,
  resolvePalremitNetworkFromOptions,
} from '@/core/integrations/palremitCoinNetworks';

describe('palremitCoinNetworks', () => {
  it('parses network_list from Palremit get_coin shape', () => {
    const data = {
      coin_code: 'USDT',
      network_list: [
        { network_code: 'TRX', network_name: 'Tron (TRC20)', deposit_enabled: true },
        { network_code: 'BSC', network_name: 'BNB Smart Chain (BEP20)', withdraw_enabled: true },
      ],
    };
    const opts = palremitNetworkOptionsFromCoinData(data);
    expect(opts.map((o) => o.code)).toEqual(['TRX', 'BSC']);
    expect(resolvePalremitNetworkFromOptions(opts, 'bsc')).toBe('BSC');
    expect(resolvePalremitNetworkFromOptions(opts, 'BINANCE_SMART_CHAIN')).toBeNull();
  });
});
