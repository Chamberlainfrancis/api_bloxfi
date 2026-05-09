/**
 * Palremit HTTP adapters for core/integrations (injected PalremitCurrencyRequestFn / PalremitLiquidityRequestFn).
 * Single LP: Palremit (Liquidity Orchestrator + Currency API).
 */

import { palremitCurrencyRequest, palremitLiquidityRequest } from '@/services/palremitClient';
import type { HttpRequestOptions } from '@/services/http';
import type { PalremitCurrencyRequestFn } from '@/core/integrations/palremit';
import type { PalremitLiquidityRequestFn } from '@/core/integrations/palremitLiquidity';

export function createPalremitLiquidityAdapter(): PalremitLiquidityRequestFn {
  return <T>(path: string, options?: { method?: string; body?: unknown; headers?: Record<string, string> }) =>
    palremitLiquidityRequest<T>(path, {
      method: (options?.method as HttpRequestOptions['method']) ?? 'GET',
      body: options?.body,
      headers: options?.headers,
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
