-- Drop redundant denormalized bank summary; derived from providerPayout in application code.
ALTER TABLE "Account" DROP COLUMN "regionDetails";

-- All payout accounts must have corridor-backed provider payload.
ALTER TABLE "Account" ALTER COLUMN "providerPayout" SET NOT NULL;
