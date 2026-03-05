-- Feature 4: Accounts / Fiat (spec §3)

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "railType" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "paymentRail" TEXT NOT NULL,
    "accountType" TEXT NOT NULL,
    "accountHolder" JSONB NOT NULL,
    "regionDetails" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Account_userId_idx" ON "Account"("userId");

-- CreateIndex
CREATE INDEX "Account_userId_railType_idx" ON "Account"("userId", "railType");

-- CreateIndex
CREATE INDEX "Account_userId_accountType_idx" ON "Account"("userId", "accountType");

-- CreateIndex
CREATE INDEX "Account_userId_currency_idx" ON "Account"("userId", "currency");

-- CreateIndex
CREATE INDEX "Account_userId_createdAt_idx" ON "Account"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
