-- CreateEnum
CREATE TYPE "OnrampStatusEnum" AS ENUM ('CREATED', 'AWAITING_FUNDS', 'FIAT_PENDING', 'FIAT_PROCESSED', 'CRYPTO_INITIATED', 'CRYPTO_PENDING', 'COMPLETED', 'FIAT_FAILED', 'FIAT_RETURNED', 'CRYPTO_FAILED', 'EXPIRED');

-- CreateTable
CREATE TABLE "Onramp" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "OnrampStatusEnum" NOT NULL DEFAULT 'CREATED',
    "source" JSONB NOT NULL,
    "destination" JSONB NOT NULL,
    "quoteInformation" JSONB NOT NULL,
    "depositInfo" JSONB,
    "receipt" JSONB,
    "developerFee" JSONB,
    "failedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Onramp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Onramp_requestId_key" ON "Onramp"("requestId");

-- CreateIndex
CREATE INDEX "Onramp_userId_idx" ON "Onramp"("userId");

-- CreateIndex
CREATE INDEX "Onramp_userId_status_idx" ON "Onramp"("userId", "status");

-- CreateIndex
CREATE INDEX "Onramp_userId_createdAt_idx" ON "Onramp"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "Onramp" ADD CONSTRAINT "Onramp_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
