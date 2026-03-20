/**
 * Palremit HTTP adapters for core/integrations (injected PalremitCurrencyRequestFn / PalremitLiquidityRequestFn).
 * Single LP: Palremit only (docs/palremit_integration_guide.md).
 */

import { palremitCurrencyRequest, palremitLiquidityRequest } from '@/services/palremitClient';
import type { HttpRequestOptions } from '@/services/http';
import type { PalremitCurrencyRequestFn } from '@/core/integrations/palremit';
import type { PalremitLiquidityRequestFn } from '@/core/integrations/palremitLiquidity';

export function createPalremitLiquidityAdapter(): PalremitLiquidityRequestFn {
  return <T>(path: string, options?: { method?: string; body?: unknown }) =>
    palremitLiquidityRequest<T>(path, {
      method: (options?.method as HttpRequestOptions['method']) ?? 'GET',
      body: options?.body,
    }).then((r) => ({
      status: r.status,
      data: r.data,
    }));
}

export function createPalremitCurrencyAdapter(): PalremitCurrencyRequestFn {
  return <T>(path: string, options?: { method?: string; body?: unknown }) =>
    palremitCurrencyRequest<T>(path, {
      method: (options?.method as HttpRequestOptions['method']) ?? 'GET',
      body: options?.body,
    }).then((r) => ({
      status: r.status,
      data: r.data,
    }));
}
