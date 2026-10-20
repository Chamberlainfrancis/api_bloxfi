import { describe, it, expect } from 'vitest';
import { senderNameFromRow } from './senderName';

describe('senderNameFromRow', () => {
  it('prefers the name stored at initiation', () => {
    expect(
      senderNameFromRow(
        { palremitOrchestrator: { senderName: ' Cupaforb ' } },
        { withdrawal: { sender_name: 'Other' } },
      ),
    ).toBe('Cupaforb');
  });

  it('falls back to receipt.withdrawal.sender_name', () => {
    expect(senderNameFromRow({ palremitOrchestrator: {} }, { withdrawal: { sender_name: 'Cupaforb' } })).toBe(
      'Cupaforb',
    );
  });

  it('is null for manual completions, missing and blank values', () => {
    expect(senderNameFromRow(null, { provider: 'palremit', completedAt: 'x', completedManually: true })).toBeNull();
    expect(senderNameFromRow({ palremitOrchestrator: { senderName: '  ' } }, null)).toBeNull();
    expect(senderNameFromRow(undefined, { withdrawal: { sender_name: null } })).toBeNull();
  });
});
