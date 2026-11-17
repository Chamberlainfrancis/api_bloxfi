-- Offramp markups live only in PairMarkupSetting (no rates in code), and an
-- offramp with no saved sell markup is refused. Every offramp currency is set
-- to 20 bps (Emmanuel, 2026-11-17).

-- AlterTable
ALTER TABLE "PairMarkupSetting" ADD COLUMN "requireProviderRate" BOOLEAN NOT NULL DEFAULT true;

-- Existing sell rows (EUR, USD, CAD, JPY, AUD) → 20 bps. They keep requiring
-- the payout provider's live rate, as before.
UPDATE "PairMarkupSetting"
SET "markupBps" = 20, "updatedBy" = 'migration', "updatedAt" = CURRENT_TIMESTAMP
WHERE "side" = 'sell';

-- A 20 bps sell row for every other currency an offramp has ever paid out in
-- (GBP, NGN, ...). These pairs used the currency-api B2B rate until now and
-- never required a provider rate, so requireProviderRate stays false for them.
INSERT INTO "PairMarkupSetting" ("id", "fiat", "side", "cryptos", "markupBps", "requireProviderRate", "updatedBy", "createdAt", "updatedAt")
SELECT
    gen_random_uuid()::text,
    c.fiat,
    'sell',
    CASE WHEN c.fiat = 'USD' THEN 'USDT,USDC' ELSE 'USD,USDT,USDC' END,
    20,
    false,
    'migration',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM (
    SELECT DISTINCT UPPER(TRIM("destination"->>'currency')) AS fiat
    FROM "Offramp"
    WHERE "destination"->>'currency' IS NOT NULL
) c
WHERE c.fiat ~ '^[A-Z]{3}$'
ON CONFLICT ("fiat", "side") DO NOTHING;
