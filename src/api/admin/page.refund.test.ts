import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { renderDashboardHtml } from '@/api/admin/page';

const PAGE_SRC = readFileSync(path.join(__dirname, 'page.ts'), 'utf8');

function fnSource(name: string): string {
  const start = PAGE_SRC.indexOf(name);
  expect(start).toBeGreaterThan(-1);
  const next = PAGE_SRC.indexOf('\nfunction ', start + 1);
  const nextAsync = PAGE_SRC.indexOf('\nasync function ', start + 1);
  const ends = [next, nextAsync].filter((i) => i > -1);
  return PAGE_SRC.slice(start, ends.length ? Math.min(...ends) : undefined);
}

describe('admin dashboard mark-as-refunded UI', () => {
  const html = renderDashboardHtml('nonce');

  it('has a Refunds tab with a count and a refund dialog with the audit fields', () => {
    expect(html).toContain('data-view="refunds"');
    expect(html).toContain('id="refundCount"');
    for (const id of ['refundModal', 'refundNote', 'refundActor', 'refundPasscode', 'refundTx', 'refundAmount', 'refundAt', 'refundAck']) {
      expect(html).toContain(`id="${id}"`);
    }
  });

  it('posts to the mark-refunded endpoint and never uses prompt/confirm (blocked inside <dialog>)', () => {
    const submit = fnSource('async function submitRefund()');
    expect(submit).toContain('/mark-refunded');
    expect(submit).not.toContain('prompt(');
    expect(submit).not.toContain('confirm(');
  });

  it('keeps the embedded script parseable', () => {
    const js = html.split('<script nonce="nonce">')[1].split('</script>')[0];
    expect(() => new Function(js)).not.toThrow();
  });
});
