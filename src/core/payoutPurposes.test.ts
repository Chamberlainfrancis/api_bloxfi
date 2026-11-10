import { describe, it, expect } from 'vitest';
import {
  applyPurposePolicyToFields,
  applyPurposePolicyToTemplate,
  blockedPurposeError,
  destinationPurposeErrors,
  toProviderTransferPurpose,
} from '@/core/payoutPurposes';

const OWLPAY_PURPOSES = [
  'TRANSFER_TO_OWN_ACCOUNT', 'FAMILY_MAINTENANCE', 'EDUCATION', 'MEDICAL_TREATMENT', 'HOTEL',
  'TRAVEL', 'REPAYMENT_OF_LOANS', 'TAX_PAYMENT', 'PURCHASE_PROPERTY', 'PROPERTY_RENTAL',
  'INSURANCE_PREMIUM', 'PRODUCT_INDEMNITY_INSURANCE', 'INSURANCE_CLAIMS', 'MUTUAL_FUND_INVESTMENT',
  'INVESTMENT_SHARES', 'DONATIONS', 'INFO_SERVICE', 'ADVERTISING', 'ROYALTY_FEES',
  'BROKER_FEES', 'ADVISOR_FEES', 'REPRESENTATIVE_EXPENSES', 'CONSTRUCTION', 'TRANSPORTATION',
  'EXPORTED_GOODS', 'DELIVERY_FEES', 'GENERAL_GOODS_OFFLINE',
];

const fields = [
  { path: 'account_number', type: 'string', required: true, label: 'Account number' },
  {
    path: 'extras.transfer_purpose',
    type: 'string',
    required: true,
    label: 'Transfer Purpose',
    enum: [...OWLPAY_PURPOSES, 'SALARY'].map((value) => ({ value, label: value })),
  },
  { path: 'extras.is_self_transfer', type: 'boolean', required: true, label: 'Is self transfer' },
];

describe('payout purpose policy', () => {
  it('hides is_self_transfer, TRANSFER_TO_OWN_ACCOUNT and SALARY from requirements', () => {
    const out = applyPurposePolicyToFields(fields);
    expect(out.map((f) => f.path)).toEqual(['account_number', 'extras.transfer_purpose']);
    const values = out[1]!.enum!.map((c) => c.value);
    expect(values).not.toContain('TRANSFER_TO_OWN_ACCOUNT');
    expect(values).not.toContain('SALARY');
  });

  it('offers the 7 business purposes with their labels', () => {
    const out = applyPurposePolicyToFields(fields);
    const byValue = new Map(out[1]!.enum!.map((c) => [c.value, c.label]));
    expect(byValue.get('REPRESENTATIVE_EXPENSES')).toBe("Representative's Expense");
    expect(byValue.get('ADVISOR_FEES')).toBe('Business Advisory Fees');
    expect(byValue.get('INFO_SERVICE')).toBe('Infotech Service Fees');
    expect(byValue.get('PROFESSIONAL_FEES')).toBe('Professional Fees');
    expect(byValue.get('GRAPHICS_DESIGN_BRANDING_FEES')).toBe('Graphics Design & Branding Fees');
    expect(byValue.get('MARKET_RESEARCH_DEVELOPMENT')).toBe('Market Research & Development');
    expect(byValue.get('TRAINING_DEVELOPMENT_FEES')).toBe('Training and Development Fees');
  });

  it('only adds an alias when the corridor accepts its OwlPay code', () => {
    const out = applyPurposePolicyToFields([
      { ...fields[1]!, enum: [{ value: 'FAMILY_MAINTENANCE' }] },
    ]);
    expect(out[0]!.enum).toEqual([{ value: 'FAMILY_MAINTENANCE' }]);
  });

  it('removes is_self_transfer from the destination template', () => {
    expect(
      applyPurposePolicyToTemplate({ account_number: '', extras: { transfer_purpose: '', is_self_transfer: false } })
    ).toEqual({ account_number: '', extras: { transfer_purpose: '' } });
    expect(applyPurposePolicyToTemplate({ extras: { is_self_transfer: false } })).toEqual({});
  });

  it('maps aliases to OwlPay codes', () => {
    expect(toProviderTransferPurpose('PROFESSIONAL_FEES')).toBe('ADVISOR_FEES');
    expect(toProviderTransferPurpose('GRAPHICS_DESIGN_BRANDING_FEES')).toBe('ADVERTISING');
    expect(toProviderTransferPurpose('MARKET_RESEARCH_DEVELOPMENT')).toBe('ADVERTISING');
    expect(toProviderTransferPurpose('TRAINING_DEVELOPMENT_FEES')).toBe('EDUCATION');
    expect(toProviderTransferPurpose('REPRESENTATIVE_EXPENSES')).toBe('REPRESENTATIVE_EXPENSES');
    expect(toProviderTransferPurpose('FAMILY_MAINTENANCE')).toBe('FAMILY_MAINTENANCE');
  });

  it('rejects blocked purposes and self transfers on account destinations', () => {
    expect(blockedPurposeError('salary')).toMatch(/SALARY/);
    expect(blockedPurposeError('TRANSFER_TO_OWN_ACCOUNT')).not.toBeNull();
    expect(blockedPurposeError('ADVISOR_FEES')).toBeNull();
    expect(
      destinationPurposeErrors({ extras: { transfer_purpose: 'SALARY', is_self_transfer: true } }).map((e) => e.path)
    ).toEqual(['extras.is_self_transfer', 'extras.transfer_purpose']);
    expect(destinationPurposeErrors({ extras: { transfer_purpose: 'EDUCATION', is_self_transfer: false } })).toEqual([]);
  });
});
