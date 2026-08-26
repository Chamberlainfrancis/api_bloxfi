import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const PAGE_SRC = readFileSync(path.join(__dirname, 'page.ts'), 'utf8');

function sliceFn(src: string, startNeedle: string): string {
  const start = src.indexOf(startNeedle);
  expect(start).toBeGreaterThan(-1);
  return src.slice(start, start + 2800);
}

describe('admin dashboard fee settlement approve modal', () => {
  it('renders one modal that states the payout and collects the passcode', () => {
    expect(PAGE_SRC).toContain('id="approveFeeModal"');
    expect(PAGE_SRC).toContain('id="approveFeePasscode"');
    expect(PAGE_SRC).toContain('id="approveFeeConfirm"');
    expect(PAGE_SRC).toContain('id="approveFeeSummary"');
    expect(PAGE_SRC).toContain('id="approveFeeMsg"');
  });

  it('does not use a native confirm or a toolbar passcode for list approve', () => {
    expect(PAGE_SRC).not.toContain('id="pagePasscode"');
    const openFn = sliceFn(PAGE_SRC, 'function openApproveFeeModal(');
    expect(openFn).not.toContain('confirm(');
    expect(openFn).toContain('showModal');
  });

  it('keeps approve errors inside the modal so the admin can see them', () => {
    const submitFn = sliceFn(PAGE_SRC, 'async function submitApproveFee(');
    expect(submitFn).not.toContain('confirm(');
    expect(submitFn).toContain('showApproveFeeMsg');
    expect(submitFn).toContain('approveFeePasscode');
  });
});
