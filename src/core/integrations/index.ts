/**
 * Palremit integrations only. HTTP via injected request fns (services/palremitAdapters.ts).
 * docs/palremit_integration_guide.md §5–§6 (deposits + withdrawals).
 */

export {
  createOfframpPalremitCryptoDeposit,
  buildPalremitFiatDestinationInformation,
  tryPalremitOfframpFiatPayout,
} from '@/core/integrations/palremitOfframp';
export type {
  PalremitOfframpDepositResult,
  PalremitOfframpUserPersistence,
} from '@/core/integrations/palremitOfframp';
export {
  createOnrampPalremitFiatDeposit,
  mapPalremitFiatDepositResponseToDepositInfo,
  executePalremitOnrampCryptoWithdrawal,
} from '@/core/integrations/palremitOnramp';
export type { PalremitOnrampWithdrawResult } from '@/core/integrations/palremitOnramp';
export {
  getPalremitOnrampRates,
  getPalremitOnrampQuote,
  getPalremitOfframpRates,
  PALREMIT_NETWORK_TO_CHAIN,
  CHAIN_TO_PALREMIT_NETWORK,
} from '@/core/integrations/palremit';
export type { PalremitCurrencyRequestFn } from '@/core/integrations/palremit';
export {
  createPalremitCryptoAddressNewUser,
  createPalremitCryptoAddress,
  listPalremitUserCryptoAddresses,
  createPalremitFiatDeposit,
  listPalremitCryptoDeposits,
  createPalremitFiatWithdrawal,
  confirmPalremitFiatWithdrawal,
  preparePalremitCryptoWithdrawal,
  confirmPalremitCryptoWithdrawal,
} from '@/core/integrations/palremitLiquidity';
export type {
  PalremitLiquidityRequestFn,
  PalremitCreateCryptoAddressNewUserBody,
  PalremitCreateCryptoAddressBody,
  PalremitCreateFiatDepositBody,
  PalremitCryptoAddress,
  PalremitCryptoDeposit,
  PalremitCreateFiatWithdrawalBody,
  PalremitPrepareCryptoWithdrawalBody,
} from '@/core/integrations/palremitLiquidity';
