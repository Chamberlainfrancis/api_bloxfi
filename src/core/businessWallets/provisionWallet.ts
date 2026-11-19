/**
 * Admin: switch a business wallet on and open its deposit addresses (one per
 * asset and chain) at the orchestrator, pinned to Tatum so an address is
 * never issued by Quidax. Client reference WAL-<userId> on every address:
 * the orchestrator keeps those deposits in main (no OKX forward).
 */

import { logger } from '@/lib/logger';
import type { BusinessWalletRow, WalletAsset, WalletDepositAddressRow } from '@/db/repositories/businessWallet.repo';
import type { PalremitDepositInstructions, PalremitProvisionedAccount } from '@/core/integrations/palremitLiquidity';
import { WALLET_DEFAULT_CHAINS, isAllowedWalletChain, walletClientReference } from './chains';

export interface ProvisionWalletDeps {
  findUser(userId: string): Promise<{ id: string; businessInfo: unknown; legalRepresentative: unknown } | null>;
  upsertBusinessWallet(
    userId: string,
    patch: Partial<Pick<BusinessWalletRow, 'enabled' | 'walletOnly' | 'whitelistRequired'>>,
    updatedBy: string
  ): Promise<BusinessWalletRow>;
  listDepositAddresses(userId: string): Promise<WalletDepositAddressRow[]>;
  upsertDepositAddress(data: {
    userId: string;
    asset: string;
    chain: string;
    clientReference: string;
    status: string;
    address?: string | null;
    memo?: string | null;
    provisionedAccountId?: string | null;
    failureReason?: string | null;
    createdBy?: string | null;
  }): Promise<WalletDepositAddressRow>;
  provision(body: Record<string, unknown>, idempotencyKey: string): Promise<{ account: PalremitProvisionedAccount } | null>;
  waitUntilActive(accountId: string): Promise<{ account: PalremitProvisionedAccount | null; failed: boolean }>;
  names(user: { businessInfo: unknown; legalRepresentative: unknown }): { first_name: string; last_name: string };
  email(user: { businessInfo: unknown }): string;
}

export interface ChainSelection {
  asset: WalletAsset;
  chain: string;
}

export function defaultChainSelection(): ChainSelection[] {
  return (Object.keys(WALLET_DEFAULT_CHAINS) as WalletAsset[]).flatMap((asset) =>
    WALLET_DEFAULT_CHAINS[asset].map((chain) => ({ asset, chain }))
  );
}

/** Enable the wallet (if not already) and open any missing deposit addresses. Safe to call again. */
export async function enableWalletChains(
  deps: ProvisionWalletDeps,
  userId: string,
  selection: ChainSelection[],
  actor: string
): Promise<{ wallet: BusinessWalletRow; addresses: WalletDepositAddressRow[] }> {
  const user = await deps.findUser(userId);
  if (!user) throw new Error('USER_NOT_FOUND');
  for (const s of selection) {
    if (!isAllowedWalletChain(s.asset, s.chain)) throw new Error(`CHAIN_NOT_ALLOWED:${s.asset}/${s.chain}`);
  }
  const wallet = await deps.upsertBusinessWallet(userId, { enabled: true }, actor);
  const existing = await deps.listDepositAddresses(userId);
  const clientReference = walletClientReference(userId);
  const names = deps.names(user);
  const email = deps.email(user);

  for (const s of selection) {
    const chain = s.chain.toUpperCase();
    const have = existing.find((a) => a.asset === s.asset && a.chain === chain);
    if (have?.status === 'active') continue;
    const body: Record<string, unknown> = {
      asset: s.asset,
      mode: 'CRYPTO_DEPOSIT',
      network: chain,
      client_reference: clientReference,
      preferred_provider: 'tatum',
      kyc_input: { provider_extras: { first_name: names.first_name, last_name: names.last_name, email } },
    };
    const prov = await deps.provision(body, `wallet-prov:${userId}:${s.asset}:${chain}`);
    if (!prov) {
      await deps.upsertDepositAddress({ userId, asset: s.asset, chain, clientReference, status: 'failed', failureReason: 'orchestrator refused the address', createdBy: actor });
      logger.error({ userId, asset: s.asset, chain }, 'wallet deposit address provision failed');
      continue;
    }
    let account: PalremitProvisionedAccount | null = prov.account;
    const st = account.state?.toLowerCase();
    if (st === 'pending' || st === 'kyc_pending') {
      const polled = await deps.waitUntilActive(account.id);
      account = polled.account;
    }
    const instr = account?.deposit_instructions as PalremitDepositInstructions | null | undefined;
    if (!account || account.state?.toLowerCase() !== 'active' || instr?.kind !== 'crypto_address') {
      await deps.upsertDepositAddress({
        userId, asset: s.asset, chain, clientReference,
        status: account?.state?.toLowerCase() === 'failed' ? 'failed' : 'pending',
        provisionedAccountId: account?.id ?? prov.account.id,
        failureReason: account?.state?.toLowerCase() === 'failed' ? 'orchestrator marked the address failed' : null,
        createdBy: actor,
      });
      continue;
    }
    await deps.upsertDepositAddress({
      userId, asset: s.asset, chain, clientReference, status: 'active',
      address: instr.address, memo: instr.memo ?? null, provisionedAccountId: account.id, failureReason: null, createdBy: actor,
    });
  }
  return { wallet, addresses: await deps.listDepositAddresses(userId) };
}
