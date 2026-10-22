import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const PAGE_SRC = readFileSync(path.join(__dirname, 'page.ts'), 'utf8');

describe('admin dashboard sender info UI', () => {
  it('has a Sender info tab wired to the sender-info endpoints', () => {
    expect(PAGE_SRC).toContain('data-view="senderinfo">Sender info</div>');
    expect(PAGE_SRC).toContain('api("/sender-info")');
    expect(PAGE_SRC).toContain('api("/sender-info", {');
    expect(PAGE_SRC).toContain('method: "PUT"');
    expect(PAGE_SRC).toContain('api("/sender-info/" + encodeURIComponent(id), {');
    expect(PAGE_SRC).toContain('method: "DELETE"');
  });

  it('gates saves and deletes behind the shared dashboard passcode', () => {
    expect(PAGE_SRC).toContain('id="siPasscode"');
    const save = PAGE_SRC.slice(PAGE_SRC.indexOf('async function saveSenderInfo('), PAGE_SRC.indexOf('async function deleteSenderInfo('));
    expect(save).toContain('"x-dashboard-secret": secret');
    expect(save).toContain('Enter the dashboard passcode, then save.');
    const del = PAGE_SRC.slice(PAGE_SRC.indexOf('async function deleteSenderInfo('), PAGE_SRC.indexOf('$("siReload")'));
    expect(del).toContain('"x-dashboard-secret": secret');
    expect(del).toContain('confirm(');
  });

  it('explains what the name is used for and that it only affects new transfers', () => {
    expect(PAGE_SRC).toContain('Applies to new transfers only.');
    expect(PAGE_SRC).toContain('payout sender');
    expect(PAGE_SRC).toContain('deposit details');
  });
});
