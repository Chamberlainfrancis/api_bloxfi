/**
 * One-off: inspect _prisma_migrations + User email duplicates (read-only).
 * Usage: npx ts-node -r tsconfig-paths/register scripts/diagnose-failed-migration.ts
 */
import 'dotenv/config';
import { PrismaClient } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

async function main(): Promise<void> {
  const migrations = await prisma.$queryRaw<
    { migration_name: string; finished_at: Date | null; rolled_back_at: Date | null; logs: string | null }[]
  >`SELECT migration_name, finished_at, rolled_back_at, logs
    FROM "_prisma_migrations"
    ORDER BY started_at`;

  console.log('--- _prisma_migrations ---');
  for (const m of migrations) {
    console.log(
      JSON.stringify({
        migration_name: m.migration_name,
        finished_at: m.finished_at,
        rolled_back_at: m.rolled_back_at,
        logs: m.logs ? m.logs.slice(0, 500) : null,
      })
    );
  }

  const cols = await prisma.$queryRaw<{ column_name: string }[]>`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'User'
      AND column_name IN ('creationRequestId', 'businessEmailNorm', 'palremitChannelUserId')
    ORDER BY column_name`;
  console.log('\n--- User columns (relevant) ---', cols.map((c) => c.column_name));

  const indexes = await prisma.$queryRaw<{ indexname: string }[]>`
    SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'User'
    ORDER BY indexname`;
  console.log(
    '\n--- User indexes ---',
    indexes.map((i) => i.indexname)
  );

  const dups = await prisma.$queryRaw<{ norm: string; c: bigint }[]>`
    SELECT lower(trim("businessInfo"->>'email')) AS norm, count(*)::bigint AS c
    FROM "User"
    WHERE "businessInfo"->>'email' IS NOT NULL AND trim("businessInfo"->>'email') <> ''
    GROUP BY 1
    HAVING count(*) > 1`;
  console.log('\n--- Duplicate business emails (norm) ---', dups);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
