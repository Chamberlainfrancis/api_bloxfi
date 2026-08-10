-- AlterTable
ALTER TABLE "Account" ADD COLUMN "providerIssuanceStatus" TEXT,
ADD COLUMN "provisionedAccountId" TEXT,
ADD COLUMN "depositDetails" JSONB,
ADD COLUMN "providerIssuanceFailureReason" TEXT;

-- CreateIndex
CREATE INDEX "Account_provisionedAccountId_idx" ON "Account"("provisionedAccountId");

-- CreateIndex
CREATE INDEX "Account_providerIssuanceStatus_idx" ON "Account"("providerIssuanceStatus");
