/**
 * Production wiring for business wallets: the core functions in
 * `@/core/businessWallets` get the Postgres ledger repo, the liquidity
 * orchestrator and the partner webhook emitter here.
 */

import * as repo from '@/db/repositories/businessWallet.repo';
import * as userRepo from '@/db/repositories/user.repo';
import {
  createPalremitWithdrawalDetailed,
  provisionPalremitDepositAccount,
} from '@/core/integrations/palremitLiquidity';
import {
  namesForPalremitCryptoProvision,
  pollProvisionedUntilActiveOrFailed,
} from '@/core/integrations/palremitOfframp';
import { schedulePartnerWebhook } from '@/core/partnerWebhooks/emit';
import { createPalremitLiquidityAdapter } from '@/services/palremitAdapters';
import { applyWalletDepositCredited, type WalletDepositDeps } from '@/core/businessWallets/walletDeposits';
import type { ProvisionWalletDeps } from '@/core/businessWallets/provisionWallet';
import { applyWalletWithdrawalEvent, type WalletWithdrawalDeps } from '@/core/businessWallets/walletWithdrawals';

const liquidity = createPalremitLiquidityAdapter();

function businessEmail(user: { businessInfo: unknown }): string {
  const info = user.businessInfo;
  if (info && typeof info === 'object' && !Array.isArray(info)) {
    const e = (info as Record<string, unknown>).email;
    if (typeof e === 'string') return e.trim();
  }
  return '';
}

export const walletDepositDeps: WalletDepositDeps = {
  findDepositAddressByProvisionedAccount: repo.findDepositAddressByProvisionedAccount,
  findBusinessWallet: (userId) => repo.findBusinessWallet(userId),
  isWhitelisted: (userId, chain, address) => repo.isWhitelisted(userId, chain, address),
  recordWalletDeposit: repo.recordWalletDeposit,
  emitPartnerWebhook: (eventType, data) => schedulePartnerWebhook(eventType, data),
};

export const provisionWalletDeps: ProvisionWalletDeps = {
  findUser: userRepo.findUserById,
  upsertBusinessWallet: repo.upsertBusinessWallet,
  listDepositAddresses: repo.listDepositAddresses,
  upsertDepositAddress: repo.upsertDepositAddress,
  provision: (body, key) => provisionPalremitDepositAccount(liquidity, body, key),
  waitUntilActive: (id) => pollProvisionedUntilActiveOrFailed(liquidity, id, { maxAttempts: 10, delayMs: 1500 }),
  names: namesForPalremitCryptoProvision,
  email: businessEmail,
};

export const walletWithdrawalDeps: WalletWithdrawalDeps = {
  findBusinessWallet: (userId) => repo.findBusinessWallet(userId),
  listDepositAddresses: repo.listDepositAddresses,
  createWalletWithdrawal: repo.createWalletWithdrawal,
  findWalletWithdrawalById: repo.findWalletWithdrawalById,
  findWalletWithdrawalByRef: repo.findWalletWithdrawalByRef,
  transitionWalletWithdrawal: repo.transitionWalletWithdrawal,
  finishWalletWithdrawal: repo.finishWalletWithdrawal,
  createOrchestratorWithdrawal: (body, key) => createPalremitWithdrawalDetailed(liquidity, body, key),
  emitPartnerWebhook: (eventType, data) => schedulePartnerWebhook(eventType, data),
};

/** The `wallet` entry of the inbound webhook repos. */
export const walletWebhookHandlers = {
  onDepositCredited: (clientRef: string, dep: Record<string, unknown>, raw: Record<string, unknown>) =>
    applyWalletDepositCredited(walletDepositDeps, clientRef, dep, raw),
  onWithdrawalEvent: (
    clientRef: string,
    w: Record<string, unknown>,
    outcome: 'successful' | 'failed',
    reason?: string
  ) => applyWalletWithdrawalEvent(walletWithdrawalDeps, clientRef, w, outcome, reason),
};
