import { describe, it, expect } from 'vitest';
import { mapOrchestratorFiatInstructionsToDepositInfo } from '@/core/integrations/palremitOnramp';

describe('palremitOnramp.mapOrchestratorFiatInstructionsToDepositInfo', () => {
  it('maps fiat_account instructions to DepositInfo', () => {
    const instr = {
      kind: 'fiat_account' as const,
      account_number: '7000746820',
      bank_code: '090267',
      bank_name: 'Kuda Microfinance Bank',
      account_holder_name: 'Palremit-BloxFi Test Corp',
    };

    const depositInfo = mapOrchestratorFiatInstructionsToDepositInfo(
      instr,
      'blox-request-id',
      '2026-04-24T08:27:35.726Z',
      20000,
      'NGN'
    );

    expect(depositInfo.wire?.accountNumber).toBe('7000746820');
    expect(depositInfo.bankName).toBe('Kuda Microfinance Bank');
    expect(depositInfo.beneficiary.name).toBe('Palremit-BloxFi Test Corp');
  });
});
