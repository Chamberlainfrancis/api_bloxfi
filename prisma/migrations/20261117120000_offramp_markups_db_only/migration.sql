-- Offramp markups live only in PairMarkupSetting (no rates in code), and an
-- offramp with no saved sell markup is refused. Every offramp currency is set
-- to 20 bps, except GBP which keeps its current 12 bps for now (Emmanuel,
-- 2026-11-17).

-- AlterTable
ALTER TABLE "PairMarkupSetting" ADD COLUMN "requireProviderRate" BOOLEAN NOT NULL DEFAULT true;

-- Existing sell rows (EUR, USD, CAD, JPY, AUD) → 20 bps (GBP 12 if one was
-- added by hand). They keep requiring the payout provider's live rate.
UPDATE "PairMarkupSetting"
SET "markupBps" = CASE WHEN "fiat" = 'GBP' THEN 12 ELSE 20 END,
    "updatedBy" = 'migration', "updatedAt" = CURRENT_TIMESTAMP
WHERE "side" = 'sell';

-- A sell row for GBP and every other currency an offramp has ever paid out in:
-- 20 bps, GBP 12 bps (the currency-api B2B markup it was priced at until now).
-- These pairs used the currency-api B2B rate and never required a provider
-- rate, so requireProviderRate stays false for them.
INSERT INTO "PairMarkupSetting" ("id", "fiat", "side", "cryptos", "markupBps", "requireProviderRate", "updatedBy", "createdAt", "updatedAt")
SELECT
    gen_random_uuid()::text,
    c.fiat,
    'sell',
    CASE WHEN c.fiat = 'USD' THEN 'USDT,USDC' ELSE 'USD,USDT,USDC' END,
    CASE WHEN c.fiat = 'GBP' THEN 12 ELSE 20 END,
    false,
    'migration',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM (
    SELECT DISTINCT UPPER(TRIM("destination"->>'currency')) AS fiat
    FROM "Offramp"
    WHERE "destination"->>'currency' IS NOT NULL
    UNION
    SELECT 'GBP'
) c
WHERE c.fiat ~ '^[A-Z]{3}$'
ON CONFLICT ("fiat", "side") DO NOTHING;
