-- Allow several markup rows per currency and direction, one per group of
-- coins (e.g. USD offramps: USDT 25 bps, USDC 20 bps). The app makes sure no
-- coin is in two rows for the same currency and direction. Existing rows are
-- not changed, so prices stay the same.

-- DropIndex
DROP INDEX "PairMarkupSetting_fiat_side_key";

-- CreateIndex
CREATE INDEX "PairMarkupSetting_fiat_side_idx" ON "PairMarkupSetting"("fiat", "side");
