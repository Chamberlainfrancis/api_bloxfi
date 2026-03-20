/**
 * Core: create onramp. Palremit only: rates from Currency API + prepare/confirm crypto withdrawal.
 * Fiat debited from Palremit-integrated balance (source_currency). docs/palremit_integration_guide.md §6.2.
 */

import { applyOnrampFee } from '@/core/payments';
import type {
  CreateOnrampRequest,
  CreateOnrampResponse,
  GetOnrampRatesResponse,
  OnrampStatus,
  OnrampSource,
  OnrampDestination,
  QuoteInformation,
  DepositInfo,
  DeveloperFeeAmount,
  OnrampTransferDetails,
} from '@/types/onramp';

const QUOTE_EXPIRY_MINUTES = 30;

export interface CreateOnrampOptions {
  getRateFromPalremit?: (from: string, to: string) => Promise<GetOnrampRatesResponse | null>;
  /** Palremit prepare + confirm crypto withdrawal to user's wallet. */
  executePalremitCryptoWithdrawal: (
    body: Omit<CreateOnrampRequest, 'requestId'>,
    requestId: string,
    receiveNetCryptoAmount: number,
    destinationAddress: string
  ) => Promise<{ prepareReference: string } | null>;
}

export interface OnrampRepoCreate {
  createOnramp(data: {
    requestId: string;
    userId: string;
    status: OnrampStatus;
    source: object;
    destination: object;
    quoteInformation: object;
    depositInfo?: object | null;
    receipt?: object | null;
    developerFee?: object | null;
    failedReason?: string | null;
  }): Promise<{
    id: string;
    requestId: string;
    userId: string;
    status: string;
    source: unknown;
    destination: unknown;
    quoteInformation: unknown;
    depositInfo: unknown;
    receipt: unknown;
    developerFee: unknown;
    failedReason: string | null;
    createdAt: Date;
    updatedAt: Date;
  }>;
}

export interface UserRepoForOnramp {
  findUserById(id: string): Promise<{
    id: string;
    businessInfo: unknown;
  } | null>;
}

export interface AccountRepoForOnramp {
  findAccountByIdAndUser(accountId: string, userId: string): Promise<{
    id: string;
    userId: string;
    accountHolder: unknown;
    regionDetails: unknown;
    paymentRail: string;
    accountType: string;
  } | null>;
}

export interface WalletRepoForOnramp {
  findExternalWalletByIdAndUser(
    walletId: string,
    userId: string
  ): Promise<{
    id: string;
    address: string;
    chain: string;
    userId: string;
  } | null>;
}

export interface KybRepoForOnramp {
  getKybRailStatuses(userId: string, rails?: string[]): Promise<
    Array<{ rail: string; status: string }>
  >;
}

function userDisplay(user: { businessInfo?: unknown } | null): { email: string; businessName?: string } {
  if (!user?.businessInfo || typeof user.businessInfo !== 'object') {
    return { email: '', businessName: undefined };
  }
  const info = user.businessInfo as Record<string, unknown>;
  return {
    email: (info.email as string) ?? '',
    businessName: (info.legalName as string) ?? (info.tradingName as string),
  };
}

/** depositInfo: Palremit ledger debit — user must maintain fiat balance at Palremit; reference tracks withdrawal. */
function buildPalremitOnrampDepositInfo(
  beneficiaryName: string,
  palremitReference: string,
  depositBy: string,
  sourceCurrency: string,
  sourceAmount: number
): DepositInfo {
  return {
    bankName: 'Palremit',
    beneficiary: { name: beneficiaryName, address: '' },
    reference: palremitReference,
    depositBy,
    instruction: `Palremit debits ${sourceAmount} ${sourceCurrency} from your integrated partner balance. Withdrawal reference: ${palremitReference}. Crypto is sent to the destination wallet after confirmation.`,
  };
}

export async function createOnramp(
  onrampRepo: OnrampRepoCreate,
  userRepo: UserRepoForOnramp,
  accountRepo: AccountRepoForOnramp,
  walletRepo: WalletRepoForOnramp,
  kybRepo: KybRepoForOnramp,
  requestId: string,
  body: Omit<CreateOnrampRequest, 'requestId'>,
  options: CreateOnrampOptions
): Promise<CreateOnrampResponse> {
  const { source: src, destination: dest, fee } = body;
  const userId = src.userId;
  if (dest.userId !== userId) {
    throw new Error('SOURCE_DESTINATION_USER_MISMATCH');
  }

  const user = await userRepo.findUserById(userId);
  if (!user) throw new Error('USER_NOT_FOUND');

  const railCurrency = (src.currency ?? 'USD').toUpperCase();
  const railStatuses = await kybRepo.getKybRailStatuses(userId, [railCurrency]);
  const approved = railStatuses.some((r) => r.status === 'approved');
  if (!approved) throw new Error('USER_NOT_KYB_VERIFIED');

  const account = await accountRepo.findAccountByIdAndUser(src.accountId, userId);
  if (!account) throw new Error('ACCOUNT_NOT_FOUND');

  const wallet = await walletRepo.findExternalWalletByIdAndUser(dest.externalWalletId, userId);
  if (!wallet) throw new Error('WALLET_NOT_FOUND');

  const fromCurrency = src.currency.trim().toLowerCase();
  const toCurrency = dest.currency.trim().toLowerCase();

  if (!options.getRateFromPalremit) {
    throw new Error('PALREMIT_RATES_UNAVAILABLE');
  }
  const rates = await options.getRateFromPalremit(fromCurrency, toCurrency);
  if (!rates?.conversionRate) {
    throw new Error('PALREMIT_RATES_UNAVAILABLE');
  }
  const conversionRate = rates.conversionRate;

  const grossFiat = src.amount;
  const rateNum = parseFloat(conversionRate) || 1;
  const receiveGross = grossFiat * rateNum;
  const { feeAmount: developerFeeAmount, netAmount: receiveNet } = applyOnrampFee(receiveGross, fee);

  const expiresAt = new Date(Date.now() + QUOTE_EXPIRY_MINUTES * 60 * 1000);
  const sendGross = { amount: grossFiat.toFixed(2), currency: fromCurrency };
  const sendNet = sendGross;
  const railFee = { amount: '0.00', currency: fromCurrency };
  const receiveGrossStr = { amount: receiveGross.toFixed(8), currency: toCurrency };
  const receiveNetStr = { amount: receiveNet.toFixed(8), currency: toCurrency };
  const quoteInformation: QuoteInformation = {
    sendGross,
    sendNet,
    railFee,
    receiveGross: receiveGrossStr,
    receiveNet: receiveNetStr,
    rate: conversionRate,
    expiresAt: expiresAt.toISOString(),
  };

  const developerFee: DeveloperFeeAmount = {
    amount: developerFeeAmount.toFixed(8),
    currency: toCurrency,
  };

  const withdrawResult = await options.executePalremitCryptoWithdrawal(
    body,
    requestId,
    receiveNet,
    wallet.address
  );
  if (!withdrawResult) {
    throw new Error('PALREMIT_ONRAMP_WITHDRAWAL_FAILED');
  }

  const userDisplayInfo = userDisplay(user);
  const sourcePayload: OnrampSource = {
    userId,
    currency: fromCurrency,
    amount: grossFiat,
    accountId: account.id,
    transferType: src.transferType ?? account.paymentRail,
    user: userDisplayInfo,
  };
  const destinationPayload: OnrampDestination = {
    userId,
    currency: toCurrency,
    chain: dest.chain,
    walletAddress: wallet.address,
    externalWalletId: dest.externalWalletId,
    amount: receiveNet,
    user: userDisplayInfo,
  };

  const beneficiaryName = (account.accountHolder as { name?: string })?.name ?? 'Account Holder';
  const depositInfo = buildPalremitOnrampDepositInfo(
    beneficiaryName,
    withdrawResult.prepareReference,
    expiresAt.toISOString(),
    fromCurrency.toUpperCase(),
    grossFiat
  );

  const row = await onrampRepo.createOnramp({
    requestId,
    userId,
    status: 'COMPLETED',
    source: sourcePayload,
    destination: destinationPayload,
    quoteInformation,
    depositInfo,
    receipt: { transactionHash: withdrawResult.prepareReference },
    developerFee,
    failedReason: null,
  });

  const transferDetails: OnrampTransferDetails = {
    id: row.id,
    requestId: row.requestId,
    status: row.status as OnrampStatus,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    source: row.source as OnrampSource,
    destination: row.destination as OnrampDestination,
    quoteInformation: row.quoteInformation as QuoteInformation,
    depositInfo: (row.depositInfo as DepositInfo) ?? null,
    receipt: row.receipt ? (row.receipt as { transactionHash: string }) : null,
    developerFee: (row.developerFee as DeveloperFeeAmount) ?? null,
    failedReason: row.failedReason ?? null,
  };

  return {
    transferType: 'ONRAMP',
    transferDetails,
  };
}
