-- Onramp platform fee persisted in fees JSON (same shape as offramp, no settlement payout).
ALTER TABLE "Onramp" ADD COLUMN IF NOT EXISTS "fees" JSONB;
