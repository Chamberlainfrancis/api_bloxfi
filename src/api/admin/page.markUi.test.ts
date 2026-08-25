import { readFileSync } from 'fs';
import path from 'path';

/**
 * The dashboard detail view is a modal <dialog>. Chrome/Safari return null
 * immediately from window.prompt/confirm while a dialog is open, so Mark
 * Successful must collect note + passcode from in-dialog fields.
 */
const PAGE_SRC = readFileSync(path.join(__dirname, 'page.ts'), 'utf8');

function markFunctionSource(src: string): string {
  const start = src.indexOf('async function mark(id, outcome, withdrawalProcessing)');
  expect(start).toBeGreaterThan(-1);
  const next = src.indexOf('\nasync function ', start + 1);
  return src.slice(start, next === -1 ? undefined : next);
}

function markCardSource(src: string): string {
  const start = src.indexOf('Mark this transaction');
  expect(start).toBeGreaterThan(-1);
  const markOk = src.indexOf('id="markOk"', start);
  expect(markOk).toBeGreaterThan(start);
  return src.slice(start, markOk);
}

describe('admin dashboard mark-as-completed UI', () => {
  it('does not use prompt/confirm inside mark() (blocked by <dialog>)', () => {
    const markFn = markFunctionSource(PAGE_SRC);
    expect(markFn).not.toContain('prompt(');
    expect(markFn).not.toContain('confirm(');
  });

  it('renders passcode, note, and inline error fields on the mark card', () => {
    const card = markCardSource(PAGE_SRC);
    expect(card).toContain('markPasscode');
    expect(card).toContain('markNote');
    expect(card).toContain('markActionMsg');
  });
});
