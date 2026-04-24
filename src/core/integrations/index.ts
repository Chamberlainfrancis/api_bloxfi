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
} from '@/core/integrations/palremit';
export type { PalremitCurrencyRequestFn } from '@/core/integrations/palremit';
export {
  UnsupportedPalremitNetworkError,
  fetchPalremitNetworksForCoin,
  resolvePalremitNetworkOrThrow,
  palremitNetworkOptionsFromCoinData,
} from '@/core/integrations/palremitCoinNetworks';
export type { PalremitNetworkOption, PalremitRampChainField } from '@/core/integrations/palremitCoinNetworks';
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
  getPalremitCoin,
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
  PalremitGetCoinData,
} from '@/core/integrations/palremitLiquidity';
