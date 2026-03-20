-- POST /users: idempotency (creationRequestId) + one user per business email (businessEmailNorm + JSON expression index).
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "creationRequestId" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "businessEmailNorm" TEXT;

UPDATE "User"
SET "businessEmailNorm" = lower(trim("businessInfo"->>'email'))
WHERE "businessEmailNorm" IS NULL
  AND "businessInfo"->>'email' IS NOT NULL
  AND trim("businessInfo"->>'email') <> '';

-- Fails if duplicate emails exist in existing rows; dedupe before migrate.
CREATE UNIQUE INDEX IF NOT EXISTS "User_creationRequestId_key" ON "User"("creationRequestId");
CREATE UNIQUE INDEX IF NOT EXISTS "User_businessEmailNorm_key" ON "User"("businessEmailNorm");

CREATE UNIQUE INDEX IF NOT EXISTS "User_businessInfo_email_normalized_key"
ON "User" ((lower(trim("businessInfo"->>'email'))))
WHERE "businessInfo"->>'email' IS NOT NULL
  AND trim("businessInfo"->>'email') <> '';
