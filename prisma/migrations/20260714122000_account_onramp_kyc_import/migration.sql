-- Additive-only: Account gains onramp SwipeLux KYC-import fields (nullable).
-- providerPayout/currency/paymentRail become nullable to support onramp rows,
-- which carry no payout destination. No existing offramp row data is touched.

-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "creationRequestId" TEXT,
ADD COLUMN     "kycImportStatus" TEXT,
ADD COLUMN     "swipeluxCustomerId" TEXT,
ALTER COLUMN "currency" DROP NOT NULL,
ALTER COLUMN "paymentRail" DROP NOT NULL,
ALTER COLUMN "providerPayout" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Account_creationRequestId_key" ON "Account"("creationRequestId");
