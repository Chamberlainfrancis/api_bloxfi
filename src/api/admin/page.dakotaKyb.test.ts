import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const PAGE_SRC = readFileSync(path.join(__dirname, 'page.ts'), 'utf8');

describe('admin dashboard Dakota KYB tab', () => {
  it('adds a Dakota KYB tab and attest POST that never embeds an application token', () => {
    expect(PAGE_SRC).toContain('data-view="dakota"');
    expect(PAGE_SRC).toContain('/dakota/applications');
    expect(PAGE_SRC).toContain('submitDakotaAttest');
    expect(PAGE_SRC).not.toContain('application_url');
    expect(PAGE_SRC).not.toContain('x-application-token');
  });
});
