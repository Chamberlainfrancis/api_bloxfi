/**
 * Palremit offramp: §5.2 crypto deposit address + §6.1.3–6.1.4 fiat withdrawal after deposit is seen.
 * docs/palremit_integration_guide.md
 */

import type { PalremitLiquidityRequestFn } from '@/core/integrations/palremitLiquidity';
import {
  createPalremitCryptoAddress,
  createPalremitCryptoAddressNewUser,
  createPalremitFiatWithdrawal,
  confirmPalremitFiatWithdrawal,
  listPalremitCryptoDeposits,
  listPalremitUserCryptoAddresses,
} from '@/core/integrations/palremitLiquidity';
import type { PalremitCryptoAddress } from '@/core/integrations/palremitLiquidity';
import type { CreateOfframpRequest } from '@/types/offramp';
import type { DepositInstructions } from '@/types/offramp';

export interface PalremitOfframpDepositResult {
  /** Correlation: BloxFi offramp requestId (fiat withdrawal reference prefix). */
  correlationId: string;
  depositInstructions: DepositInstructions;
  channelAddressId?: string;
}

function mapCryptoAddressToDepositInstructions(
  addr: { address: string; currency: string; network: string; channel_address_id?: string },
  amount: number,
  depositBy: string
): DepositInstructions {
  return {
    address: addr.address,
    amount: String(amount),
    currency: addr.currency,
    network: addr.network,
    depositBy,
    instruction: `Send exactly ${amount} ${addr.currency} on ${addr.network} to the address above by ${depositBy}`,
  };
}

function getPalremitChannelUserIdFromMetadata(metadata: unknown): string | undefined {
  if (metadata == null || typeof metadata !== 'object' || Array.isArray(metadata)) return undefined;
  const m = metadata as Record<string, unknown>;
  const v = m.palremitChannelUserId ?? m.palremit_channel_user_id;
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
}

function isHttp404(e: unknown): boolean {
  return (
    e instanceof Error &&
    'status' in e &&
    typeof (e as { status: unknown }).status === 'number' &&
    (e as { status: number }).status === 404
  );
}

function isHttp400(e: unknown): boolean {
  return (
    e instanceof Error &&
    'status' in e &&
    typeof (e as { status: unknown }).status === 'number' &&
    (e as { status: number }).status === 400
  );
}

/** Palremit LP returns 400 when an address already exists for currency+network. */
function isCryptoAddressAlreadyExistsError(e: unknown): boolean {
  if (!isHttp400(e)) return false;
  const data = (e as { data?: unknown }).data;
  const msg =
    typeof data === 'object' &&
    data !== null &&
    'message' in data &&
    typeof (data as { message: unknown }).message === 'string'
      ? (data as { message: string }).message
      : '';
  return /already generated|address already/i.test(msg);
}

function normalizeToken(s: string): string {
  return s.trim().toUpperCase();
}

/** LP may label Polygon as MATIC or POLYGON — treat as equivalent for matching. */
function networksMatch(expected: string, fromLp: string): boolean {
  const e = normalizeToken(expected);
  const f = normalizeToken(fromLp);
  if (e === f) return true;
  const poly = new Set(['POLYGON', 'MATIC']);
  return poly.has(e) && poly.has(f);
}

function pickMatchingUserCryptoAddress(
  rows: PalremitCryptoAddress[],
  currency: string,
  network: string
): PalremitCryptoAddress | null {
  const c = normalizeToken(currency);
  const found = rows.find(
    (a) => normalizeToken(a.currency) === c && networksMatch(network, a.network)
  );
  return found ?? null;
}

/**
 * §5.2: For an existing channel user, LP allows one address per currency+network.
 * List first, then create; on "already generated" 400, list again and reuse.
 */
async function resolveExistingUserCryptoDepositAddress(
  liquidityRequest: PalremitLiquidityRequestFn,
  channelUserId: string,
  currency: string,
  network: string
): Promise<PalremitCryptoAddress | null> {
  const listed = await listPalremitUserCryptoAddresses(liquidityRequest, channelUserId);
  const fromList = listed ? pickMatchingUserCryptoAddress(listed, currency, network) : null;
  if (fromList?.address) return fromList;

  try {
    const created = await createPalremitCryptoAddress(liquidityRequest, {
      channel_user_id: channelUserId,
      currency,
      network,
    });
    if (created?.address) return created;
    return null;
  } catch (e) {
    if (isCryptoAddressAlreadyExistsError(e)) {
      const again = await listPalremitUserCryptoAddresses(liquidityRequest, channelUserId);
      const retry = again ? pickMatchingUserCryptoAddress(again, currency, network) : null;
      if (retry?.address) return retry;
      throw e;
    }
    if (isHttp404(e)) return null;
    throw e;
  }
}

/** Names for Palremit §5.1 `create_crypto_address_new_user`. */
function namesForPalremitNewUser(ctx: {
  businessInfo: unknown;
  legalRepresentative: unknown;
}): { first_name: string; last_name: string } {
  const lr =
    ctx.legalRepresentative != null &&
    typeof ctx.legalRepresentative === 'object' &&
    !Array.isArray(ctx.legalRepresentative)
      ? (ctx.legalRepresentative as Record<string, unknown>)
      : undefined;
  if (lr) {
    const fn = (lr.firstName as string) ?? (lr.first_name as string);
    const ln = (lr.lastName as string) ?? (lr.last_name as string);
    if (fn?.trim() && ln?.trim()) {
      return { first_name: fn.trim(), last_name: ln.trim() };
    }
    if (fn?.trim()) return { first_name: fn.trim(), last_name: fn.trim() };
  }
  const bi =
    ctx.businessInfo != null && typeof ctx.businessInfo === 'object' && !Array.isArray(ctx.businessInfo)
      ? (ctx.businessInfo as Record<string, unknown>)
      : undefined;
  if (bi) {
    const fn = (bi.firstName as string) ?? (bi.first_name as string);
    const ln = (bi.lastName as string) ?? (bi.last_name as string);
    if (fn?.trim() && ln?.trim()) {
      return { first_name: fn.trim(), last_name: ln.trim() };
    }
    const legal =
      (bi.legalName as string) ?? (bi.tradingName as string) ?? (bi.businessName as string) ?? '';
    const parts = legal.trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return { first_name: parts[0], last_name: parts.slice(1).join(' ') };
    }
    if (parts.length === 1) return { first_name: parts[0], last_name: parts[0] };
  }
  return { first_name: 'Customer', last_name: 'User' };
}

export interface PalremitOfframpUserPersistence {
  setPalremitChannelUserIdIfAbsent: (userId: string, channelUserId: string) => Promise<boolean>;
  getPalremitChannelUserId: (userId: string) => Promise<string | null>;
}

/**
 * §5.2 crypto address: reuse Palremit `channel_user_id` from User (or legacy metadata), else §5.1 new user + address then persist id (no duplicate LP users per BloxFi user).
 */
export async function createOfframpPalremitCryptoDeposit(
  liquidityRequest: PalremitLiquidityRequestFn,
  ctx: {
    userId: string;
    businessInfo: unknown;
    legalRepresentative: unknown;
    metadata: unknown;
    palremitChannelUserId: string | null;
  },
  persistence: PalremitOfframpUserPersistence,
  body: Omit<CreateOfframpRequest, 'requestId'>,
  requestId: string,
  depositBy: string
): Promise<PalremitOfframpDepositResult | null> {
  const fromCurrency = body.source.currency.trim().toUpperCase();
  /** Must be a Palremit `network_code` from GET /coins/get_coin (validated at ramp creation). */
  const sourceNetwork = body.source.chain.trim();

  let channelUserId =
    (ctx.palremitChannelUserId?.trim() || '') ||
    (getPalremitChannelUserIdFromMetadata(ctx.metadata)?.trim() || '') ||
    '';

  if (!ctx.palremitChannelUserId?.trim() && getPalremitChannelUserIdFromMetadata(ctx.metadata)) {
    const fromMeta = getPalremitChannelUserIdFromMetadata(ctx.metadata)!;
    await persistence.setPalremitChannelUserIdIfAbsent(ctx.userId, fromMeta);
    channelUserId = fromMeta;
  }

  let addr: PalremitCryptoAddress | null = null;

  if (channelUserId) {
    try {
      addr = await resolveExistingUserCryptoDepositAddress(
        liquidityRequest,
        channelUserId,
        fromCurrency,
        sourceNetwork
      );
    } catch (e) {
      if (!isHttp404(e)) throw e;
      addr = null;
    }
  }

  if (!addr?.address) {
    const names = namesForPalremitNewUser(ctx);
    const created = await createPalremitCryptoAddressNewUser(liquidityRequest, {
      first_name: names.first_name,
      last_name: names.last_name,
      currency: fromCurrency,
      network: sourceNetwork,
    });
    if (!created?.address || !created.channel_user_id) {
      addr = created;
    } else {
      const saved = await persistence.setPalremitChannelUserIdIfAbsent(
        ctx.userId,
        created.channel_user_id
      );
      if (saved) {
        addr = created;
      } else {
        const winner = await persistence.getPalremitChannelUserId(ctx.userId);
        if (winner) {
          addr = await resolveExistingUserCryptoDepositAddress(
            liquidityRequest,
            winner,
            fromCurrency,
            sourceNetwork
          );
        } else {
          addr = created;
        }
      }
    }
  }

  if (!addr?.address) return null;

  return {
    correlationId: requestId,
    depositInstructions: mapCryptoAddressToDepositInstructions(
      addr,
      body.source.amount,
      depositBy
    ),
    channelAddressId: addr.channel_address_id,
  };
}

/** §6.1.3 `destination_information` from BloxFi account holder + region. */
export function buildPalremitFiatDestinationInformation(
  accountHolder: unknown,
  regionDetails: unknown
): Record<string, string> {
  const holder =
    accountHolder && typeof accountHolder === 'object'
      ? (accountHolder as Record<string, unknown>)
      : {};
  const region =
    regionDetails && typeof regionDetails === 'object'
      ? (regionDetails as Record<string, unknown>)
      : {};
  const accountNumber =
    (region.accountNumber as string) ?? (region.account_number as string) ?? '';
  const bankName = (region.bankName as string) ?? (region.bank_name as string) ?? 'Bank';
  const bankCode = (region.bankCode as string) ?? (region.bank_code as string) ?? '00';
  const accountName =
    (holder.name as string) ?? (holder.account_name as string) ?? 'Account Holder';
  const country =
    typeof region.country === 'string' && region.country.length >= 2
      ? String(region.country).slice(0, 2).toUpperCase()
      : 'NG';
  return {
    account_unique: accountNumber,
    account_name: accountName,
    provider_name: bankName,
    provider_code: bankCode,
    country,
  };
}

const DEPOSIT_OK_STATUSES = ['successful', 'success', 'completed', 'confirmed'];

/**
 * §5.5 List deposits; on match, §6.1.3–6.1.4 create + confirm fiat withdrawal.
 */
export async function tryPalremitOfframpFiatPayout(
  liquidityRequest: PalremitLiquidityRequestFn,
  params: {
    offrampId: string;
    requestId: string;
    expectedCryptoAmount: number;
    depositAddress: string;
    sourceCurrency: string;
    sourceNetwork: string;
    destinationAmount: number;
    destinationCurrency: string;
    destinationInformation: Record<string, string>;
  }
): Promise<{ withdrawalReference: string } | null> {
  const deposits = await listPalremitCryptoDeposits(liquidityRequest, {
    currency: params.sourceCurrency,
    network: params.sourceNetwork,
    limit: 50,
  });
  if (!deposits?.length) return null;

  const normalizedAddr = params.depositAddress.toLowerCase();
  const match = deposits.find((d) => {
    const dest = (d.destination_address ?? '').toLowerCase();
    const okAddr =
      dest === normalizedAddr ||
      dest.includes(normalizedAddr) ||
      normalizedAddr.includes(dest);
    const amtOk = d.amount >= params.expectedCryptoAmount * 0.99;
    const st = (d.status ?? '').toLowerCase();
    const okStatus = DEPOSIT_OK_STATUSES.some((s) => st.includes(s));
    return okAddr && amtOk && okStatus;
  });
  if (!match) return null;

  const reference = `WTH-OFF-${params.offrampId.slice(0, 8)}-${params.requestId.slice(0, 8)}`;
  const created = await createPalremitFiatWithdrawal(liquidityRequest, {
    reference,
    destination_amount: params.destinationAmount,
    destination_currency: params.destinationCurrency.toUpperCase(),
    destination_type: 'bank_account',
    destination_information: params.destinationInformation,
  });
  if (!created?.reference) return null;

  const confirmed = await confirmPalremitFiatWithdrawal(liquidityRequest, created.reference);
  if (!confirmed) return null;

  return { withdrawalReference: created.reference };
}
