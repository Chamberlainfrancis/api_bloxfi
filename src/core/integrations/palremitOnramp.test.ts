import { describe, it, expect } from 'vitest';
import { mapPalremitFiatDepositResponseToDepositInfo } from '@/core/integrations/palremitOnramp';

describe('palremitOnramp.mapPalremitFiatDepositResponseToDepositInfo', () => {
  it('prefers payment_information.reference/narration over id (webhook correlation)', () => {
    const raw = {
      id: 'some-internal-id',
      bank_name: 'Kuda Microfinance Bank',
      bank_code: '090267',
      address: '7000746820',
      account_name: 'Palremit-BloxFi Test Corp',
      payment_information: {
        narration: 'PR17770175955141299',
      },
    } as Record<string, unknown>;

    const depositInfo = mapPalremitFiatDepositResponseToDepositInfo(
      raw,
      'blox-request-id',
      '2026-04-24T08:27:35.726Z',
      20000,
      'NGN'
    );

    expect(depositInfo.reference).toBe('PR17770175955141299');
  });
});

