/**
 * Core: get user by id. Returns spec §1.2 Get User response shape.
 */

import type {
  GetUserResponse,
  BusinessInfo,
  EntityType,
  KYBStatus,
  UserStatus,
} from '../../types/user';

export interface UserRepoGet {
  findUserById(id: string): Promise<{
    id: string;
    type: string;
    status: UserStatus;
    businessInfo: unknown;
    kybStatus: KYBStatus;
    approvedRails: string[];
    createdAt: Date;
    updatedAt: Date;
  } | null>;
}

function toGetUserResponse(row: NonNullable<Awaited<ReturnType<UserRepoGet['findUserById']>>>): GetUserResponse {
  const businessInfo = row.businessInfo as BusinessInfo & { entityType?: EntityType };
  return {
    id: row.id,
    type: row.type as 'business',
    status: row.status,
    businessInfo: {
      legalName: businessInfo.legalName,
      tradingName: businessInfo.tradingName,
      registrationNumber: businessInfo.registrationNumber,
      entityType: (businessInfo.entityType ?? 'LIMITED_COMPANY') as EntityType,
      email: businessInfo.email,
    },
    kybStatus: row.kybStatus,
    approvedRails: row.approvedRails ?? [],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getBusinessUser(
  repo: UserRepoGet,
  userId: string
): Promise<GetUserResponse | null> {
  const user = await repo.findUserById(userId);
  if (!user) return null;
  return toGetUserResponse(user);
}
