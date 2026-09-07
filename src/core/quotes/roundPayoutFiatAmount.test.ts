import { describe, it, expect } from 'vitest';
import { payoutFiatDecimals, roundPayoutFiatAmount } from '@/core/quotes/roundPayoutFiatAmount';

describe('roundPayoutFiatAmount', () => {
  it('rounds JPY to whole yen so OwlPay dest-fixed quotes do not 400', () => {
    expect(payoutFiatDecimals('jpy')).toBe(0);
    expect(roundPayoutFiatAmount('JPY', 10000 * 153.43223873)).toBe(1534322);
  });

  it('keeps two-decimal fiats', () => {
    expect(roundPayoutFiatAmount('eur', 870.556)).toBe(870.56);
  });
});
