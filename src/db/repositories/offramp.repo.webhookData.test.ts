import { describe, it, expect, vi } from 'vitest';

vi.mock('@/db/prisma/client', () => ({ prisma: {} }));
vi.mock('@/core/partnerWebhooks', () => ({
  mapOfframpStatusToEvent: vi.fn(),
  schedulePartnerWebhook: vi.fn(),
}));

import { offrampWebhookData, type OfframpRow } from '@/db/repositories/offramp.repo';

function row(destination: unknown): OfframpRow {
  return {
    id: 'off_1',
    userId: 'u_1',
    txnRef: 'OFF-123',
    status: 'COMPLETED',
    destination,
    receipt: null,
    failedReason: null,
    providerRefs: null,
  } as unknown as OfframpRow;
}

describe('offrampWebhookData — partner metadata echo', () => {
  it('echoes the metadata the partner sent on create', () => {
    const data = offrampWebhookData(row({ currency: 'ngn', metadata: { batchId: 'run-42', rowId: 7 } }));
    expect(data.metadata).toEqual({ batchId: 'run-42', rowId: 7 });
  });

  it('omits metadata when none was sent', () => {
    expect('metadata' in offrampWebhookData(row({ currency: 'ngn' }))).toBe(false);
    expect('metadata' in offrampWebhookData(row(null))).toBe(false);
  });

  it('ignores non-object metadata', () => {
    expect('metadata' in offrampWebhookData(row({ metadata: 'run-42' }))).toBe(false);
  });
});
