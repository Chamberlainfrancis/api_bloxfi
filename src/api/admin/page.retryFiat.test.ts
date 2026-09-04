import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const PAGE_SRC = readFileSync(path.join(__dirname, 'page.ts'), 'utf8');

function openDetailSource(src: string): string {
  const start = src.indexOf('async function openDetail(');
  expect(start).toBeGreaterThan(-1);
  const next = src.indexOf('\nasync function mark(', start + 1);
  return src.slice(start, next === -1 ? undefined : next);
}

describe('admin dashboard fiat payout retry UI', () => {
  it('disables retry while Palremit is still processing', () => {
    const open = openDetailSource(PAGE_SRC);
    const processingIdx = open.indexOf('still processing. Retry is disabled');
    const reissueIdx = open.indexOf('payoutRetryFormHtml(true)');
    const handoffIdx = open.indexOf('payoutRetryFormHtml(false)');
    expect(processingIdx).toBeGreaterThan(-1);
    expect(reissueIdx).toBeGreaterThan(processingIdx);
    expect(handoffIdx).toBeGreaterThan(reissueIdx);
    const processingBlock = open.slice(processingIdx, reissueIdx);
    expect(processingBlock).not.toContain('payoutRetryFormHtml');
  });
});
