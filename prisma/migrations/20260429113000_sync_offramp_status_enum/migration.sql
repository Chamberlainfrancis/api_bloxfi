-- Bring production enum values in sync with prisma/schema.prisma.
-- This is safe to run even if some values already exist.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'OfframpStatusEnum' AND e.enumlabel = 'CRYPTO_PENDING'
  ) THEN
    ALTER TYPE "OfframpStatusEnum" ADD VALUE 'CRYPTO_PENDING';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'OfframpStatusEnum' AND e.enumlabel = 'CRYPTO_CONFIRMED'
  ) THEN
    ALTER TYPE "OfframpStatusEnum" ADD VALUE 'CRYPTO_CONFIRMED';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'OfframpStatusEnum' AND e.enumlabel = 'PROCESSING_FEE'
  ) THEN
    ALTER TYPE "OfframpStatusEnum" ADD VALUE 'PROCESSING_FEE';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'OfframpStatusEnum' AND e.enumlabel = 'FEE_PROCESSED'
  ) THEN
    ALTER TYPE "OfframpStatusEnum" ADD VALUE 'FEE_PROCESSED';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'OfframpStatusEnum' AND e.enumlabel = 'FIAT_INITIATED'
  ) THEN
    ALTER TYPE "OfframpStatusEnum" ADD VALUE 'FIAT_INITIATED';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'OfframpStatusEnum' AND e.enumlabel = 'FAILED'
  ) THEN
    ALTER TYPE "OfframpStatusEnum" ADD VALUE 'FAILED';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'OfframpStatusEnum' AND e.enumlabel = 'REFUNDED'
  ) THEN
    ALTER TYPE "OfframpStatusEnum" ADD VALUE 'REFUNDED';
  END IF;
END
$$;

