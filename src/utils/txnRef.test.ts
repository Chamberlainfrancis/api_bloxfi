import { describe, it, expect } from 'vitest';
import {
  buildOfframpFeeClientReference,
  parseOfframpFeeClientReference,
  isOfframpFeeClientReference,
  isOfframpTxnRef,
} from '@/utils/txnRef';

const TXN_REF = 'OFF-c4a18b6e3a71f02d4e5b9c08';

describe('offramp fee client reference', () => {
  it('builds and parses fee client reference', () => {
    const feeRef = buildOfframpFeeClientReference(TXN_REF);
    expect(feeRef).toBe(`${TXN_REF}-FEE`);
    expect(isOfframpTxnRef(feeRef)).toBe(false);
    expect(isOfframpFeeClientReference(feeRef)).toBe(true);
    expect(parseOfframpFeeClientReference(feeRef)).toBe(TXN_REF);
  });

  it('returns null for non-fee refs', () => {
    expect(parseOfframpFeeClientReference(TXN_REF)).toBeNull();
    expect(parseOfframpFeeClientReference('OFF-FEE')).toBeNull();
  });
});
