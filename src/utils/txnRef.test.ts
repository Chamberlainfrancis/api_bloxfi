import { describe, it, expect } from 'vitest';
import {
  buildOfframpFeeClientReference,
  parseOfframpFeeClientReference,
  isOfframpFeeClientReference,
  isOfframpTxnRef,
  buildOnrampFeeClientReference,
  parseOnrampFeeClientReference,
  isOnrampTxnRef,
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

describe('onramp fee client reference', () => {
  const ON_REF = 'ON-635d8fecfbc6926c9333ad98';

  it('builds and parses fee client reference', () => {
    const feeRef = buildOnrampFeeClientReference(ON_REF);
    expect(feeRef).toBe(`${ON_REF}-FEE`);
    expect(isOnrampTxnRef(feeRef)).toBe(false);
    expect(parseOnrampFeeClientReference(feeRef)).toBe(ON_REF);
  });

  it('does not cross-match onramp and offramp fee refs', () => {
    expect(parseOfframpFeeClientReference(buildOnrampFeeClientReference(ON_REF))).toBeNull();
    expect(parseOnrampFeeClientReference(buildOfframpFeeClientReference(TXN_REF))).toBeNull();
    expect(parseOnrampFeeClientReference(ON_REF)).toBeNull();
  });
});
