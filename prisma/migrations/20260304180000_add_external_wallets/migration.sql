-- Feature 3: External Wallets (spec §2)

-- CreateEnum
CREATE TYPE "BlockchainNetwork" AS ENUM ('POLYGON', 'ETHEREUM', 'BASE', 'SOLANA', 'ARBITRUM', 'OPTIMISM', 'AVALANCHE', 'BNB_CHAIN');

-- CreateTable
CREATE TABLE "ExternalWallet" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "chain" "BlockchainNetwork" NOT NULL,
    "name" TEXT NOT NULL,
    "referenceId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "ExternalWallet_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExternalWallet_userId_idx" ON "ExternalWallet"("userId");

-- CreateIndex
CREATE INDEX "ExternalWallet_userId_createdAt_idx" ON "ExternalWallet"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalWallet_userId_address_chain_key" ON "ExternalWallet"("userId", "address", "chain");

-- AddForeignKey
ALTER TABLE "ExternalWallet" ADD CONSTRAINT "ExternalWallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
