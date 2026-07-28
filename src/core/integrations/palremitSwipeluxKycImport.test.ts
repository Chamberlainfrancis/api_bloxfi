import { describe, it, expect, vi } from 'vitest';
import { importSwipeluxBeneficiaryKyc } from '@/core/integrations/palremitSwipeluxKycImport';

describe('importSwipeluxBeneficiaryKyc', () => {
  it('POSTs snake_case body to kyc-import and returns channel_customer_id', async () => {
    const request = vi.fn().mockResolvedValue({
      status: 200,
      data: { channel_customer_id: 'cus_1', status: 'approved' },
    });

    const result = await importSwipeluxBeneficiaryKyc(request, {
      clientReference: 'ben-1',
      importToken: 'tok_secret',
      kycInput: {
        customer_type: 'individual',
        email: 'a@b.com',
        first_name: 'Ada',
        last_name: 'Lovelace',
        phone: '+15555550100',
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.channel_customer_id).toBe('cus_1');
      expect(result.value.status).toBe('approved');
      expect(result.value.verification_url).toBeNull();
    }
    expect(request).toHaveBeenCalledWith('/v1/integrations/swipelux/kyc-import', {
      method: 'POST',
      body: {
        client_reference: 'ben-1',
        import_token: 'tok_secret',
        kyc_input: {
          customer_type: 'individual',
          email: 'a@b.com',
          first_name: 'Ada',
          last_name: 'Lovelace',
          phone: '+15555550100',
        },
      },
    });
  });

  it('omits import_token when starting hosted KYC and returns verification_url', async () => {
    const request = vi.fn().mockResolvedValue({
      status: 200,
      data: {
        channel_customer_id: 'cus_1',
        status: 'pending',
        verification_url: 'https://sumsub.example/verify/abc',
      },
    });

    const result = await importSwipeluxBeneficiaryKyc(request, {
      clientReference: 'ben-1',
      kycInput: {
        customer_type: 'individual',
        email: 'a@b.com',
        first_name: 'Ada',
        last_name: 'Lovelace',
        phone: '+15555550100',
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.verification_url).toBe('https://sumsub.example/verify/abc');
    }
    expect(request).toHaveBeenCalledWith('/v1/integrations/swipelux/kyc-import', {
      method: 'POST',
      body: {
        client_reference: 'ben-1',
        kyc_input: {
          customer_type: 'individual',
          email: 'a@b.com',
          first_name: 'Ada',
          last_name: 'Lovelace',
          phone: '+15555550100',
        },
      },
    });
  });

  it('maps non-200 to ok:false with sanitized message', async () => {
    const request = vi.fn().mockResolvedValue({
      status: 422,
      data: { error: 'provider_rejected', message: 'Applicant not approved' },
    });

    const result = await importSwipeluxBeneficiaryKyc(request, {
      clientReference: 'ben-1',
      importToken: 'tok_secret',
      kycInput: {
        customer_type: 'individual',
        email: 'a@b.com',
        first_name: 'Ada',
        last_name: 'Lovelace',
        phone: '+15555550100',
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(422);
      expect(result.message.length).toBeGreaterThan(0);
    }
  });

  it('asserts importToken never appears in request path or headers (only in body)', async () => {
    const secretToken = 'tok_secret_confidential_do_not_log';
    const request = vi.fn().mockResolvedValue({
      status: 200,
      data: { channel_customer_id: 'cus_1', status: 'approved' },
    });

    await importSwipeluxBeneficiaryKyc(request, {
      clientReference: 'ben-1',
      importToken: secretToken,
      kycInput: {
        customer_type: 'individual',
        email: 'a@b.com',
        first_name: 'Ada',
        last_name: 'Lovelace',
        phone: '+15555550100',
      },
    });

    const [path, options] = request.mock.calls[0];

    // Token must NOT appear in the request path
    expect(path).not.toContain(secretToken);

    // Token must NOT appear in headers
    if (options?.headers) {
      const headersStr = JSON.stringify(options.headers);
      expect(headersStr).not.toContain(secretToken);
    }

    // Token MUST appear in the request body
    expect(options?.body).toBeDefined();
    const bodyStr = JSON.stringify(options.body);
    expect(bodyStr).toContain(secretToken);
  });

  it('handles invalid response data (missing channel_customer_id)', async () => {
    const request = vi.fn().mockResolvedValue({
      status: 200,
      data: { status: 'approved' }, // missing channel_customer_id
    });

    const result = await importSwipeluxBeneficiaryKyc(request, {
      clientReference: 'ben-1',
      importToken: 'tok_secret',
      kycInput: {
        customer_type: 'individual',
        email: 'a@b.com',
        first_name: 'Ada',
        last_name: 'Lovelace',
        phone: '+15555550100',
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(502);
      expect(result.message).toContain('invalid');
    }
  });

  it('handles invalid response data (missing status)', async () => {
    const request = vi.fn().mockResolvedValue({
      status: 200,
      data: { channel_customer_id: 'cus_1' }, // missing status
    });

    const result = await importSwipeluxBeneficiaryKyc(request, {
      clientReference: 'ben-1',
      importToken: 'tok_secret',
      kycInput: {
        customer_type: 'individual',
        email: 'a@b.com',
        first_name: 'Ada',
        last_name: 'Lovelace',
        phone: '+15555550100',
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(502);
      expect(result.message).toContain('invalid');
    }
  });

  it('does not leak importToken in error messages', async () => {
    const secretToken = 'tok_confidential_must_not_leak';
    const request = vi.fn().mockResolvedValue({
      status: 400,
      data: { error: 'invalid_request', message: 'Bad request data' },
    });

    const result = await importSwipeluxBeneficiaryKyc(request, {
      clientReference: 'ben-1',
      importToken: secretToken,
      kycInput: {
        customer_type: 'individual',
        email: 'a@b.com',
        first_name: 'Ada',
        last_name: 'Lovelace',
        phone: '+15555550100',
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Verify token is NOT in the error message
      expect(result.message).not.toContain(secretToken);
      // Error message should come from extractPalremitErrorMessage, not raw token
      expect(result.message.length).toBeGreaterThan(0);
    }
  });
});
