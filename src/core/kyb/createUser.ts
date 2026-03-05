/**
 * Core: create business user. Pure logic; depends on repository (DI).
 * Returns spec §1.1 Create User response shape.
 */

import type {
  CreateUserRequest,
  CreateUserResponse,
  BusinessInfo,
  KYBStatus,
  UserStatus,
} from '../../types/user';

export interface UserRepo {
  createUser(data: CreateUserRequest): Promise<{
    id: string;
    type: string;
    status: UserStatus;
    businessInfo: unknown;
    kybStatus: KYBStatus;
    createdAt: Date;
  }>;
}

function toCreateUserResponse(row: {
  id: string;
  type: string;
  status: UserStatus;
  businessInfo: unknown;
  kybStatus: KYBStatus;
  createdAt: Date;
}): CreateUserResponse {
  const businessInfo = row.businessInfo as BusinessInfo;
  return {
    id: row.id,
    type: row.type as 'business',
    status: row.status,
    businessInfo: {
      legalName: businessInfo.legalName,
      tradingName: businessInfo.tradingName,
      email: businessInfo.email,
    },
    kybStatus: row.kybStatus,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function createBusinessUser(
  repo: UserRepo,
  data: CreateUserRequest
): Promise<CreateUserResponse> {
  const user = await repo.createUser(data);
  return toCreateUserResponse(user);
}
