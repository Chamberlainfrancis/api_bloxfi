-- CreateTable
CREATE TABLE "SenderInfoSetting" (
    "id" TEXT NOT NULL,
    "rampType" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "rail" TEXT NOT NULL DEFAULT '',
    "senderName" TEXT NOT NULL,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SenderInfoSetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SenderInfoSetting_rampType_currency_rail_key" ON "SenderInfoSetting"("rampType", "currency", "rail");
