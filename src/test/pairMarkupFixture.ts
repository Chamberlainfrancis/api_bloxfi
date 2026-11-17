/**
 * Test-only pair markup rows. Production has no rates in code: they live in
 * the PairMarkupSetting table. These are the rows the migrations seeded on
 * 2026-10-27, which the existing pricing tests were written against.
 */
import type { PairMarkupSettingRow } from '@/core/quotes/pairMarkupStore';

export const TEST_PAIR_MARKUP_ROWS: readonly PairMarkupSettingRow[] = [
  { fiat: 'EUR', side: 'buy', cryptos: 'USD,USDT,USDC', markupBps: 240 },
  { fiat: 'EUR', side: 'sell', cryptos: 'USD,USDT,USDC', markupBps: 20 },
  { fiat: 'USD', side: 'sell', cryptos: 'USDT,USDC', markupBps: 20 },
  { fiat: 'CAD', side: 'buy', cryptos: 'USD,USDT,USDC', markupBps: 50 },
  { fiat: 'CAD', side: 'sell', cryptos: 'USD,USDT,USDC', markupBps: 20 },
  { fiat: 'JPY', side: 'buy', cryptos: 'USD,USDT,USDC', markupBps: 50 },
  { fiat: 'JPY', side: 'sell', cryptos: 'USD,USDT,USDC', markupBps: 50 },
  { fiat: 'AUD', side: 'buy', cryptos: 'USD,USDT,USDC', markupBps: 50 },
  { fiat: 'AUD', side: 'sell', cryptos: 'USD,USDT,USDC', markupBps: 50 },
  { fiat: 'GBP', side: 'buy', cryptos: 'USD,USDT,USDC', markupBps: 45 },
];
