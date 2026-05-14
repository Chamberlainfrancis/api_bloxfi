-- Optional withdrawal memo/tag per external wallet (onramp crypto payout to LP).
ALTER TABLE "ExternalWallet" ADD COLUMN "memo" TEXT;
