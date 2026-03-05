/**
 * Core: get KYB status. Returns spec §1.7 Get KYB Status response shape.
 */

import type { GetKybStatusResponse, KYBStatus, RailStatusItem } from '../../types/user';

export interface UserRepoGetKybStatus {
  findUserById(id: string): Promise<{ id: string; kybStatus: string } | null>;
  getKybRailStatuses(userId: string, railsFilter?: string[]): Promise<
    Array<{
      rail: string;
      status: string;
      approvedAt: Date | null;
      submittedAt: Date | null;
      capabilities: string[];
    }>
  >;
}

/** Derive overall status from rail statuses: approved if any approved, under_review if any under_review, etc. */
function deriveOverallStatus(railStatuses: Array<{ status: string }>): KYBStatus {
  const statuses = new Set(railStatuses.map((r) => r.status));
  if (statuses.has('approved') && statuses.size === 1) return 'approved';
  if (statuses.has('rejected')) return 'rejected';
  if (statuses.has('approved') || statuses.has('under_review')) return statuses.has('under_review') ? 'under_review' : 'approved';
  if (statuses.has('under_review')) return 'under_review';
  if (statuses.has('incomplete')) return 'incomplete';
  return 'not_started';
}

function toRailStatusItem(row: {
  rail: string;
  status: string;
  approvedAt: Date | null;
  submittedAt: Date | null;
  capabilities: string[];
}): RailStatusItem {
  const item: RailStatusItem = { rail: row.rail, status: row.status };
  if (row.approvedAt) item.approvedAt = row.approvedAt.toISOString();
  if (row.submittedAt) item.submittedAt = row.submittedAt.toISOString();
  if (row.capabilities?.length) item.capabilities = row.capabilities;
  return item;
}

export async function getKybStatus(
  repo: UserRepoGetKybStatus,
  userId: string,
  railsFilter?: string[]
): Promise<GetKybStatusResponse | null> {
  const user = await repo.findUserById(userId);
  if (!user) return null;

  const railRows = await repo.getKybRailStatuses(userId, railsFilter);
  const railStatuses: RailStatusItem[] = railRows.map(toRailStatusItem);
  const overallStatus = railStatuses.length > 0
    ? deriveOverallStatus(railRows)
    : (user.kybStatus as KYBStatus);

  const lastUpdated =
    railRows.length > 0
      ? railRows
          .map((r) => (r.approvedAt ?? r.submittedAt)?.getTime() ?? 0)
          .reduce((a, b) => Math.max(a, b), 0)
      : Date.now();

  return {
    userId,
    overallStatus,
    railStatuses,
    lastUpdated: new Date(lastUpdated).toISOString(),
  };
}
