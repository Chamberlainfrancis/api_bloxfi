import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const PAGE_SRC = readFileSync(path.join(__dirname, 'page.ts'), 'utf8');

function fnSource(src: string, signature: string): string {
  const start = src.indexOf(signature);
  expect(start).toBeGreaterThan(-1);
  const next = src.indexOf('\nfunction ', start + 1);
  const nextAsync = src.indexOf('\nasync function ', start + 1);
  const cuts = [next, nextAsync].filter((i) => i > start);
  const end = cuts.length ? Math.min(...cuts) : src.length;
  return src.slice(start, end);
}

describe('admin dashboard fee settlement approve from the list', () => {
  it('has a page-level passcode field (list Approve has no detail dialog fields)', () => {
    expect(PAGE_SRC).toContain('id="pagePasscode"');
  });

  it('reads pagePasscode before dialog-only passcode fields', () => {
    const src = fnSource(PAGE_SRC, 'function readPasscode()');
    expect(src.indexOf('pagePasscode')).toBeLessThan(src.indexOf('markPasscode'));
    expect(src).toContain('pagePasscode');
  });

  it('shows a missing passcode on the page banner, not only in the closed detail dialog', () => {
    const src = fnSource(PAGE_SRC, 'function requirePasscode(actionLabel)');
    expect(src).toContain('showErr');
  });

  it('reports approve 401 and other failures on the page banner', () => {
    const start = PAGE_SRC.indexOf('async function approveSettlement(');
    expect(start).toBeGreaterThan(-1);
    const src = PAGE_SRC.slice(start, start + 2200);
    expect(src).toContain('showErr("Incorrect passcode');
    expect(src).toMatch(/showErr\(e\.message/);
  });
});
