-- One row per business email from JSON source of truth (aligned with normalizeBusinessEmail: trim + lower).
-- Complements "User_businessEmailNorm_key"; prevents duplicates even if businessEmailNorm were missing/out of sync.
-- Fails on apply if duplicate emails already exist in businessInfo — dedupe rows first.
CREATE UNIQUE INDEX "User_businessInfo_email_normalized_key"
ON "User" ((lower(trim("businessInfo"->>'email'))))
WHERE "businessInfo"->>'email' IS NOT NULL
  AND trim("businessInfo"->>'email') <> '';
