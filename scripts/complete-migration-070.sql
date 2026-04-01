-- Complete failed 20260307000000: unique index was the only step that did not apply.
CREATE UNIQUE INDEX IF NOT EXISTS "User_businessEmailNorm_key" ON "User"("businessEmailNorm");
