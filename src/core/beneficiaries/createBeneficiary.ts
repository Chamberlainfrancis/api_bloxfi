/**
 * Create an individual OnrampBeneficiary and import Sumsub share-token KYC via liquidity.
 */

import { randomUUID } from 'node:crypto';
import { AppError } from '@/types/errors';
import { isSwipeluxBeneficiaryKycImportEnabled } from '@/core/beneficiaries/flag';
import type {
  SwipeluxBeneficiaryKycInput,
  SwipeluxKycImportResult,
} from '@/core/integrations/palremitSwipeluxKycImport';
import type {
  createOnrampBeneficiary,
  findOnrampBeneficiaryByRequestId,
  updateOnrampBeneficiaryStatus,
} from '@/db/repositories/onrampBeneficiary.repo';
import type { OnrampBeneficiary, OnrampBeneficiaryStatus } from '@/generated/prisma/client';

export interface BeneficiaryDto {
  id: string;
  userId: string;
  status: OnrampBeneficiaryStatus;
  swipeluxCustomerId: string | null;
  customerType: 'individual';
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  createdAt: string;
  updatedAt: string;
}

export function toBeneficiaryDto(row: OnrampBeneficiary): BeneficiaryDto {
  return {
    id: row.id,
    userId: row.businessUserId,
    status: row.status,
    swipeluxCustomerId: row.swipeluxCustomerId,
    customerType: 'individual',
    email: row.email,
    firstName: row.firstName,
    lastName: row.lastName,
    phone: row.phone,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapLiquidityStatus(status: string): OnrampBeneficiaryStatus {
  const s = status.toLowerCase();
  if (s === 'approved') return 'approved';
  if (s === 'rejected') return 'rejected';
  if (s === 'pending' || s === 'not_started') return 'pending_import';
  return 'failed';
}

export interface CreateBeneficiaryDeps {
  findUserById: (id: string) => Promise<{ id: string; metadata: unknown } | null>;
  findByRequestId: typeof findOnrampBeneficiaryByRequestId;
  createRow: typeof createOnrampBeneficiary;
  updateStatus: typeof updateOnrampBeneficiaryStatus;
  importKyc: (body: {
    clientReference: string;
    importToken: string;
    kycInput: SwipeluxBeneficiaryKycInput;
  }) => Promise<SwipeluxKycImportResult>;
}

export interface CreateBeneficiaryInput {
  businessUserId: string;
  requestId: string;
  sumsubShareToken: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
}

export async function createOnrampBeneficiaryWithImport(
  deps: CreateBeneficiaryDeps,
  input: CreateBeneficiaryInput
): Promise<{ response: BeneficiaryDto; created: boolean }> {
  const user = await deps.findUserById(input.businessUserId);
  if (!user) {
    throw new AppError('User not found', 'NOT_FOUND', 404);
  }
  if (!isSwipeluxBeneficiaryKycImportEnabled(user.metadata)) {
    throw new AppError(
      'SwipeLux beneficiary KYC import is not enabled for this business',
      'FORBIDDEN',
      403
    );
  }

  const existing = await deps.findByRequestId(input.requestId);
  if (existing) {
    const match =
      existing.businessUserId === input.businessUserId &&
      existing.email === input.email &&
      existing.firstName === input.firstName &&
      existing.lastName === input.lastName &&
      existing.phone === input.phone;
    if (!match) {
      throw new AppError(
        'requestId was already used with different beneficiary data',
        'CONFLICT',
        409
      );
    }
    return { response: toBeneficiaryDto(existing), created: false };
  }

  const id = randomUUID();
  const { row, created } = await deps.createRow({
    id,
    businessUserId: input.businessUserId,
    creationRequestId: input.requestId,
    email: input.email,
    firstName: input.firstName,
    lastName: input.lastName,
    phone: input.phone,
    status: 'pending_import',
  });

  if (!created) {
    return { response: toBeneficiaryDto(row), created: false };
  }

  const importResult = await deps.importKyc({
    clientReference: row.id,
    importToken: input.sumsubShareToken,
    kycInput: {
      customer_type: 'individual',
      email: input.email,
      first_name: input.firstName,
      last_name: input.lastName,
      phone: input.phone,
    },
  });

  if (!importResult.ok) {
    await deps.updateStatus(row.id, { status: 'failed' });
    const statusCode = importResult.status >= 500 || importResult.status === 0 ? 502 : 422;
    throw new AppError(
      statusCode === 502
        ? 'Beneficiary KYC import could not be completed right now'
        : 'Beneficiary KYC import was rejected',
      statusCode === 502 ? 'BAD_GATEWAY' : 'UNPROCESSABLE_ENTITY',
      statusCode
    );
  }

  const mapped = mapLiquidityStatus(importResult.value.status);
  const updated = await deps.updateStatus(row.id, {
    status: mapped,
    swipeluxCustomerId: importResult.value.channel_customer_id,
  });

  return { response: toBeneficiaryDto(updated), created: true };
}
