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
 * Per-offramp metadata. Self transfers are not offered: **`isSelfTransfer`** is optional
 * and may only be `false` (Palremit always receives `extras.is_self_transfer: false`).
 */
export const usdOfframpOptionalMetadataSchema = z
  .object({
    isSelfTransfer: z
      .literal(false, { errorMap: () => ({ message: 'self transfers are not supported' }) })
      .optional(),
  })
  .passthrough();
