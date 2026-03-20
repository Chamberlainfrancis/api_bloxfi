/**
 * User & KYB repository. Only layer that touches Prisma for User/KybInfo/KybSubmission/KybRailStatus.
 * Per CURSOR_RULES: all DB access for users goes through this file.
 */

import { prisma } from '@/db/prisma/client';
import type {
  CreateUserRequest,
  UpdateKybRequest,
  SubmitKybRequest,
  KYBStatus,
  UserStatus,
} from '@/types/user';
import { CreateUserConflictError } from '@/types/createUserConflict';
import { normalizeBusinessEmail } from '@/utils/normalizeBusinessEmail';
import { userCreationPayloadsMatch } from '@/db/repositories/userCreationPayload';

export type UserRow = {
  id: string;
  type: string;
  status: UserStatus;
  businessInfo: unknown;
  registeredAddress: unknown;
  legalRepresentative: unknown;
  metadata: unknown;
  creationRequestId: string | null;
  businessEmailNorm: string | null;
  kybStatus: KYBStatus;
  approvedRails: string[];
  createdAt: Date;
  updatedAt: Date;
};

function isPrismaUniqueError(e: unknown): e is { code: string } {
  return (
    typeof e === 'object' &&
    e !== null &&
    'code' in e &&
    (e as { code: string }).code === 'P2002'
  );
}

// --- User CRUD ---

/**
 * Create user: unique normalized business email + idempotent creationRequestId (requestId header).
 * Same requestId + identical payload → { created: false }. Same requestId + different payload → throws.
 */
export async function createUser(data: CreateUserRequest): Promise<{
  user: UserRow;
  created: boolean;
}> {
  const normEmail = normalizeBusinessEmail(data.businessInfo.email);

  const existingByRequest = await prisma.user.findUnique({
    where: { creationRequestId: data.requestId },
  });
  if (existingByRequest) {
    const row = existingByRequest as UserRow;
    if (userCreationPayloadsMatch(row, data)) {
      return { user: row, created: false };
    }
    throw new CreateUserConflictError(
      'REQUEST_ID_MISMATCH',
      'requestId was already used to create a user with different data'
    );
  }

  const existingByEmail = await prisma.user.findUnique({
    where: { businessEmailNorm: normEmail },
  });
  if (existingByEmail) {
    throw new CreateUserConflictError(
      'EMAIL_EXISTS',
      'A user with this business email already exists'
    );
  }

  try {
    const user = await prisma.user.create({
      data: {
        type: data.type,
        status: 'active',
        businessInfo: data.businessInfo as object,
        registeredAddress: data.registeredAddress as object,
        legalRepresentative: data.legalRepresentative as object,
        metadata: data.metadata != null ? (data.metadata as object) : undefined,
        kybStatus: 'not_started',
        approvedRails: [],
        creationRequestId: data.requestId,
        businessEmailNorm: normEmail,
      },
    });
    return { user: user as UserRow, created: true };
  } catch (e) {
    if (!isPrismaUniqueError(e)) {
      throw e;
    }

    const againByRequest = await prisma.user.findUnique({
      where: { creationRequestId: data.requestId },
    });
    if (againByRequest) {
      const row = againByRequest as UserRow;
      if (userCreationPayloadsMatch(row, data)) {
        return { user: row, created: false };
      }
      throw new CreateUserConflictError(
        'REQUEST_ID_MISMATCH',
        'requestId was already used to create a user with different data'
      );
    }

    const againByEmail = await prisma.user.findUnique({
      where: { businessEmailNorm: normEmail },
    });
    if (againByEmail) {
      throw new CreateUserConflictError(
        'EMAIL_EXISTS',
        'A user with this business email already exists'
      );
    }

    throw e;
  }
}

export async function findUserById(id: string): Promise<{
  id: string;
  type: string;
  status: UserStatus;
  businessInfo: unknown;
  registeredAddress: unknown;
  legalRepresentative: unknown;
  metadata: unknown;
  kybStatus: KYBStatus;
  approvedRails: string[];
  createdAt: Date;
  updatedAt: Date;
} | null> {
  const user = await prisma.user.findUnique({
    where: { id },
  });
  return user;
}

export async function updateUser(
  id: string,
  data: { kybStatus?: KYBStatus; approvedRails?: string[]; status?: UserStatus }
): Promise<void> {
  await prisma.user.update({
    where: { id },
    data: {
      ...(data.kybStatus !== undefined && { kybStatus: data.kybStatus }),
      ...(data.approvedRails !== undefined && { approvedRails: data.approvedRails }),
      ...(data.status !== undefined && { status: data.status }),
    },
  });
}

// --- KYB info (POST /users/:userId/kyb) ---

export async function upsertKybInfo(
  userId: string,
  data: UpdateKybRequest
): Promise<void> {
  await prisma.kybInfo.upsert({
    where: { userId },
    create: {
      userId,
      businessDetails: data.businessDetails as object | undefined,
      beneficialOwners: data.beneficialOwners as object | undefined,
      directors: data.directors as object | undefined,
    },
    update: {
      businessDetails: data.businessDetails as object | undefined,
      beneficialOwners: data.beneficialOwners as object | undefined,
      directors: data.directors as object | undefined,
    },
  });
}

// --- KYB submission (POST /users/:userId/kyb/submissions) ---

export async function createKybSubmission(
  userId: string,
  data: SubmitKybRequest,
  estimatedCompletionDate?: Date
): Promise<{
  id: string;
  userId: string;
  rails: string[];
  priority: string | null;
  status: string;
  submittedAt: Date;
  estimatedCompletionDate: Date | null;
}> {
  const submission = await prisma.kybSubmission.create({
    data: {
      userId,
      rails: data.rails,
      priority: data.priority ?? null,
      status: 'under_review',
      estimatedCompletionDate: estimatedCompletionDate ?? null,
    },
  });
  // Create or update KybRailStatus for each rail
  await Promise.all(
    data.rails.map((rail) =>
      prisma.kybRailStatus.upsert({
        where: {
          userId_rail: { userId, rail },
        },
        create: {
          userId,
          rail,
          status: 'under_review',
          submittedAt: new Date(),
        },
        update: {
          status: 'under_review',
          submittedAt: new Date(),
        },
      })
    )
  );
  return submission;
}

// --- KYB status (GET /users/:userId/kyb/status) ---

export async function getKybRailStatuses(
  userId: string,
  railsFilter?: string[]
): Promise<
  Array<{
    rail: string;
    status: string;
    approvedAt: Date | null;
    submittedAt: Date | null;
    capabilities: string[];
  }>
> {
  const where: { userId: string; rail?: { in: string[] } } = { userId };
  if (railsFilter && railsFilter.length > 0) {
    where.rail = { in: railsFilter };
  }
  const rows = await prisma.kybRailStatus.findMany({
    where,
    select: { rail: true, status: true, approvedAt: true, submittedAt: true, capabilities: true },
  });
  return rows;
}

/**
 * Update KYB rail statuses (e.g. from webhook kyb.approved / kyb.status_updated).
 * Optionally update user kybStatus and approvedRails.
 */
export async function updateKybRailStatuses(
  userId: string,
  updates: { rail: string; status: string; approvedAt?: Date }[]
): Promise<void> {
  for (const u of updates) {
    await prisma.kybRailStatus.upsert({
      where: { userId_rail: { userId, rail: u.rail } },
      create: {
        userId,
        rail: u.rail,
        status: u.status,
        approvedAt: u.approvedAt ?? null,
        submittedAt: new Date(),
      },
      update: {
        status: u.status,
        ...(u.approvedAt !== undefined && { approvedAt: u.approvedAt }),
      },
    });
  }
}
