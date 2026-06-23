/**
 * Palremit integrations only. HTTP via injected request fns (services/palremitAdapters.ts).
 * Liquidity Orchestrator: https://liquidity.palremit.com
 */

export {
  createOfframpPalremitCryptoDeposit,
  createPalremitOfframpFiatWithdrawal,
  buildWithdrawalFromAccount,
  isAccountReadyForOfframp,
} from '@/core/integrations/palremitOfframp';
export type { PalremitOfframpDepositResult } from '@/core/integrations/palremitOfframp';
export {
  createOnrampPalremitFiatDeposit,
  mapOrchestratorFiatInstructionsToDepositInfo,
  executePalremitOnrampCryptoWithdrawal,
} from '@/core/integrations/palremitOnramp';
export type { PalremitOnrampWithdrawResult } from '@/core/integrations/palremitOnramp';
export {
  getPalremitOnrampRates,
  getPalremitOnrampQuote,
  getPalremitOfframpRates,
  getPalremitConversionAmount,
} from '@/core/integrations/palremit';
export type { PalremitCurrencyRequestFn } from '@/core/integrations/palremit';
export {
  UnsupportedPalremitNetworkError,
  fetchPalremitNetworksForCoin,
  resolvePalremitNetworkOrThrow,
  palremitNetworkOptionsFromCoinData,
  palremitNetworkOptionsFromCoinNetworkList,
} from '@/core/integrations/palremitCoinNetworks';
export type { PalremitNetworkOption, PalremitRampChainField } from '@/core/integrations/palremitCoinNetworks';
export {
  getPalremitCoin,
  getPalremitCoinNetworkList,
  listPalremitAllCoins,
  provisionPalremitDepositAccount,
  getPalremitProvisionedAccount,
  listPalremitProvisionedAccounts,
  getPalremitDepositById,
  createPalremitWithdrawal,
} from '@/core/integrations/palremitLiquidity';
export type {
  PalremitLiquidityRequestFn,
  PalremitGetCoinData,
  PalremitProvisionedAccount,
  PalremitDepositInstructions,
  PalremitWithdrawalCreateResult,
} from '@/core/integrations/palremitLiquidity';
export {
  listPalremitBanksForAsset,
  resolvePalremitBankAccount,
} from '@/core/integrations/palremitBanks';
export {
  listPalremitWithdrawalCorridors,
  getPalremitWithdrawalCorridorDetail,
  mapPalremitCorridorRowToApi,
  mapPalremitCorridorDetailToApi,
} from '@/core/integrations/palremitCorridors';
export { validateDestinationAgainstCorridorFields } from '@/core/integrations/palremitCorridorValidate';
export { fetchPalremitWithdrawalFeeQuote } from '@/core/integrations/palremitWithdrawalQuote';
export type {
  PalremitWithdrawalFeeQuote,
  PalremitWithdrawalQuoteFee,
  FetchWithdrawalFeeQuoteInput,
} from '@/core/integrations/palremitWithdrawalQuote';
export type {
  PalremitBankRow,
  PalremitBankResolveInput,
  PalremitBankResolveResult,
} from '@/core/integrations/palremitBanks';
