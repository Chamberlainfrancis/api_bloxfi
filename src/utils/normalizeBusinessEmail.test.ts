import { describe, it, expect } from 'vitest';
import { normalizeBusinessEmail } from '@/utils/normalizeBusinessEmail';

describe('normalizeBusinessEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeBusinessEmail('  Admin@Acme.com  ')).toBe('admin@acme.com');
  });
});
