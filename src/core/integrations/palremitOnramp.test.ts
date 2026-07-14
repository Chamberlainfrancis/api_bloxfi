import { describe, it, expect } from 'vitest';
import {
  mapOrchestratorFiatInstructionsToDepositInfo,
  beneficiaryDisplayNameFromOnrampSource,
  preferredBeneficiaryDisplayName,
} from '@/core/integrations/palremitOnramp';

describe('preferredBeneficiaryDisplayName', () => {
  it('prefers businessName over legal-representative person name', () => {
    expect(
      preferredBeneficiaryDisplayName({
        businessName: 'BRIANA PAYMENTS LIMITED',
        firstName: 'Murray David Leslie',
        lastName: 'Beer',
      })
    ).toBe('BRIANA PAYMENTS LIMITED');
  });

  it('falls back to person name when businessName is absent', () => {
    expect(
      preferredBeneficiaryDisplayName({
        firstName: 'Ada',
        lastName: 'Lovelace',
      })
    ).toBe('Ada Lovelace');
  });
});

describe('beneficiaryDisplayNameFromOnrampSource', () => {
  it('prefers source.user.businessName over firstName+lastName', () => {
    expect(
      beneficiaryDisplayNameFromOnrampSource({
        user: {
          businessName: 'Acme Ltd',
          firstName: 'Ada',
          lastName: 'Lovelace',
        },
      })
    ).toBe('Acme Ltd');
  });
});

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

  it('prefers orchestrator account_holder_name over KYC/business display (SwipeLux Veem)', () => {
    const instr = {
      kind: 'fiat_account' as const,
      account_number: '9988776655',
      bank_code: '021000021',
      bank_name: 'Citibank',
      account_holder_name: 'Veem',
      reference: 'SWX-1',
    };

    const depositInfo = mapOrchestratorFiatInstructionsToDepositInfo(
      instr,
      'blox-request-id',
      '2026-04-24T08:27:35.726Z',
      250,
      'USD',
      'BRIANA PAYMENTS LIMITED'
    );

    expect(depositInfo.beneficiary.name).toBe('Veem');
  });

  it('falls back to KYC/business display only when orchestrator holder name is synthetic', () => {
    const instr = {
      kind: 'fiat_account' as const,
      account_number: '7000746820',
      bank_code: '090267',
      bank_name: 'Kuda Microfinance Bank',
      account_holder_name: 'Palremit-ON-3cb51f7df3a85a4e71b03b50',
    };

    const depositInfo = mapOrchestratorFiatInstructionsToDepositInfo(
      instr,
      'blox-request-id',
      '2026-04-24T08:27:35.726Z',
      20000,
      'NGN',
      'Jane Q. Customer'
    );

    expect(depositInfo.beneficiary.name).toBe('Jane Q. Customer');
  });

  it('ignores synthetic Palremit holder name when no KYC override is passed', () => {
    const instr = {
      kind: 'fiat_account' as const,
      account_number: '7000746820',
      bank_code: '090267',
      bank_name: 'Kuda Microfinance Bank',
      account_holder_name: 'Palremit-ON-3cb51f7df3a85a4e71b03b50',
    };

    const depositInfo = mapOrchestratorFiatInstructionsToDepositInfo(
      instr,
      'blox-request-id',
      '2026-04-24T08:27:35.726Z',
      20000,
      'NGN'
    );

    expect(depositInfo.beneficiary.name).toBe('Beneficiary');
  });

  it('uses the orchestrator-provided reference when present — required for pooled-payin providers like SwipeLux, where account_number is shared across depositors and only the reference disambiguates a wire', () => {
    const instr = {
      kind: 'fiat_account' as const,
      account_number: '9988776655',
      bank_code: '021000021',
      bank_name: 'Pooled Bank',
      account_holder_name: 'Pooled Account',
      reference: 'SWX-REF-abc123',
    };

    const depositInfo = mapOrchestratorFiatInstructionsToDepositInfo(
      instr,
      'blox-request-id',
      '2026-04-24T08:27:35.726Z',
      250,
      'USD'
    );

    expect(depositInfo.reference).toBe('SWX-REF-abc123');
    expect(depositInfo.instruction).toContain('SWX-REF-abc123');
  });

  it('falls back to account_number-bank_code when no reference is present (dedicated-account providers)', () => {
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

    expect(depositInfo.reference).toBe('7000746820-090267');
  });
});
