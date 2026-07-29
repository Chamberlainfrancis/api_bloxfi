/**
 * Infers which onramp Account a USD onramp belongs to.
 *
 * The onramp request is user-scoped — `source.userId`, no account id — but
 * SwipeLux customer identity is resolved per account on the orchestrator
 * side. This bridges the two by inference.
 *
 * Inference can fail, and when it does the answer is to say nothing rather
 * than to guess. Omitting `account_reference` puts the orchestrator back on
 * its per-business path, which is exactly today's behaviour; guessing wrong
 * would bind an account to another person's SwipeLux customer, and the
 * orchestrator would happily stamp that binding as permanent.
 */

export interface OnrampAccountLike {
  id: string;
  accountHolder: unknown;
  swipeluxCustomerId: string | null;
}

export interface InferredOnrampAccount {
  accountReference: string;
  contactEmail: string | undefined;
  customerType: 'individual';
}

export type InferOnrampAccountResult =
  | { kind: 'resolved'; account: InferredOnrampAccount }
  | { kind: 'none' }
  | { kind: 'ambiguous'; accountIds: string[] };

function emailOf(accountHolder: unknown): string | undefined {
  if (typeof accountHolder !== 'object' || accountHolder === null) return undefined;
  const email = (accountHolder as { email?: unknown }).email;
  if (typeof email !== 'string') return undefined;
  const trimmed = email.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function resolved(account: OnrampAccountLike): InferOnrampAccountResult {
  return {
    kind: 'resolved',
    account: {
      accountReference: account.id,
      contactEmail: emailOf(account.accountHolder),
      // Onramp accounts are created as individuals (createAccount.ts pins
      // customer_type: 'individual' on the KYC import), so there is nothing
      // to infer here yet. Revisit when business onramp accounts exist.
      customerType: 'individual',
    },
  };
}

export function inferOnrampAccount(
  accounts: readonly OnrampAccountLike[],
): InferOnrampAccountResult {
  if (accounts.length === 0) return { kind: 'none' };

  // A row carrying swipeluxCustomerId is already bound to a SwipeLux customer,
  // which is a stronger signal than recency or ordering. One such row is the
  // answer regardless of how many unbound siblings exist.
  const bound = accounts.filter((a) => a.swipeluxCustomerId);
  const onlyBound = bound[0];
  if (bound.length === 1 && onlyBound) return resolved(onlyBound);
  if (bound.length > 1) return { kind: 'ambiguous', accountIds: bound.map((a) => a.id) };

  const only = accounts[0];
  if (accounts.length === 1 && only) return resolved(only);

  return { kind: 'ambiguous', accountIds: accounts.map((a) => a.id) };
}
