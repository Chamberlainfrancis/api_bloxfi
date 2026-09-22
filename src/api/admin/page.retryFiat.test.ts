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

function retryFiatPayoutSource(src: string): string {
  const start = src.indexOf('async function retryFiatPayout(');
  expect(start).toBeGreaterThan(-1);
  const next = src.indexOf('\nasync function ', start + 1);
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

  it('keeps retry errors visible after the detail panel is rebuilt', () => {
    expect(PAGE_SRC).toContain('id="dInlineMsg"');
    expect(PAGE_SRC.indexOf('id="dInlineMsg"')).toBeLessThan(PAGE_SRC.indexOf('id="dBody"'));
    const open = openDetailSource(PAGE_SRC);
    expect(open).toContain('if (flash && flash.msg) showDetailMsg(flash.msg, flash.kind)');
    const retry = retryFiatPayoutSource(PAGE_SRC);
    const catchIdx = retry.indexOf('} catch (e) {');
    const errorBlock = retry.slice(catchIdx);
    expect(errorBlock).toContain('showDetailMsg(errMsg, "bad")');
    expect(errorBlock).not.toContain('openDetail(');
  });
});
