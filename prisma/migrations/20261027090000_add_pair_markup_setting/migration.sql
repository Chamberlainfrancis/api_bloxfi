-- CreateTable
CREATE TABLE "PairMarkupSetting" (
    "id" TEXT NOT NULL,
    "fiat" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "cryptos" TEXT NOT NULL,
    "markupBps" DOUBLE PRECISION NOT NULL,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PairMarkupSetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PairMarkupSetting_fiat_side_key" ON "PairMarkupSetting"("fiat", "side");

-- Seed with the rules in core/quotes/pairMarkup.config.ts so pricing is
-- unchanged on deploy.
INSERT INTO "PairMarkupSetting" ("id", "fiat", "side", "cryptos", "markupBps", "updatedBy", "createdAt", "updatedAt") VALUES
    ('c4b8dd39-ad48-4fad-8082-48ffcdb4c844', 'EUR', 'buy', 'USD,USDT,USDC', 240, 'migration', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('fd9f7327-1b24-4656-a2fb-b5c0981e26ef', 'EUR', 'sell', 'USD,USDT,USDC', 20, 'migration', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('f076d5c6-7bb2-414c-926b-0b3a64e0d8d8', 'USD', 'sell', 'USDT,USDC', 20, 'migration', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('446f4a54-2c23-4ee7-8e92-d4537eb48e1f', 'CAD', 'buy', 'USD,USDT,USDC', 50, 'migration', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('46022e27-691c-4e23-a369-8fcbdef7213a', 'CAD', 'sell', 'USD,USDT,USDC', 20, 'migration', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('78b4caf5-7436-4521-94cb-5abdcde2436a', 'JPY', 'buy', 'USD,USDT,USDC', 50, 'migration', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('75e05986-637e-4c04-9922-31cd27ac54eb', 'JPY', 'sell', 'USD,USDT,USDC', 50, 'migration', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('30f73ec0-6ab5-4f4d-ba6b-946e5c1cf962', 'AUD', 'buy', 'USD,USDT,USDC', 50, 'migration', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('d1164b41-f09a-4411-90ec-fb0543661954', 'AUD', 'sell', 'USD,USDT,USDC', 50, 'migration', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('8a18a52a-e06c-40d0-b266-6751d0492470', 'GBP', 'buy', 'USD,USDT,USDC', 45, 'migration', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
