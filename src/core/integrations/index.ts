/**
 * LP (liquidity provider) integrations. Map our DTOs to LP requests/responses; use HTTP from services.
 *
 * Architecture:
 * - Core receives an LpHttpClient via DI (implemented by services/lpClient). No direct service imports in core.
 * - User creation is not delegated to LPs: all user/KYB is handled locally (repos + core/kyb).
 * - This module is used for future LP-backed features: onramp/offramp rates and execution (Features 5–6),
 *   webhooks, etc. When adding an LP call, add a function that takes LpHttpClient (and any repos) and
 *   returns mapped results.
 */

export type { LpHttpClient, HttpRequestOptions, HttpResponse } from './types';
export {
  getOnrampRatesFromLp,
  createOnrampAtLp,
  normalizeLpRates,
  normalizeLpCreateOnramp,
} from './onrampLp';
export type { LpRatesResponse, LpCreateOnrampResponse } from './onrampLp';
export {
  getOfframpRatesFromLp,
  createOfframpAtLp,
  normalizeLpOfframpRates,
  normalizeLpCreateOfframp,
} from './offrampLp';
export type { LpOfframpRatesResponse, LpCreateOfframpResponse } from './offrampLp';
export { createOfframpViaPalremit } from './palremitOfframp';
export type { PalremitOfframpResult } from './palremitOfframp';
export {
  getPalremitOnrampRates,
  getPalremitOfframpRates,
  PALREMIT_NETWORK_TO_CHAIN,
  CHAIN_TO_PALREMIT_NETWORK,
} from './palremit';
export type { PalremitCurrencyRequestFn } from './palremit';
export {
  createPalremitCustomerProfile,
  createPalremitOfframpOrder,
  getPalremitRampOrder,
  listPalremitRampOrders,
  createPalremitCryptoAddressNewUser,
  createPalremitCryptoAddress,
  listPalremitCryptoDeposits,
  createPalremitFiatWithdrawal,
  confirmPalremitFiatWithdrawal,
  preparePalremitCryptoWithdrawal,
  confirmPalremitCryptoWithdrawal,
} from './palremitLiquidity';
export type {
  PalremitLiquidityRequestFn,
  PalremitCreateCustomerProfileBody,
  PalremitCustomerProfile,
  PalremitCreateOfframpOrderBody,
  PalremitOfframpOrder,
  PalremitCreateCryptoAddressNewUserBody,
  PalremitCreateCryptoAddressBody,
  PalremitCryptoAddress,
  PalremitCryptoDeposit,
  PalremitCreateFiatWithdrawalBody,
  PalremitPrepareCryptoWithdrawalBody,
} from './palremitLiquidity';
