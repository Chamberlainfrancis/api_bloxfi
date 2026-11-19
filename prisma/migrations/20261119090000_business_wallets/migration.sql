-- CreateTable
CREATE TABLE "BusinessWallet" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "walletOnly" BOOLEAN NOT NULL DEFAULT false,
    "whitelistRequired" BOOLEAN NOT NULL DEFAULT false,
    "debitsPaused" BOOLEAN NOT NULL DEFAULT false,
    "pausedReason" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessWallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletDepositAddress" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "chain" TEXT NOT NULL,
    "address" TEXT,
    "memo" TEXT,
    "provisionedAccountId" TEXT,
    "clientReference" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "failureReason" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WalletDepositAddress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletWhitelistAddress" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "chain" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "label" TEXT,
    "addedBy" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),
    "removedBy" TEXT,

    CONSTRAINT "WalletWhitelistAddress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletBalance" (
    "userId" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "available" DECIMAL(38,18) NOT NULL DEFAULT 0,
    "reserved" DECIMAL(38,18) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WalletBalance_pkey" PRIMARY KEY ("userId","asset")
);

-- CreateTable
CREATE TABLE "WalletJournal" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" DECIMAL(38,18) NOT NULL,
    "refType" TEXT,
    "refId" TEXT,
    "actor" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletJournal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletLedgerEntry" (
    "id" TEXT NOT NULL,
    "journalId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "account" TEXT NOT NULL,
    "amount" DECIMAL(38,18) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletDeposit" (
    "id" TEXT NOT NULL,
    "orchestratorDepositId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "chain" TEXT NOT NULL,
    "amount" DECIMAL(38,18) NOT NULL,
    "address" TEXT NOT NULL,
    "senderAddress" TEXT,
    "txId" TEXT,
    "status" TEXT NOT NULL,
    "quarantineReason" TEXT,
    "journalId" TEXT,
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolutionNote" TEXT,
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WalletDeposit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletWithdrawal" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "txnRef" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "chain" TEXT NOT NULL,
    "amount" DECIMAL(38,18) NOT NULL,
    "address" TEXT NOT NULL,
    "memo" TEXT,
    "status" TEXT NOT NULL,
    "orchestratorWithdrawalId" TEXT,
    "txHash" TEXT,
    "failureReason" TEXT,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedBy" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WalletWithdrawal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BusinessWallet_userId_key" ON "BusinessWallet"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "WalletDepositAddress_provisionedAccountId_key" ON "WalletDepositAddress"("provisionedAccountId");

-- CreateIndex
CREATE INDEX "WalletDepositAddress_address_idx" ON "WalletDepositAddress"("address");

-- CreateIndex
CREATE UNIQUE INDEX "WalletDepositAddress_userId_asset_chain_key" ON "WalletDepositAddress"("userId", "asset", "chain");

-- CreateIndex
CREATE INDEX "WalletWhitelistAddress_userId_chain_idx" ON "WalletWhitelistAddress"("userId", "chain");

-- CreateIndex
CREATE UNIQUE INDEX "WalletJournal_idempotencyKey_key" ON "WalletJournal"("idempotencyKey");

-- CreateIndex
CREATE INDEX "WalletJournal_userId_asset_createdAt_idx" ON "WalletJournal"("userId", "asset", "createdAt");

-- CreateIndex
CREATE INDEX "WalletJournal_refType_refId_idx" ON "WalletJournal"("refType", "refId");

-- CreateIndex
CREATE INDEX "WalletLedgerEntry_userId_asset_account_idx" ON "WalletLedgerEntry"("userId", "asset", "account");

-- CreateIndex
CREATE INDEX "WalletLedgerEntry_journalId_idx" ON "WalletLedgerEntry"("journalId");

-- CreateIndex
CREATE UNIQUE INDEX "WalletDeposit_orchestratorDepositId_key" ON "WalletDeposit"("orchestratorDepositId");

-- CreateIndex
CREATE INDEX "WalletDeposit_userId_status_idx" ON "WalletDeposit"("userId", "status");

-- CreateIndex
CREATE INDEX "WalletDeposit_status_createdAt_idx" ON "WalletDeposit"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WalletWithdrawal_requestId_key" ON "WalletWithdrawal"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "WalletWithdrawal_txnRef_key" ON "WalletWithdrawal"("txnRef");

-- CreateIndex
CREATE INDEX "WalletWithdrawal_userId_createdAt_idx" ON "WalletWithdrawal"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "WalletWithdrawal_status_idx" ON "WalletWithdrawal"("status");

-- AddForeignKey
ALTER TABLE "BusinessWallet" ADD CONSTRAINT "BusinessWallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletLedgerEntry" ADD CONSTRAINT "WalletLedgerEntry_journalId_fkey" FOREIGN KEY ("journalId") REFERENCES "WalletJournal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Wallet integrity, enforced by the database (not only the application):
-- 1. Balances can never go negative.
ALTER TABLE "WalletBalance" ADD CONSTRAINT "WalletBalance_available_nonneg" CHECK ("available" >= 0);
ALTER TABLE "WalletBalance" ADD CONSTRAINT "WalletBalance_reserved_nonneg" CHECK ("reserved" >= 0);
ALTER TABLE "WalletJournal" ADD CONSTRAINT "WalletJournal_amount_pos" CHECK ("amount" > 0);
ALTER TABLE "WalletLedgerEntry" ADD CONSTRAINT "WalletLedgerEntry_amount_nonzero" CHECK ("amount" <> 0);
ALTER TABLE "WalletLedgerEntry" ADD CONSTRAINT "WalletLedgerEntry_account_known" CHECK (
  "account" IN ('available', 'reserved', 'external:deposit', 'external:offramp', 'external:withdrawal', 'adjustment')
);

-- 2. The ledger is append-only: no UPDATE or DELETE, ever. Corrections are
--    new journals (type 'adjustment').
CREATE OR REPLACE FUNCTION wallet_ledger_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'wallet ledger is append-only (% on %)', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "WalletJournal_append_only"
  BEFORE UPDATE OR DELETE ON "WalletJournal"
  FOR EACH ROW EXECUTE FUNCTION wallet_ledger_append_only();
CREATE TRIGGER "WalletLedgerEntry_append_only"
  BEFORE UPDATE OR DELETE ON "WalletLedgerEntry"
  FOR EACH ROW EXECUTE FUNCTION wallet_ledger_append_only();

-- 3. Double entry: when a transaction commits, every journal it touched must
--    have postings that sum to exactly zero, at least two postings, and all
--    postings on the journal's own business and asset.
CREATE OR REPLACE FUNCTION wallet_journal_balanced() RETURNS trigger AS $$
DECLARE
  j RECORD;
  total NUMERIC;
  n INT;
  stray INT;
BEGIN
  SELECT * INTO j FROM "WalletJournal" WHERE "id" = NEW."journalId";
  SELECT COALESCE(SUM("amount"), 0), COUNT(*) INTO total, n
    FROM "WalletLedgerEntry" WHERE "journalId" = NEW."journalId";
  SELECT COUNT(*) INTO stray FROM "WalletLedgerEntry"
    WHERE "journalId" = NEW."journalId" AND ("userId" <> j."userId" OR "asset" <> j."asset");
  IF total <> 0 OR n < 2 OR stray > 0 THEN
    RAISE EXCEPTION 'wallet journal % is not balanced (sum %, postings %, stray %)', NEW."journalId", total, n, stray
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "WalletLedgerEntry_balanced"
  AFTER INSERT ON "WalletLedgerEntry"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION wallet_journal_balanced();

-- 4. The cached balance must equal the ledger. Checked at commit for every
--    balance row a transaction changed.
CREATE OR REPLACE FUNCTION wallet_balance_matches_ledger() RETURNS trigger AS $$
DECLARE
  cur RECORD;
  avail NUMERIC;
  resv NUMERIC;
BEGIN
  -- Deferred: NEW is the row as it was at that statement; read it as it is now.
  SELECT "available", "reserved" INTO cur FROM "WalletBalance"
    WHERE "userId" = NEW."userId" AND "asset" = NEW."asset";
  SELECT COALESCE(SUM("amount") FILTER (WHERE "account" = 'available'), 0),
         COALESCE(SUM("amount") FILTER (WHERE "account" = 'reserved'), 0)
    INTO avail, resv
    FROM "WalletLedgerEntry" WHERE "userId" = NEW."userId" AND "asset" = NEW."asset";
  IF avail <> cur."available" OR resv <> cur."reserved" THEN
    RAISE EXCEPTION 'wallet balance %/% does not match ledger (cache %/%, ledger %/%)',
      NEW."userId", NEW."asset", cur."available", cur."reserved", avail, resv
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "WalletBalance_matches_ledger"
  AFTER INSERT OR UPDATE ON "WalletBalance"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION wallet_balance_matches_ledger();

-- 5. Balance rows are never deleted.
CREATE TRIGGER "WalletBalance_no_delete"
  BEFORE DELETE ON "WalletBalance"
  FOR EACH ROW EXECUTE FUNCTION wallet_ledger_append_only();

-- An address is whitelisted at most once per business and chain at a time.
CREATE UNIQUE INDEX "WalletWhitelistAddress_active_key"
  ON "WalletWhitelistAddress"("userId", "chain", "address") WHERE "removedAt" IS NULL;
