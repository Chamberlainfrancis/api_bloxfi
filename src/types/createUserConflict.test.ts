import { describe, it, expect } from 'vitest';
import { CreateUserConflictError } from '@/types/createUserConflict';

describe('CreateUserConflictError', () => {
  it('is instanceof with kind', () => {
    const e = new CreateUserConflictError('EMAIL_EXISTS', 'duplicate');
    expect(e).toBeInstanceOf(CreateUserConflictError);
    expect(e.kind).toBe('EMAIL_EXISTS');
    expect(e.message).toBe('duplicate');
  });
});
