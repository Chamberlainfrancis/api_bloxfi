-- Convert ExternalWallet.chain from enum to string
ALTER TABLE "ExternalWallet"
  ALTER COLUMN "chain" TYPE TEXT
  USING "chain"::text;

-- Drop enum type if no longer referenced
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BlockchainNetwork') THEN
    DROP TYPE "BlockchainNetwork";
  END IF;
END$$;

