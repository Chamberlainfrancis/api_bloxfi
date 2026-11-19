/** Wallet withdrawal reference (orchestrator client_reference): WALWD-<24 hex>. */
import { randomBytes } from 'crypto';

const WD_RE = /^WALWD-[a-f0-9]{24}$/;

export function generateWalletWithdrawalRef(): string {
  return `WALWD-${randomBytes(12).toString('hex')}`;
}

export function isWalletWithdrawalRef(s: string): boolean {
  return WD_RE.test(s.trim());
}
