import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  logProviderApiFailure,
  logProviderApiSuccess,
  truncateForProviderLog,
  type ProviderApiLogFields,
} from '@/services/providerApiLog';
import { logger } from '@/lib/logger';

const baseFields: ProviderApiLogFields = {
  provider: 'palremit',
  api: 'liquidity',
  method: 'POST',
  path: '/v1/withdrawals',
  url: 'https://liquidity.palremit.com/v1/withdrawals',
  operation: 'POST /v1/withdrawals',
  logCategory: 'Palremit Offramp Withdrawal',
  requestPayload: { asset: 'USD', amount: 100 },
  idempotencyKey: 'offramp-fiat-wd:OFF-1',
};

describe('providerApiLog', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('truncates oversized payloads', () => {
    const long = 'x'.repeat(3000);
    const out = truncateForProviderLog(long) as string;
    expect(out.endsWith('…')).toBe(true);
    expect(out.length).toBeLessThan(3000);
  });

  it('logs success with request and response', () => {
    const info = vi.spyOn(logger, 'info').mockImplementation(() => {});
    logProviderApiSuccess(baseFields, {
      httpStatus: 202,
      responseBody: { data: { id: 'wd_1' } },
      message: '[Palremit Offramp Withdrawal] response',
    });
    expect(info).toHaveBeenCalledOnce();
    const [fields, msg] = info.mock.calls[0];
    expect(msg).toBe('[Palremit Offramp Withdrawal] response');
    expect(fields).toMatchObject({
      provider: 'palremit',
      httpStatus: 202,
      requestPayload: baseFields.requestPayload,
      idempotencyKey: 'offramp-fiat-wd:OFF-1',
    });
    expect(fields).toHaveProperty('responseBody', { data: { id: 'wd_1' } });
  });

  it('logs failure with request and error response', () => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {});
    logProviderApiFailure(baseFields, {
      httpStatus: 400,
      responseBody: { message: 'bad request' },
      providerMessage: 'bad request',
      message: '[Palremit Offramp Withdrawal] {"message":"bad request"}',
    });
    expect(error).toHaveBeenCalledOnce();
    const [fields] = error.mock.calls[0];
    expect(fields).toMatchObject({
      httpStatus: 400,
      providerMessage: 'bad request',
      responseBody: { message: 'bad request' },
      requestPayload: baseFields.requestPayload,
    });
  });
});
