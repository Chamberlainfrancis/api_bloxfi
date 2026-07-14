/**
 * OnrampBeneficiary persistence — Sumsub share-token KYC import mapping.
 * Soft-replays creationRequestId like User.createUser (matching identity → reuse).
 */

import { prisma } from '@/db/prisma/client';
import { Prisma, type OnrampBeneficiary, type OnrampBeneficiaryStatus } from '@/generated/prisma/client';
import { CreateUserConflictError } from '@/types/createUserConflict';

export type OnrampBeneficiaryRow = OnrampBeneficiary;

export interface CreateOnrampBeneficiaryData {
  id?: string;
  businessUserId: string;
  creationRequestId: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  identitySnapshot?: Record<string, unknown>;
  status: OnrampBeneficiaryStatus;
  swipeluxCustomerId?: string | null;
}

function identityMatches(
  row: OnrampBeneficiary,
  data: CreateOnrampBeneficiaryData
): boolean {
  return (
    row.businessUserId === data.businessUserId &&
    row.email === data.email &&
    row.firstName === data.firstName &&
    row.lastName === data.lastName &&
    row.phone === data.phone
  );
}

export async function findOnrampBeneficiaryByRequestId(
  requestId: string
): Promise<OnrampBeneficiary | null> {
  return prisma.onrampBeneficiary.findUnique({ where: { creationRequestId: requestId } });
}

export async function findOnrampBeneficiaryByIdForBusiness(
  id: string,
  businessUserId: string
): Promise<OnrampBeneficiary | null> {
  return prisma.onrampBeneficiary.findFirst({
    where: { id, businessUserId },
  });
}

export async function listOnrampBeneficiariesForBusiness(
  businessUserId: string
): Promise<OnrampBeneficiary[]> {
  return prisma.onrampBeneficiary.findMany({
    where: { businessUserId },
    orderBy: { createdAt: 'desc' },
  });
}

export async function createOnrampBeneficiary(
  data: CreateOnrampBeneficiaryData
): Promise<{ row: OnrampBeneficiary; created: boolean }> {
  const existing = await prisma.onrampBeneficiary.findUnique({
    where: { creationRequestId: data.creationRequestId },
  });
  if (existing) {
    if (identityMatches(existing, data)) {
      return { row: existing, created: false };
    }
    throw new CreateUserConflictError(
      'REQUEST_ID_MISMATCH',
      'requestId was already used to create a beneficiary with different data'
    );
  }

  try {
    const row = await prisma.onrampBeneficiary.create({
      data: {
        ...(data.id ? { id: data.id } : {}),
        businessUserId: data.businessUserId,
        creationRequestId: data.creationRequestId,
        email: data.email,
        firstName: data.firstName,
        lastName: data.lastName,
        phone: data.phone,
        identitySnapshot:
          data.identitySnapshot != null
            ? (data.identitySnapshot as Prisma.InputJsonValue)
            : undefined,
        status: data.status,
        swipeluxCustomerId: data.swipeluxCustomerId ?? null,
      },
    });
    return { row, created: true };
  } catch (e) {
    const again = await prisma.onrampBeneficiary.findUnique({
      where: { creationRequestId: data.creationRequestId },
    });
    if (again) {
      if (identityMatches(again, data)) {
        return { row: again, created: false };
      }
      throw new CreateUserConflictError(
        'REQUEST_ID_MISMATCH',
        'requestId was already used to create a beneficiary with different data'
      );
    }
    throw e;
  }
}

export async function updateOnrampBeneficiaryStatus(
  id: string,
  patch: { status: OnrampBeneficiaryStatus; swipeluxCustomerId?: string | null }
): Promise<OnrampBeneficiary> {
  return prisma.onrampBeneficiary.update({
    where: { id },
    data: {
      status: patch.status,
      ...(patch.swipeluxCustomerId !== undefined
        ? { swipeluxCustomerId: patch.swipeluxCustomerId }
        : {}),
    },
  });
}
