-- CreateEnum
CREATE TYPE "RampQuoteTypeEnum" AS ENUM ('offramp', 'onramp');

-- CreateTable
CREATE TABLE "RampQuote" (
    "id" TEXT NOT NULL,
    "rampType" "RampQuoteTypeEnum" NOT NULL,
    "payload" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RampQuote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RampQuote_expiresAt_idx" ON "RampQuote"("expiresAt");

-- CreateIndex
CREATE INDEX "RampQuote_rampType_consumedAt_idx" ON "RampQuote"("rampType", "consumedAt");
