/**
 * User & KYB repository. Only layer that touches Prisma for User/KybInfo/KybSubmission/KybRailStatus.
 * Per CURSOR_RULES: all DB access for users goes through this file.
 */

import { prisma } from '../prisma/client';
import type {
  CreateUserRequest,
  UpdateKybRequest,
  SubmitKybRequest,
  KYBStatus,
  UserStatus,
} from '../../types/user';

// --- User CRUD ---

export async function createUser(data: CreateUserRequest): Promise<{
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
}> {
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
    },
  });
  return user as ReturnType<typeof createUser> extends Promise<infer R> ? R : never;
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