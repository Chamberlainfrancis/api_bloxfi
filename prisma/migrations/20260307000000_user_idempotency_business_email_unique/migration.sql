-- Idempotent user creation (requestId) + unique business email (normalized).
ALTER TABLE "User" ADD COLUMN "creationRequestId" TEXT;
ALTER TABLE "User" ADD COLUMN "businessEmailNorm" TEXT;

-- Backfill from existing businessInfo.email so the unique index applies to historical rows.
-- Fails if duplicate emails already exist; resolve duplicates before migrating.
UPDATE "User"
SET "businessEmailNorm" = lower(trim("businessInfo"->>'email'))
WHERE "businessEmailNorm" IS NULL
  AND "businessInfo"->>'email' IS NOT NULL
  AND TRIM("businessInfo"->>'email') <> '';

CREATE UNIQUE INDEX "User_creationRequestId_key" ON "User"("creationRequestId");
CREATE UNIQUE INDEX "User_businessEmailNorm_key" ON "User"("businessEmailNorm");
