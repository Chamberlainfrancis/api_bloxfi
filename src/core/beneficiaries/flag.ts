/** Per-business enablement for Sumsub share-token beneficiary KYC import. */

export const SWIPELUX_BENEFICIARY_KYC_IMPORT_FLAG = 'swipeluxBeneficiaryKycImport';

export function isSwipeluxBeneficiaryKycImportEnabled(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return false;
  return (metadata as Record<string, unknown>)[SWIPELUX_BENEFICIARY_KYC_IMPORT_FLAG] === true;
}
