import { describe, it, expect } from 'vitest';
import {
  palremitNetworkOptionsFromCoinData,
  palremitNetworkOptionsFromCoinNetworkList,
  resolvePalremitNetworkFromOptions,
  resolvePalremitNetworkOrThrow,
  isOfframpDepositNetworkDelisted,
} from '@/core/integrations/palremitCoinNetworks';
import type { PalremitLiquidityRequestFn } from '@/core/integrations/palremitLiquidity';

describe('palremitCoinNetworks', () => {
  it('parses network_list from Palremit get_coin shape (network_code)', () => {
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

  it('parses get_coin network_list when only network_name is the chain id (Orchestrator doc shape)', () => {
    const data = {
      coin_code: 'BTC',
      network_list: [
        {
          network_name: 'BITCOIN',
          network_display_name: 'Bitcoin',
          withdraw_enabled: true,
          deposit_enabled: true,
        },
      ],
    };
    const opts = palremitNetworkOptionsFromCoinData(data);
    expect(opts.map((o) => o.code)).toEqual(['BITCOIN']);
    expect(opts[0]?.name).toBe('Bitcoin');
  });

  it('parses get_coin_network_list array (network_code)', () => {
    const rows = [
      {
        network_code: 'TRC20',
        network_name: 'Tron (TRC20)',
        deposit_enabled: true,
        withdraw_enabled: true,
      },
      {
        network_code: 'ERC20',
        network_name: 'Ethereum (ERC20)',
        deposit_enabled: true,
        withdraw_enabled: true,
      },
    ];
    const opts = palremitNetworkOptionsFromCoinNetworkList(rows);
    expect(opts.map((o) => o.code)).toEqual(['TRC20', 'ERC20']);
    expect(resolvePalremitNetworkFromOptions(opts, 'erc20')).toBe('ERC20');
  });

  it('resolves TRON / TRX aliases to TRC20 when TRC20 is in the catalogue', () => {
    const opts = palremitNetworkOptionsFromCoinNetworkList([
      {
        network_code: 'TRC20',
        network_name: 'Tron (TRC20)',
        deposit_enabled: true,
        withdraw_enabled: true,
      },
      {
        network_code: 'ERC20',
        network_name: 'Ethereum (ERC20)',
        deposit_enabled: true,
        withdraw_enabled: true,
      },
    ]);
    expect(resolvePalremitNetworkFromOptions(opts, 'tron')).toBe('TRC20');
    expect(resolvePalremitNetworkFromOptions(opts, 'TRON')).toBe('TRC20');
    expect(resolvePalremitNetworkFromOptions(opts, 'TRX')).toBe('TRC20');
    expect(resolvePalremitNetworkFromOptions(opts, 'eth')).toBe('ERC20');
  });

  it('does not invent aliased networks that are absent from the catalogue', () => {
    const opts = palremitNetworkOptionsFromCoinNetworkList([
      {
        network_code: 'ERC20',
        network_name: 'Ethereum (ERC20)',
        deposit_enabled: true,
        withdraw_enabled: true,
      },
    ]);
    expect(resolvePalremitNetworkFromOptions(opts, 'tron')).toBeNull();
    expect(resolvePalremitNetworkFromOptions(opts, 'TRX')).toBeNull();
  });

  it('parses live get_coin_network_list rows with network_name only (no network_code)', () => {
    const rows = [
      {
        network_name: 'BSC',
        network_display_name: 'BNB Smart Chain (BEP20)',
        withdraw_enabled: true,
        deposit_enabled: true,
      },
      {
        network_name: 'TRC20',
        network_display_name: 'Tron (TRC20)',
        withdraw_enabled: false,
        deposit_enabled: false,
      },
    ];
    const opts = palremitNetworkOptionsFromCoinNetworkList(rows);
    expect(opts.map((o) => o.code)).toEqual(['BSC', 'TRC20']);
    expect(opts[0]?.name).toBe('BNB Smart Chain (BEP20)');
  });
});

describe('delisted offramp deposit networks', () => {
  const rows = [
    { network_code: 'TRC20', deposit_enabled: true, withdraw_enabled: true },
    { network_code: 'ERC20', deposit_enabled: true, withdraw_enabled: true },
    { network_code: 'TON', deposit_enabled: true, withdraw_enabled: true },
  ];
  const request = (async () => ({
    status: 200,
    data: { status: 'success', data: rows },
  })) as unknown as PalremitLiquidityRequestFn;

  it('flags Tron and TON, including the TRON / TRX aliases', () => {
    for (const c of ['TRC20', 'trc20', 'TRON', 'TRX', 'TON']) {
      expect(isOfframpDepositNetworkDelisted(c)).toBe(true);
    }
    for (const c of ['ERC20', 'BEP20', 'BSC', 'SOLANA']) {
      expect(isOfframpDepositNetworkDelisted(c)).toBe(false);
    }
  });

  it('refuses a delisted network for an offramp deposit (source.chain)', async () => {
    for (const chain of ['TRC20', 'TRON', 'TON']) {
      await expect(
        resolvePalremitNetworkOrThrow(request, 'USDT', chain, 'source.chain')
      ).rejects.toMatchObject({ name: 'UnsupportedPalremitNetworkError', validNetworkCodes: ['ERC20'] });
    }
    await expect(resolvePalremitNetworkOrThrow(request, 'USDT', 'ERC20', 'source.chain')).resolves.toBe('ERC20');
  });

  it('keeps Tron for onramp payouts (destination.chain)', async () => {
    await expect(resolvePalremitNetworkOrThrow(request, 'USDT', 'TRON', 'destination.chain')).resolves.toBe('TRC20');
  });
});
