import { describe, it, expect } from 'vitest';
import {
  NGN_POOLED_KUDA_ACCOUNT_NAME,
  POOLED_PLATFORM_ACCOUNT_NAME,
  dynamicDepositAccountStyle,
} from '@/core/onramps/depositAccountStyle';

describe('depositAccountStyle', () => {
  it('treats NGN and USD as pooled', () => {
    expect(dynamicDepositAccountStyle('NGN')).toBe('pooled');
    expect(dynamicDepositAccountStyle('ngn')).toBe('pooled');
    expect(dynamicDepositAccountStyle('USD')).toBe('pooled');
  });

  it('treats other currencies as named (KYC path)', () => {
    expect(dynamicDepositAccountStyle('EUR')).toBe('named');
    expect(dynamicDepositAccountStyle('KES')).toBe('named');
  });

  it('exposes pooled platform + Kuda account-name constants', () => {
    expect(POOLED_PLATFORM_ACCOUNT_NAME).toBe('Palremit LTD');
    expect(NGN_POOLED_KUDA_ACCOUNT_NAME).toBe('LTD.');
  });
});
