import { prisma } from '../prisma/client';

/**
 * Ping the database. Used by readiness check only.
 */
export async function pingDb(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}
