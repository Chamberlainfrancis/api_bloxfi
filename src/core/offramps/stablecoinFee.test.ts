import { describe, it, expect } from 'vitest';
import {
  USDT_PER_USDC,
  convertUsdtUsdc,
  parseStableFeeAsset,
} from '@/core/offramps/stablecoinFee';

describe('parseStableFeeAsset', () => {
  it('accepts usdt and usdc case-insensitively', () => {
    expect(parseStableFeeAsset('usdt')).toBe('USDT');
    expect(parseStableFeeAsset('USDC')).toBe('USDC');
  });

  it('rejects anything else', () => {
    expect(parseStableFeeAsset('eur')).toBeNull();
    expect(parseStableFeeAsset('')).toBeNull();
    expect(parseStableFeeAsset(undefined)).toBeNull();
  });
});

describe('convertUsdtUsdc', () => {
  it('is a no-op when source and settlement are the same stable', () => {
    expect(convertUsdtUsdc(10, 'USDT', 'USDT')).toBe(10);
    expect(convertUsdtUsdc(10, 'USDC', 'USDC')).toBe(10);
  });

  it('converts USDT to USDC at the configured 1.02 USDT per USDC', () => {
    expect(USDT_PER_USDC).toBe(1.02);
    expect(convertUsdtUsdc(10.2, 'USDT', 'USDC')).toBeCloseTo(10, 8);
  });

  it('converts USDC to USDT at the configured 1.02 USDT per USDC', () => {
    expect(convertUsdtUsdc(10, 'USDC', 'USDT')).toBeCloseTo(10.2, 8);
  });
});
