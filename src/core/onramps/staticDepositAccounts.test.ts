import { describe, it, expect } from 'vitest';
import {
  buildStaticFallbackDepositInfo,
  isPreferredStaticDepositCurrency,
  isStaticDepositCurrency,
  staticDepositNarrationRef,
} from '@/core/onramps/staticDepositAccounts';

describe('staticDepositAccounts', () => {
  it('recognizes GBP / USD / GHS only', () => {
    expect(isStaticDepositCurrency('GBP')).toBe(true);
    expect(isStaticDepositCurrency('usd')).toBe(true);
    expect(isStaticDepositCurrency('GHS')).toBe(true);
    expect(isStaticDepositCurrency('NGN')).toBe(false);
  });

  it('marks GBP and GHS as preferred static (not USD)', () => {
    expect(isPreferredStaticDepositCurrency('GBP')).toBe(true);
    expect(isPreferredStaticDepositCurrency('ghs')).toBe(true);
    expect(isPreferredStaticDepositCurrency('USD')).toBe(false);
  });

  it('uses the onramp txnRef as the bank narration reference', () => {
    expect(staticDepositNarrationRef('ON-4e8d1ff74716a08423c1cb1b')).toBe(
      'ON-4e8d1ff74716a08423c1cb1b'
    );
    expect(staticDepositNarrationRef('  ON-abc  ')).toBe('ON-abc');
  });

  it('builds GBP Clear Bank instructions with IBAN/sort/BIC and narration ask', () => {
    const info = buildStaticFallbackDepositInfo({
      currency: 'GBP',
      amount: 1000,
      txnRef: 'ON-4e8d1ff74716a08423c1cb1b',
      depositByIso: '2026-07-24T00:00:00.000Z',
    });
    expect(info).toMatchObject({
      bankName: 'Clear Bank',
      beneficiary: { name: 'Tranzy', country: 'GB' },
      wire: { accountNumber: '00000094', routingNumber: '040954' },
      sortCode: '040954',
      iban: 'GB76CLRB04095400000094',
      bic: 'CLRBGB22436',
      reference: 'ON-4e8d1ff74716a08423c1cb1b',
    });
    expect(info?.instruction).toContain(
      'add this exact reference to the payment narration / reference: ON-4e8d1ff74716a08423c1cb1b'
    );
    expect(info?.instruction).toContain('Transfers without this narration cannot be matched');
  });

  it('builds USD Cross River and GHS First Bank instructions', () => {
    const usd = buildStaticFallbackDepositInfo({
      currency: 'USD',
      amount: 500,
      txnRef: 'ON-USD',
      depositByIso: '2026-07-24T00:00:00.000Z',
    });
    expect(usd?.beneficiary.name).toBe('Palremit');
    expect(usd?.wire).toEqual({ accountNumber: '387199357253', routingNumber: '021214891' });
    expect(usd?.instruction).toContain('wire memo / narration: ON-USD');

    const ghs = buildStaticFallbackDepositInfo({
      currency: 'GHS',
      amount: 2000,
      txnRef: 'ON-GHS',
      depositByIso: '2026-07-24T00:00:00.000Z',
    });
    expect(ghs?.bankName).toBe('FIRST BANK');
    expect(ghs?.wire).toEqual({ accountNumber: '9990000103912', routingNumber: 'INCEGHAC' });
    expect(ghs?.instruction).toContain('transfer narration / description: ON-GHS');
  });

  it('returns null for unsupported currencies', () => {
    expect(
      buildStaticFallbackDepositInfo({
        currency: 'NGN',
        amount: 1,
        txnRef: 'ON1',
        depositByIso: '2026-07-24T00:00:00.000Z',
      })
    ).toBeNull();
  });
});
