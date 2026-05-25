import { describe, it, expect } from 'vitest';
import {
  buildPalremitFailureLogMsg,
  extractPalremitErrorMessage,
  getPalremitLogCategory,
} from '@/services/palremitErrorMessage';

describe('palremitErrorMessage', () => {
  it('uses category prefix and full JSON body in log message', () => {
    const data = { status: 'error', message: 'Invalid conversion' };
    expect(
      buildPalremitFailureLogMsg({ category: 'Currency Conversion', responseData: data })
    ).toBe('[Currency Conversion] {"status":"error","message":"Invalid conversion"}');
  });

  it('extracts message from envelope', () => {
    expect(extractPalremitErrorMessage({ status: 'error', message: 'Invalid conversion' })).toBe(
      'Invalid conversion'
    );
  });

  it('labels onramp vs offramp withdrawals from idempotency key', () => {
    expect(
      getPalremitLogCategory({
        api: 'liquidity',
        method: 'POST',
        path: '/v1/withdrawals',
        idempotencyKey: 'onramp-crypto-wd:ON-abc',
      })
    ).toBe('Palremit Onramp Withdrawal');
    expect(
      getPalremitLogCategory({
        api: 'liquidity',
        method: 'POST',
        path: '/v1/withdrawals',
        idempotencyKey: 'offramp-fiat-wd:OFF-xyz',
      })
    ).toBe('Palremit Offramp Withdrawal');
  });

  it('labels currency conversion path', () => {
    expect(
      getPalremitLogCategory({
        api: 'currency',
        method: 'POST',
        path: '/pairs/conversion',
      })
    ).toBe('Currency Conversion');
  });
});
