-- BloxFi txnRef + webhook idempotency

ALTER TABLE "Onramp" ADD COLUMN IF NOT EXISTS "txnRef" TEXT;
ALTER TABLE "Onramp" ADD COLUMN IF NOT EXISTS "providerRefs" JSONB;

CREATE UNIQUE INDEX IF NOT EXISTS "Onramp_txnRef_key" ON "Onramp"("txnRef");

ALTER TABLE "Offramp" ADD COLUMN IF NOT EXISTS "txnRef" TEXT;
ALTER TABLE "Offramp" ADD COLUMN IF NOT EXISTS "providerRefs" JSONB;

CREATE UNIQUE INDEX IF NOT EXISTS "Offramp_txnRef_key" ON "Offramp"("txnRef");

CREATE TABLE IF NOT EXISTS "WebhookDedupe" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookDedupe_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "WebhookDedupe_dedupeKey_key" ON "WebhookDedupe"("dedupeKey");
