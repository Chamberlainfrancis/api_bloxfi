/**
 * Dev DB cleanup: keep Postman user + env API key partner row; remove other users and stale data.
 *
 *   npx ts-node scripts/cleanup-db.ts [--dry-run]
 */
import 'dotenv/config';
import { createHash } from 'crypto';
import { prisma } from '@/db/prisma/client';

const KEEP_USER_ID = '2902e329-424e-4cba-b07b-346ec74b7124';
const PARTNER_ID = 'bloxfi-postman';
const API_KEY_ENV = process.env.API_KEY?.trim();

function hashApiKey(plainKey: string): string {
  return createHash('sha256').update(plainKey, 'utf8').digest('hex');
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  if (!API_KEY_ENV || API_KEY_ENV.length < 32) {
    console.error('API_KEY must be set in .env (min 32 chars)');
    process.exit(1);
  }

  const keepUser = await prisma.user.findUnique({ where: { id: KEEP_USER_ID } });
  if (!keepUser) {
    console.error(`Keep user ${KEEP_USER_ID} not found in DB. Aborting.`);
    process.exit(1);
  }

  const otherUsers = await prisma.user.findMany({
    where: { id: { not: KEEP_USER_ID } },
    select: { id: true, businessEmailNorm: true },
  });

  const keepUserRamps = {
    onramps: await prisma.onramp.count({ where: { userId: KEEP_USER_ID } }),
    offramps: await prisma.offramp.count({ where: { userId: KEEP_USER_ID } }),
  };

  const apiKeys = await prisma.apiKey.findMany({
    select: { id: true, partnerId: true, keyPrefix: true, isActive: true, environment: true },
  });

  const keyHash = hashApiKey(API_KEY_ENV);
  const keyPrefix = API_KEY_ENV.slice(0, 8);

  const webhookLogs = await prisma.webhookInboundLog.count();
  const webhookDedupe = await prisma.webhookDedupe.count();

  const fileIdsInUse = new Set(
    (await prisma.kybDocument.findMany({ select: { fileId: true } })).map((d) => d.fileId)
  );
  const allFiles = await prisma.file.findMany({ select: { id: true } });
  const orphanFiles = allFiles.filter((f) => !fileIdsInUse.has(f.id));

  console.log('--- Planned cleanup ---');
  console.log('Keep user:', KEEP_USER_ID, keepUser.businessEmailNorm ?? '(no email)');
  console.log('Delete other users:', otherUsers.length, otherUsers.map((u) => u.id).join(', ') || '(none)');
  console.log('Delete keep-user onramps/offramps:', keepUserRamps);
  console.log('Truncate webhook logs:', webhookLogs, 'dedupe:', webhookDedupe);
  console.log('Delete orphan files:', orphanFiles.length);
  console.log('ApiKey rows now:', apiKeys.length, '→ keep 1 for partner', PARTNER_ID);
  console.log(dryRun ? '\n[DRY RUN — no writes]\n' : '\n[Applying…]\n');

  if (dryRun) return;

  await prisma.$transaction(async (tx) => {
    if (otherUsers.length > 0) {
      await tx.user.deleteMany({ where: { id: { not: KEEP_USER_ID } } });
    }

    await tx.onramp.deleteMany({ where: { userId: KEEP_USER_ID } });
    await tx.offramp.deleteMany({ where: { userId: KEEP_USER_ID } });
    await tx.highValueRequest.deleteMany({ where: { userId: KEEP_USER_ID } });

    if (orphanFiles.length > 0) {
      await tx.file.deleteMany({ where: { id: { in: orphanFiles.map((f) => f.id) } } });
    }

    await tx.webhookInboundLog.deleteMany();
    await tx.webhookDedupe.deleteMany();

    await tx.apiKey.deleteMany();
    await tx.apiKey.create({
      data: {
        keyHash,
        keyPrefix,
        partnerId: PARTNER_ID,
        environment: 'sandbox',
        isActive: true,
      },
    });
  });

  const after = {
    users: await prisma.user.count(),
    accounts: await prisma.account.count(),
    apiKeys: await prisma.apiKey.findMany({
      select: { partnerId: true, keyPrefix: true, isActive: true, environment: true },
    }),
    onramps: await prisma.onramp.count(),
    offramps: await prisma.offramp.count(),
  };

  console.log('Done.');
  console.log(JSON.stringify(after, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
