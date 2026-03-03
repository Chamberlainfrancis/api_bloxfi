/**
 * Create or refresh an API key for a partner. Run from project root:
 *   npx ts-node scripts/create-api-key.ts <partnerId> [environment]
 * If the partner already has a key for this environment, existing key(s) are deactivated and a new one is created.
 * Environment defaults to "production"; use "sandbox" for sandbox.
 * The raw key is printed once; store it securely (min 32 chars per spec).
 */
import 'dotenv/config';
import { randomBytes } from 'crypto';
import { hashApiKey, createApiKey, deactivateKeysForPartner } from '../src/db/repositories/apiKey.repo';

const ALPHANUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function generateSecureKey(length: number): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += ALPHANUM[bytes[i]! % ALPHANUM.length];
  }
  return out;
}

async function main() {
  const partnerId = process.argv[2];
  const environment = (process.argv[3] ?? 'production').toLowerCase();
  if (!partnerId) {
    console.error('Usage: npx ts-node scripts/create-api-key.ts <partnerId> [environment]');
    process.exit(1);
  }
  if (!['sandbox', 'production'].includes(environment)) {
    console.error('Environment must be "sandbox" or "production".');
    process.exit(1);
  }

  const rawKey = generateSecureKey(32);
  const keyHash = hashApiKey(rawKey);
  const keyPrefix = rawKey.slice(0, 8);

  const deactivated = await deactivateKeysForPartner(partnerId, environment);
  await createApiKey({ keyHash, keyPrefix, partnerId, environment });

  if (deactivated > 0) {
    console.log(`Refreshed key for existing partner (${deactivated} old key(s) deactivated).`);
  } else {
    console.log('API key created.');
  }
  console.log('Store this key securely; it will not be shown again.');
  console.log('Raw key (32 chars):', rawKey);
  console.log('Partner ID:', partnerId);
  console.log('Environment:', environment);
  console.log('Header: Authorization: Bearer', rawKey);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
