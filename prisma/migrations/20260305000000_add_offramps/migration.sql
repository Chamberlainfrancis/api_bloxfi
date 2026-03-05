-- CreateEnum
CREATE TYPE "OfframpStatusEnum" AS ENUM ('CREATED', 'AWAITING_CRYPTO', 'CRYPTO_RECEIVED', 'FIAT_PENDING', 'COMPLETED', 'CANCELLED', 'CRYPTO_FAILED', 'FIAT_FAILED', 'EXPIRED');

-- CreateTable
CREATE TABLE "Offramp" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "OfframpStatusEnum" NOT NULL DEFAULT 'CREATED',
    "source" JSONB NOT NULL,
    "destination" JSONB NOT NULL,
    "rateInformation" JSONB NOT NULL,
    "depositInstructions" JSONB,
    "timeline" JSONB,
    "fees" JSONB,
    "receipt" JSONB,
    "refundDetails" JSONB,
    "failedReason" TEXT,
    "lpReference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Offramp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Offramp_requestId_key" ON "Offramp"("requestId");

-- CreateIndex
CREATE INDEX "Offramp_userId_idx" ON "Offramp"("userId");

-- CreateIndex
CREATE INDEX "Offramp_userId_status_idx" ON "Offramp"("userId", "status");

-- CreateIndex
CREATE INDEX "Offramp_userId_createdAt_idx" ON "Offramp"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "Offramp" ADD CONSTRAINT "Offramp_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
