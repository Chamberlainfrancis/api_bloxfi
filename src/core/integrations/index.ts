/**
 * Palremit integrations only. HTTP via injected request fns (services/palremitAdapters.ts).
 * docs/palremit_integration_guide.md, palremit_rates_guide.md.
 */

export {
  createOfframpPalremitCryptoDeposit,
  buildPalremitFiatDestinationInformation,
  tryPalremitOfframpFiatPayout,
} from '@/core/integrations/palremitOfframp';
export type { PalremitOfframpDepositResult } from '@/core/integrations/palremitOfframp';
export { executePalremitOnrampCryptoWithdrawal } from '@/core/integrations/palremitOnramp';
export type { PalremitOnrampWithdrawResult } from '@/core/integrations/palremitOnramp';
export {
  getPalremitOnrampRates,
  getPalremitOfframpRates,
  PALREMIT_NETWORK_TO_CHAIN,
  CHAIN_TO_PALREMIT_NETWORK,
} from '@/core/integrations/palremit';
export type { PalremitCurrencyRequestFn } from '@/core/integrations/palremit';
export {
  createPalremitCustomerProfile,
  getPalremitRampOrder,
  listPalremitRampOrders,
  createPalremitCryptoAddressNewUser,
  createPalremitCryptoAddress,
  listPalremitCryptoDeposits,
  createPalremitFiatWithdrawal,
  confirmPalremitFiatWithdrawal,
  preparePalremitCryptoWithdrawal,
  confirmPalremitCryptoWithdrawal,
} from '@/core/integrations/palremitLiquidity';
export type {
  PalremitLiquidityRequestFn,
  PalremitCreateCustomerProfileBody,
  PalremitCustomerProfile,
  PalremitCreateCryptoAddressNewUserBody,
  PalremitCreateCryptoAddressBody,
  PalremitCryptoAddress,
  PalremitCryptoDeposit,
  PalremitCreateFiatWithdrawalBody,
  PalremitPrepareCryptoWithdrawalBody,
} from '@/core/integrations/palremitLiquidity';
