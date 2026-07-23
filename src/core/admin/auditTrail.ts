/**
 * Synthesizes a chronological audit trail for admin transaction detail views
 * from persisted row fields (timeline, providerRefs, fees, receipt, admin actions).
 */

export type AuditTxnType = 'onramp' | 'offramp';

export type AuditTrailSeverity = 'info' | 'success' | 'warning' | 'error' | 'admin';

export interface AuditTrailEvent {
  at: string;
  severity: AuditTrailSeverity;
  label: string;
  detail?: string | null;
}

interface AdminActionInput {
  fromStatus: string;
  toStatus: string;
  note?: string | null;
  actor?: string | null;
  createdAt: Date | string;
}

interface AuditRowInput {
  status: string;
  createdAt: Date | string;
  updatedAt?: Date | string;
  failedReason?: string | null;
  providerRefs?: unknown;
  timeline?: unknown;
  receipt?: unknown;
  depositInfo?: unknown;
  depositInstructions?: unknown;
  fees?: unknown;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value != null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function isoAt(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== 'string' || !value.trim()) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function pushEvent(
  events: AuditTrailEvent[],
  at: unknown,
  severity: AuditTrailSeverity,
  label: string,
  detail?: string | null
): void {
  const ts = isoAt(at);
  if (!ts) return;
  events.push({ at: ts, severity, label, detail: detail ?? null });
}

function orchRefs(providerRefs: unknown): Record<string, unknown> {
  return asRecord(asRecord(providerRefs).palremitOrchestrator);
}

function adminDetail(action: AdminActionInput): string | null {
  const parts = [
    action.actor ? `by ${action.actor}` : null,
    action.note ? action.note : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' — ') : null;
}

function isFeeAdminAction(action: AdminActionInput): boolean {
  return action.fromStatus.startsWith('fee:') || action.toStatus.startsWith('fee:');
}

function formatFeeAdminLabel(action: AdminActionInput): string {
  if (action.fromStatus === 'fee:pending' && action.toStatus === 'fee:processing') {
    return 'Platform fee settlement approved';
  }
  if (action.fromStatus === 'fee:failed' && action.toStatus === 'fee:processing') {
    return 'Platform fee settlement retried';
  }
  if (action.toStatus === 'fee:failed' || action.toStatus === 'fee:skipped') {
    return 'Platform fee settlement approval failed';
  }
  return `Platform fee: ${action.fromStatus.replace(/^fee:/, '')} → ${action.toStatus.replace(/^fee:/, '')}`;
}

function addFeeSettlementEvents(events: AuditTrailEvent[], fees: unknown): void {
  const pf = asRecord(asRecord(fees).platformFee);
  if (!Object.keys(pf).length) return;

  const settlement = asRecord(pf.settlement);
  const status = typeof settlement.status === 'string' ? settlement.status : '';
  if (!status) return;

  const amount =
    typeof pf.amount === 'string' && pf.amount
      ? `${pf.amount} ${String(pf.currency ?? pf.settlementCurrency ?? 'USDC').toUpperCase()}`
      : 'platform fee';
  const wallet = typeof pf.walletAddress === 'string' ? pf.walletAddress : '';
  const network = typeof pf.settlementNetwork === 'string' ? pf.settlementNetwork : '';
  const dest = wallet ? `${amount} → ${wallet}${network ? ` (${network})` : ''}` : amount;
  const notes = Array.isArray(settlement.notes)
    ? settlement.notes.filter((n): n is string => typeof n === 'string' && n.trim() !== '')
    : [];
  const noteText = notes.length ? notes.join('; ') : null;
  const withdrawalId =
    typeof settlement.withdrawalId === 'string' ? settlement.withdrawalId : null;
  const txHash =
    typeof settlement.transactionHash === 'string'
      ? settlement.transactionHash
      : typeof pf.transactionHash === 'string'
        ? pf.transactionHash
        : null;

  switch (status) {
    case 'pending':
      pushEvent(
        events,
        settlement.attemptedAt,
        'warning',
        'Platform fee queued for admin approval',
        dest
      );
      break;
    case 'processing':
      pushEvent(
        events,
        settlement.attemptedAt,
        'info',
        'Platform fee settlement sent to Palremit',
        [dest, withdrawalId ? `withdrawal ${withdrawalId}` : null].filter(Boolean).join(' · ') || null
      );
      break;
    case 'completed':
      pushEvent(
        events,
        settlement.attemptedAt,
        'info',
        'Platform fee settlement initiated',
        [dest, withdrawalId ? `withdrawal ${withdrawalId}` : null].filter(Boolean).join(' · ') || null
      );
      pushEvent(
        events,
        settlement.completedAt ?? settlement.attemptedAt,
        'success',
        'Platform fee settlement completed',
        txHash ? `tx ${txHash}` : null
      );
      break;
    case 'failed':
      pushEvent(
        events,
        settlement.attemptedAt,
        'info',
        'Platform fee settlement initiated',
        [dest, withdrawalId ? `withdrawal ${withdrawalId}` : null].filter(Boolean).join(' · ') || null
      );
      pushEvent(
        events,
        settlement.completedAt ?? settlement.attemptedAt,
        'error',
        'Platform fee settlement failed',
        noteText ?? 'Palremit withdrawal failed'
      );
      break;
    case 'skipped':
      pushEvent(
        events,
        settlement.attemptedAt,
        'warning',
        'Platform fee settlement skipped',
        noteText
      );
      break;
    default:
      break;
  }
}

function addOnrampLpEvents(events: AuditTrailEvent[], row: AuditRowInput): void {
  const orch = orchRefs(row.providerRefs);
  const receipt = asRecord(row.receipt);

  if (row.depositInfo) {
    pushEvent(events, row.createdAt, 'info', 'Fiat deposit instructions issued');
  }

  const depositStatus = typeof orch.depositStatus === 'string' ? orch.depositStatus : '';
  if (depositStatus === 'credited') {
    pushEvent(events, row.updatedAt, 'success', 'Fiat deposit credited by Palremit');
  } else if (depositStatus === 'failed') {
    pushEvent(events, row.updatedAt, 'error', 'Fiat deposit failed at Palremit');
  } else if (depositStatus === 'active') {
    pushEvent(events, row.createdAt, 'info', 'Palremit provisioned account active');
  }

  const withdrawalStatus =
    typeof orch.withdrawalStatus === 'string' ? orch.withdrawalStatus.toLowerCase() : '';
  const withdrawalId =
    typeof orch.palremitWithdrawalId === 'string' ? orch.palremitWithdrawalId : null;

  if (withdrawalStatus === 'pending' || withdrawalId) {
    pushEvent(
      events,
      orch.completedAt ?? row.updatedAt,
      'info',
      'Crypto payout initiated at Palremit',
      withdrawalId ? `withdrawal ${withdrawalId}` : null
    );
  }

  if (withdrawalStatus === 'successful') {
    const txHash =
      typeof receipt.transactionHash === 'string'
        ? receipt.transactionHash
        : typeof receipt.destinationTxId === 'string'
          ? receipt.destinationTxId
          : null;
    pushEvent(
      events,
      orch.completedAt ?? receipt.completedAt ?? row.updatedAt,
      'success',
      orch.markedManually ? 'Crypto payout marked successful (manual)' : 'Crypto payout completed',
      txHash ? `tx ${txHash}` : withdrawalId ? `withdrawal ${withdrawalId}` : null
    );
  }

  if (withdrawalStatus === 'failed') {
    pushEvent(
      events,
      row.updatedAt,
      'error',
      orch.markedManually ? 'Crypto payout marked failed (manual)' : 'Crypto payout failed',
      row.failedReason ?? null
    );
  }
}

function addOfframpLpEvents(events: AuditTrailEvent[], row: AuditRowInput): void {
  const orch = orchRefs(row.providerRefs);
  const timeline = asRecord(row.timeline);

  if (row.depositInstructions) {
    pushEvent(events, timeline.createdAt ?? row.createdAt, 'info', 'Crypto deposit address issued');
  }

  if (timeline.cryptoReceivedAt) {
    pushEvent(events, timeline.cryptoReceivedAt, 'info', 'Partial crypto deposit received');
  }
  if (timeline.lastDepositCreditedAt) {
    pushEvent(events, timeline.lastDepositCreditedAt, 'info', 'Crypto deposit credited (partial or full)');
  }
  if (timeline.cryptoConfirmedAt) {
    pushEvent(events, timeline.cryptoConfirmedAt, 'success', 'Crypto deposit confirmed');
  } else if (orch.depositStatus === 'credited') {
    pushEvent(events, row.updatedAt, 'success', 'Crypto deposit confirmed by Palremit');
  } else if (orch.depositStatus === 'partial') {
    pushEvent(events, row.updatedAt, 'warning', 'Partial crypto deposit at Palremit');
  }

  const payoutError =
    typeof timeline.fiatPayoutLastError === 'string'
      ? timeline.fiatPayoutLastError.trim()
      : typeof orch.fiatPayoutLastError === 'string'
        ? orch.fiatPayoutLastError.trim()
        : '';
  if (payoutError) {
    pushEvent(
      events,
      timeline.fiatPayoutLastErrorAt ?? orch.fiatPayoutLastErrorAt ?? row.updatedAt,
      'error',
      'Fiat payout rejected by Palremit',
      payoutError
    );
  }

  const withdrawalStatus =
    typeof orch.withdrawalStatus === 'string' ? orch.withdrawalStatus.toLowerCase() : '';
  const withdrawalId =
    typeof orch.palremitWithdrawalId === 'string'
      ? orch.palremitWithdrawalId
      : typeof timeline.fiatWithdrawalId === 'string'
        ? timeline.fiatWithdrawalId
        : null;

  if (timeline.fiatInitiatedAt || withdrawalStatus === 'pending' || withdrawalId) {
    pushEvent(
      events,
      timeline.fiatInitiatedAt ?? row.updatedAt,
      'info',
      'Fiat payout initiated at Palremit',
      withdrawalId ? `withdrawal ${withdrawalId}` : null
    );
  }

  if (withdrawalStatus === 'successful' || timeline.fiatWithdrawalCompleted === true) {
    pushEvent(
      events,
      timeline.completedAt ?? orch.completedAt ?? row.updatedAt,
      'success',
      orch.markedManually ? 'Fiat payout marked successful (manual)' : 'Fiat payout completed',
      withdrawalId ? `withdrawal ${withdrawalId}` : null
    );
  }

  if (withdrawalStatus === 'failed') {
    pushEvent(
      events,
      row.updatedAt,
      'error',
      orch.markedManually ? 'Fiat payout marked failed (manual)' : 'Fiat payout failed',
      row.failedReason ?? null
    );
  }

  if (timeline.cancelledAt) {
    pushEvent(events, timeline.cancelledAt, 'warning', 'Transaction cancelled');
  }

  addFeeSettlementEvents(events, row.fees);
}

function addTerminalFailure(events: AuditTrailEvent[], row: AuditRowInput, type: AuditTxnType): void {
  if (!row.failedReason) return;
  const failStatuses =
    type === 'offramp'
      ? new Set(['FAILED', 'FIAT_FAILED', 'CRYPTO_FAILED', 'EXPIRED', 'CANCELLED'])
      : new Set(['FIAT_FAILED', 'CRYPTO_FAILED', 'FIAT_RETURNED', 'EXPIRED']);
  if (!failStatuses.has(row.status)) return;

  const orch = orchRefs(row.providerRefs);
  const withdrawalStatus =
    typeof orch.withdrawalStatus === 'string' ? orch.withdrawalStatus.toLowerCase() : '';
  if (withdrawalStatus === 'failed') return;

  pushEvent(events, row.updatedAt, 'error', `Transaction failed (${row.status})`, row.failedReason);
}

export function buildAuditTrail(
  type: AuditTxnType,
  row: AuditRowInput,
  adminActions: AdminActionInput[] = []
): AuditTrailEvent[] {
  const events: AuditTrailEvent[] = [];

  pushEvent(events, row.createdAt, 'info', 'Transaction created', `Status: ${row.status}`);

  for (const action of adminActions) {
    if (isFeeAdminAction(action)) {
      pushEvent(
        events,
        action.createdAt,
        'admin',
        formatFeeAdminLabel(action),
        adminDetail(action)
      );
      continue;
    }
    const fiatReceived =
      (action.fromStatus === 'AWAITING_FUNDS' || action.fromStatus === 'FIAT_PENDING') &&
      action.toStatus === 'FIAT_PROCESSED';
    pushEvent(
      events,
      action.createdAt,
      'admin',
      fiatReceived
        ? 'Fiat deposit marked received'
        : `Manual status change: ${action.fromStatus} → ${action.toStatus}`,
      adminDetail(action)
    );
  }

  if (type === 'offramp') {
    addOfframpLpEvents(events, row);
  } else {
    addOnrampLpEvents(events, row);
  }

  addTerminalFailure(events, row, type);

  events.sort((a, b) => a.at.localeCompare(b.at));
  return events;
}
