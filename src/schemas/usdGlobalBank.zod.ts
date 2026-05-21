/**
 * Zod for USD offramp extras merged into Palremit `destination.extras`.
 */

import { z } from 'zod';

/** Palremit `transfer_purpose` / USD `destination.purposeOfPayment` (UPPER_SNAKE). */
export const usdPalremitTransferPurposeSchema = z
  .string()
  .min(1)
  .regex(/^[A-Z][A-Z0-9_]*$/, 'must be UPPER_SNAKE (e.g. FAMILY_MAINTENANCE)');

/**
 * Per-offramp metadata for USD: **`isSelfTransfer`** (→ Palremit `extras.is_self_transfer`).
 */
export const usdOfframpOptionalMetadataSchema = z
  .object({
    isSelfTransfer: z.boolean(),
  })
  .passthrough();
