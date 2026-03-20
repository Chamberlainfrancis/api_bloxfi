-- Revert idempotency / denormalized email columns (restore User to JSON-only business identity).
DROP INDEX IF EXISTS "User_businessInfo_email_normalized_key";
DROP INDEX IF EXISTS "User_creationRequestId_key";
DROP INDEX IF EXISTS "User_businessEmailNorm_key";

ALTER TABLE "User" DROP COLUMN IF EXISTS "creationRequestId";
ALTER TABLE "User" DROP COLUMN IF EXISTS "businessEmailNorm";
