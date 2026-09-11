import { describe, it, expect } from 'vitest';
import { payoutFiatDecimals, roundPayoutFiatAmount } from '@/core/quotes/roundPayoutFiatAmount';

describe('roundPayoutFiatAmount', () => {
  it('rounds JPY to whole yen so OwlPay dest-fixed quotes do not 400', () => {
    expect(payoutFiatDecimals('jpy')).toBe(0);
    expect(roundPayoutFiatAmount('JPY', 10000 * 153.43223873)).toBe(1534322);
  });

  it('keeps two-decimal fiats', () => {
    expect(roundPayoutFiatAmount('usd', 870.556)).toBe(870.56);
    expect(roundPayoutFiatAmount('cad', 100.994)).toBe(100.99);
  });

  it('ceils EUR offramp receive to a whole euro (no cents)', () => {
    expect(payoutFiatDecimals('eur')).toBe(0);
    expect(roundPayoutFiatAmount('EUR', 870.01)).toBe(871);
    expect(roundPayoutFiatAmount('eur', 870.556)).toBe(871);
    expect(roundPayoutFiatAmount('EUR', 870)).toBe(870);
  });

  it('does not ceil EUR up from floating-point dust below a cent', () => {
    expect(roundPayoutFiatAmount('EUR', 870.0000001)).toBe(870);
  });
});
