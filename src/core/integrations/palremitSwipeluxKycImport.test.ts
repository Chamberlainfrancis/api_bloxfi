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
});
