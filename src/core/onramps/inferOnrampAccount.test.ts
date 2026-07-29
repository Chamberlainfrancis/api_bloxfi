import { describe, it, expect } from 'vitest';
import { inferOnrampAccount, type OnrampAccountLike } from '@/core/onramps/inferOnrampAccount';

function account(over: Partial<OnrampAccountLike> & Pick<OnrampAccountLike, 'id'>): OnrampAccountLike {
  return {
    accountHolder: { email: 'jehinc26@gmail.com' },
    swipeluxCustomerId: null,
    ...over,
  };
}

describe('inferOnrampAccount', () => {
  it('returns none when the user has no onramp account', () => {
    expect(inferOnrampAccount([])).toEqual({ kind: 'none' });
  });

  it('resolves the sole onramp account with its contact email', () => {
    const r = inferOnrampAccount([account({ id: 'acc_1' })]);
    expect(r).toEqual({
      kind: 'resolved',
      account: {
        accountReference: 'acc_1',
        contactEmail: 'jehinc26@gmail.com',
        customerType: 'individual',
      },
    });
  });

  // A bound row beats recency or ordering — it is already the SwipeLux identity.
  it('prefers the single account already bound to a SwipeLux customer', () => {
    const r = inferOnrampAccount([
      account({ id: 'acc_unbound' }),
      account({ id: 'acc_bound', swipeluxCustomerId: 'cus_GE4uDIPEE3iA6kMnIG' }),
      account({ id: 'acc_unbound_2' }),
    ]);
    expect(r).toMatchObject({ kind: 'resolved', account: { accountReference: 'acc_bound' } });
  });

  it('is ambiguous when several accounts are bound to SwipeLux customers', () => {
    const r = inferOnrampAccount([
      account({ id: 'acc_a', swipeluxCustomerId: 'cus_a' }),
      account({ id: 'acc_b', swipeluxCustomerId: 'cus_b' }),
    ]);
    expect(r).toEqual({ kind: 'ambiguous', accountIds: ['acc_a', 'acc_b'] });
  });

  it('is ambiguous when several unbound accounts exist', () => {
    const r = inferOnrampAccount([account({ id: 'acc_a' }), account({ id: 'acc_b' })]);
    expect(r).toEqual({ kind: 'ambiguous', accountIds: ['acc_a', 'acc_b'] });
  });

  it('resolves with no email when accountHolder carries none', () => {
    const r = inferOnrampAccount([account({ id: 'acc_1', accountHolder: { name: 'Jonathan' } })]);
    expect(r).toMatchObject({ kind: 'resolved', account: { contactEmail: undefined } });
  });

  it('treats a blank email as absent rather than sending an empty lookup', () => {
    const r = inferOnrampAccount([account({ id: 'acc_1', accountHolder: { email: '   ' } })]);
    expect(r).toMatchObject({ kind: 'resolved', account: { contactEmail: undefined } });
  });

  it('tolerates a null accountHolder', () => {
    const r = inferOnrampAccount([account({ id: 'acc_1', accountHolder: null })]);
    expect(r).toMatchObject({ kind: 'resolved', account: { accountReference: 'acc_1' } });
  });
});
