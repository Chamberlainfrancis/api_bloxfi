import { describe, it, expect } from 'vitest';
import { stableStringify, sortJsonDeep } from '@/utils/stableJson';

describe('stableJson', () => {
  it('sortJsonDeep orders object keys', () => {
    expect(sortJsonDeep({ b: 1, a: 2 })).toEqual({ a: 2, b: 1 });
  });

  it('stableStringify matches across key order', () => {
    const a = { foo: { z: 1, y: 2 }, bar: 3 };
    const b = { bar: 3, foo: { y: 2, z: 1 } };
    expect(stableStringify(a)).toBe(stableStringify(b));
  });
});
