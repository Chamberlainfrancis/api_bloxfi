import {
  findOnrampBeneficiaryByIdForBusiness,
  listOnrampBeneficiariesForBusiness,
} from '@/db/repositories/onrampBeneficiary.repo';
import { AppError } from '@/types/errors';
import { toBeneficiaryDto, type BeneficiaryDto } from '@/core/beneficiaries/createBeneficiary';

export async function getOnrampBeneficiary(
  businessUserId: string,
  id: string
): Promise<BeneficiaryDto> {
  const row = await findOnrampBeneficiaryByIdForBusiness(id, businessUserId);
  if (!row) {
    throw new AppError('Beneficiary not found', 'NOT_FOUND', 404);
  }
  return toBeneficiaryDto(row);
}

export async function listOnrampBeneficiaries(businessUserId: string): Promise<BeneficiaryDto[]> {
  const rows = await listOnrampBeneficiariesForBusiness(businessUserId);
  return rows.map(toBeneficiaryDto);
}
