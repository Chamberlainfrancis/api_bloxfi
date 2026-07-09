/**
 * User & KYB repository. Only layer that touches Prisma for User/KybInfo/KybSubmission/KybRailStatus.
 * Per CURSOR_RULES: all DB access for users goes through this file.
 */

import { prisma } from '@/db/prisma/client';
import { Prisma } from '@/generated/prisma/client';
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
  palremitChannelUserId: string | null;
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
 *
 * Uses a transaction-scoped PostgreSQL advisory lock on the normalized email so concurrent
 * sign-ups cannot race past the pre-check; unique indexes remain the final guarantee.
 */
export async function createUser(data: CreateUserRequest): Promise<{
  user: UserRow;
  created: boolean;
}> {
  const normEmail = normalizeBusinessEmail(data.businessInfo.email);

  try {
    return await prisma.$transaction(
      async (tx) => {
        const lockKey = `lock:user_email:${normEmail}`;
        await tx.$executeRaw(
          Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(CAST(${lockKey} AS TEXT)), 0)`
        );

        const existingByRequest = await tx.user.findUnique({
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

        const existingByEmail = await tx.user.findUnique({
          where: { businessEmailNorm: normEmail },
        });
        if (existingByEmail) {
          throw new CreateUserConflictError(
            'EMAIL_EXISTS',
            'A user with this business email already exists'
          );
        }

        const user = await tx.user.create({
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
      },
      { maxWait: 5_000, timeout: 15_000 }
    );
  } catch (e) {
    if (e instanceof CreateUserConflictError) {
      throw e;
    }
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
  palremitChannelUserId: string | null;
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

/** Shallow-merge keys into User.metadata (e.g. Palremit `channel_user_id` from §5.1). */
export async function mergeUserMetadata(userId: string, patch: Record<string, unknown>): Promise<void> {
  const u = await prisma.user.findUnique({ where: { id: userId } });
  const meta =
    u?.metadata != null && typeof u.metadata === 'object' && !Array.isArray(u.metadata)
      ? (u.metadata as Record<string, unknown>)
      : {};
  await prisma.user.update({
    where: { id: userId },
    data: { metadata: { ...meta, ...patch } as object },
  });
}

const PALREMIT_CHANNEL_USER_METADATA_KEY = 'palremitChannelUserId';

/**
 * First successful writer persists Palremit §5.1 `channel_user_id` on User and mirrors to metadata.
 * Returns true if this call stored the id (new), false if another value was already set.
 */
export async function setPalremitChannelUserIdIfAbsent(
  userId: string,
  channelUserId: string
): Promise<boolean> {
  const trimmed = channelUserId.trim();
  if (!trimmed) return false;

  const result = await prisma.user.updateMany({
    where: { id: userId, palremitChannelUserId: null },
    data: { palremitChannelUserId: trimmed },
  });
  if (result.count > 0) {
    await mergeUserMetadata(userId, { [PALREMIT_CHANNEL_USER_METADATA_KEY]: trimmed });
    return true;
  }
  return false;
}

/** Palremit Liquidity crypto user id for offramp §5.2 address reuse. */
export async function getPalremitChannelUserId(userId: string): Promise<string | null> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { palremitChannelUserId: true },
  });
  const v = u?.palremitChannelUserId?.trim();
  return v && v.length > 0 ? v : null;
}

export interface BusinessSearchRow {
  id: string;
  legalName: string;
  email: string | null;
  kybStatus: KYBStatus;
  createdAt: string;
  lastTransactedAt: string | null;
}

export interface ListBusinessesParams {
  q?: string;
  limit?: number;
  createdBefore?: Date;
}

function mapUserToBusinessRow(
  u: {
    id: string;
    businessInfo: unknown;
    businessEmailNorm: string | null;
    kybStatus: KYBStatus;
    createdAt: Date;
  },
  lastTransactedAt?: Date | null
): BusinessSearchRow {
  const info = (u.businessInfo ?? {}) as { legalName?: string; tradingName?: string; email?: string };
  return {
    id: u.id,
    legalName: info.tradingName || info.legalName || '(unnamed business)',
    email: u.businessEmailNorm ?? info.email ?? null,
    kybStatus: u.kybStatus,
    createdAt: u.createdAt.toISOString(),
    lastTransactedAt: lastTransactedAt ? lastTransactedAt.toISOString() : null,
  };
}

async function getLastTransactedAtByUserIds(userIds: string[]): Promise<Map<string, Date>> {
  if (userIds.length === 0) return new Map();
  const [onramps, offramps] = await Promise.all([
    prisma.onramp.groupBy({
      by: ['userId'],
      where: { userId: { in: userIds } },
      _max: { createdAt: true },
    }),
    prisma.offramp.groupBy({
      by: ['userId'],
      where: { userId: { in: userIds } },
      _max: { createdAt: true },
    }),
  ]);
  const result = new Map<string, Date>();
  for (const row of onramps) {
    const d = row._max.createdAt;
    if (d) result.set(row.userId, d);
  }
  for (const row of offramps) {
    const d = row._max.createdAt;
    if (!d) continue;
    const prev = result.get(row.userId);
    if (!prev || d > prev) result.set(row.userId, d);
  }
  return result;
}

function businessSearchWhere(q: string): Prisma.UserWhereInput {
  return {
    OR: [
      { businessEmailNorm: { contains: q.toLowerCase() } },
      { businessInfo: { path: ['legalName'], string_contains: q, mode: 'insensitive' } },
      { businessInfo: { path: ['tradingName'], string_contains: q, mode: 'insensitive' } },
    ],
  };
}

/**
 * Paginated business list for the admin dashboard. Optional `q` filters by
 * name or email; without `q`, returns the newest businesses first.
 */
export async function listUsers(params: ListBusinessesParams = {}): Promise<{
  users: BusinessSearchRow[];
  nextCursor: Date | null;
}> {
  const limit = params.limit && params.limit > 0 ? Math.min(params.limit, 50) : 25;
  const q = params.q?.trim();
  const where: Prisma.UserWhereInput = {};
  if (q) Object.assign(where, businessSearchWhere(q));
  if (params.createdBefore) {
    where.createdAt = { lt: params.createdBefore };
  }

  const users = await prisma.user.findMany({
    where,
    select: { id: true, businessInfo: true, businessEmailNorm: true, kybStatus: true, createdAt: true },
    take: limit + 1,
    orderBy: { createdAt: 'desc' },
  });
  const hasMore = users.length > limit;
  const page = hasMore ? users.slice(0, limit) : users;
  const nextCursor = hasMore && page.length > 0 ? page[page.length - 1]!.createdAt : null;
  const lastTransacted = await getLastTransactedAtByUserIds(page.map((u) => u.id));
  return {
    users: page.map((u) => mapUserToBusinessRow(u, lastTransacted.get(u.id) ?? null)),
    nextCursor,
  };
}

/**
 * Ops-facing business lookup by name or email (case-insensitive, partial
 * match). Backs the admin dashboard's "Businesses" tab so ops don't need
 * to already know a business's raw User.id.
 */
export async function searchUsers(query: string, limit = 20): Promise<BusinessSearchRow[]> {
  const q = query.trim();
  if (!q) return [];
  const { users } = await listUsers({ q, limit });
  return users;
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
