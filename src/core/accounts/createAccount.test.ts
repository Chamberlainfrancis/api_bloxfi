import { describe, it, expect, vi } from 'vitest';

vi.mock('@/core/files/copyRemoteDocument', () => ({
  copyRemoteDocumentToS3: vi.fn(),
  RemoteDocumentError: class RemoteDocumentError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.name = 'RemoteDocumentError';
      this.code = code;
    }
  },
}));

import { createAccount } from '@/core/accounts/createAccount';
import { CreateAccountConflictError } from '@/types/createAccountConflict';
import { BRIANA_BUSINESS_REFERENCE } from '@/core/integrations/palremitOnramp';
import { GraphOnrampKycError } from '@/core/integrations/graphOnrampKyc';
import type { PalremitLiquidityRequestFn } from '@/core/integrations/palremitLiquidity';

const corridor = {
  asset: 'AED',
  country: 'AE',
  destinationType: 'local_bank',
  beneficiaryType: 'individual' as const,
};

const offrampAccountHolder = {
  type: 'individual' as const,
  name: 'Matisse Eykelberg',
};

const offrampDestination = {
  account_number: 'AE910860000006648238946',
  bank_code: 'WIOBAEADXXX',
  beneficiary: {
    email: 'matisse@example.com',
    phone_number: '+971501234567',
  },
};

const offrampAccountRow = {
  id: 'acc-1',
  userId: 'user-1',
  railType: 'offramp',
  currency: 'aed',
  paymentRail: 'local_bank',
  accountType: 'primary',
  accountHolder: offrampAccountHolder,
  providerPayout: {},
  swipeluxCustomerId: null,
  kycImportStatus: null,
  creationRequestId: null,
  createdAt: new Date('2026-05-22T00:00:00.000Z'),
  updatedAt: new Date('2026-05-22T00:00:00.000Z'),
};

function makeOfframpDeps(overrides: { userMetadata?: unknown } = {}) {
  const liquidityRequest = vi.fn().mockResolvedValue({
    status: 200,
    data: {
      corridor: {
        target_fiat: 'AED',
        country: 'AE',
        destination_type: 'local_bank',
        beneficiary_type: 'individual',
      },
      destination_fields: [
        { path: 'account_number', type: 'string', required: true, label: 'IBAN' },
        { path: 'bank_code', type: 'string', required: true, label: 'BIC' },
        { path: 'beneficiary.email', type: 'string', required: true, label: 'Email' },
        { path: 'beneficiary.phone_number', type: 'string', required: true, label: 'Phone' },
      ],
      destination_template: {},
      amount: { min: null, max: null, currency: 'AED' },
    },
  });

  const accountRepo = {
    createAccount: vi.fn().mockResolvedValue(offrampAccountRow),
    findByCreationRequestId: vi.fn().mockResolvedValue(null),
    updateKycImport: vi.fn(),
    updateProviderIssuance: vi.fn(),
  };
  const userRepo = {
    findUserById: vi.fn().mockResolvedValue({
      id: 'user-1',
      kybStatus: 'approved',
      metadata: overrides.userMetadata ?? null,
    }),
  };
  const kybRepo = {
    getKybRailStatuses: vi.fn().mockResolvedValue([]),
  };
  const importKyc = vi.fn();

  return { liquidityRequest, accountRepo, userRepo, kybRepo, importKyc };
}

const onrampAccountHolder = {
  type: 'individual' as const,
  name: 'Ada Lovelace',
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@example.com',
  phone: '+15551234567',
  taxId: '123-45-6789',
};

const onrampSofQuestionnaire = {
  employmentStatus: 'employed',
  expectedMonthlyPayments: '0_4999',
  primaryPurpose: 'personal',
  sourceOfFunds: 'salary',
};

function onrampCreateBody(overrides: Record<string, unknown> = {}) {
  return {
    rail: 'onramp' as const,
    type: 'primary',
    accountHolder: onrampAccountHolder,
    sumsubShareToken: 'share-token-abc',
    sofQuestionnaire: onrampSofQuestionnaire,
    sourceOfFundsDocument: 'https://cdn.example.com/sof.pdf',
    ...overrides,
  };
}

const onrampAccountRow = {
  id: 'acc-onramp-1',
  userId: 'user-1',
  railType: 'onramp',
  currency: null,
  paymentRail: null,
  accountType: 'primary',
  accountHolder: onrampAccountHolder,
  providerPayout: null,
  swipeluxCustomerId: null,
  kycImportStatus: 'pending_import',
  creationRequestId: 'req-1',
  sofQuestionnaire: onrampSofQuestionnaire,
  sourceOfFundsDocumentPath: 'uploads/DOC-sof.pdf',
  createdAt: new Date('2026-07-14T00:00:00.000Z'),
  updatedAt: new Date('2026-07-14T00:00:00.000Z'),
};

function makeOnrampDeps(userMetadata: unknown = { swipeluxBeneficiaryKycImport: true }) {
  const accountRepo = {
    createAccount: vi.fn().mockResolvedValue(onrampAccountRow),
    findByCreationRequestId: vi.fn().mockResolvedValue(null),
    updateKycImport: vi.fn().mockResolvedValue(onrampAccountRow),
    updateProviderIssuance: vi.fn().mockImplementation(async (_id: string, patch: object) => ({
      ...onrampAccountRow,
      ...patch,
    })),
  };
  const userRepo = {
    findUserById: vi.fn().mockResolvedValue({
      id: 'user-1',
      kybStatus: 'approved',
      metadata: userMetadata,
    }),
  };
  const kybRepo = {
    getKybRailStatuses: vi.fn().mockResolvedValue([]),
  };
  const liquidityRequest = vi.fn();
  const importKyc = vi.fn().mockResolvedValue({
    ok: true,
    value: { channel_customer_id: 'cus_123', status: 'approved', verification_url: null },
  });
  const copySourceOfFundsDocument = vi.fn().mockResolvedValue({
    storagePath: 'uploads/DOC-sof.pdf',
    sanitizedFilename: 'DOC-sof.pdf',
  });

  return { accountRepo, userRepo, kybRepo, liquidityRequest, importKyc, copySourceOfFundsDocument };
}

describe('createAccount — onramp', () => {
  it('creates onramp account without SwipeLux KYC when flag is false', async () => {
    const { accountRepo, userRepo, kybRepo, liquidityRequest, importKyc, copySourceOfFundsDocument } =
      makeOnrampDeps(null);
    const { sumsubShareToken: _omit, ...bodyWithoutToken } = onrampCreateBody();

    const result = await createAccount(
      accountRepo,
      userRepo,
      kybRepo,
      'user-1',
      bodyWithoutToken,
      { palremitLiquidityRequest: liquidityRequest, requestId: 'req-1', importKyc, copySourceOfFundsDocument }
    );

    expect(result).toEqual({
      status: 'ACTIVE',
      message: 'Account created successfully',
      id: 'acc-onramp-1',
    });
    expect(accountRepo.createAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        railType: 'onramp',
        kycImportStatus: null,
        creationRequestId: 'req-1',
      })
    );
    expect(importKyc).not.toHaveBeenCalled();
  });

  it('persists metadata.documents and allows missing taxId when SwipeLux import is off', async () => {
    const { accountRepo, userRepo, kybRepo, liquidityRequest, importKyc, copySourceOfFundsDocument } =
      makeOnrampDeps(null);
    const docs = [{ type: 'passport', url: 'https://cdn.example.com/passport.png' }];
    const { taxId: _t, ...holderWithoutTax } = onrampAccountHolder;

    await createAccount(
      accountRepo,
      userRepo,
      kybRepo,
      'user-1',
      onrampCreateBody({
        sumsubShareToken: undefined,
        accountHolder: holderWithoutTax,
        metadata: { documents: docs },
      }),
      { palremitLiquidityRequest: liquidityRequest, requestId: 'req-meta', importKyc, copySourceOfFundsDocument }
    );

    expect(accountRepo.createAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: { documents: docs },
        accountHolder: holderWithoutTax,
      })
    );
  });

  it('requires taxId for US address even when SwipeLux import is off', async () => {
    const { accountRepo, userRepo, kybRepo, liquidityRequest, importKyc, copySourceOfFundsDocument } =
      makeOnrampDeps(null);
    const { taxId: _t, ...holderWithoutTax } = onrampAccountHolder;

    await expect(
      createAccount(
        accountRepo,
        userRepo,
        kybRepo,
        'user-1',
        onrampCreateBody({
          sumsubShareToken: undefined,
          accountHolder: {
            ...holderWithoutTax,
            address: {
              addressLine1: '1 Main St',
              city: 'Austin',
              stateProvinceRegion: 'TX',
              postalCode: '78701',
              country: 'US',
            },
          },
        }),
        { palremitLiquidityRequest: liquidityRequest, requestId: 'req-us-tax', importKyc, copySourceOfFundsDocument }
      )
    ).rejects.toThrow(/taxId is required for US address/);
    expect(accountRepo.createAccount).not.toHaveBeenCalled();
  });

  it('strips invalid punctuation from person names before persist', async () => {
    const { accountRepo, userRepo, kybRepo, liquidityRequest, importKyc, copySourceOfFundsDocument } =
      makeOnrampDeps(null);

    await createAccount(
      accountRepo,
      userRepo,
      kybRepo,
      'user-1',
      onrampCreateBody({
        sumsubShareToken: undefined,
        accountHolder: {
          ...onrampAccountHolder,
          firstName: 'INDIANA CHRISTINA R.',
          lastName: 'SCHEPENS',
          name: 'INDIANA CHRISTINA R. SCHEPENS',
        },
      }),
      { palremitLiquidityRequest: liquidityRequest, requestId: 'req-name', importKyc, copySourceOfFundsDocument }
    );

    expect(accountRepo.createAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        accountHolder: expect.objectContaining({
          firstName: 'INDIANA CHRISTINA R',
          lastName: 'SCHEPENS',
          name: 'INDIANA CHRISTINA R SCHEPENS',
        }),
      })
    );
  });

  it('requires taxId when SwipeLux beneficiary KYC import is enabled', async () => {
    const { accountRepo, userRepo, kybRepo, liquidityRequest, importKyc, copySourceOfFundsDocument } =
      makeOnrampDeps();
    const { taxId: _t, ...holderWithoutTax } = onrampAccountHolder;

    await expect(
      createAccount(
        accountRepo,
        userRepo,
        kybRepo,
        'user-1',
        onrampCreateBody({ accountHolder: holderWithoutTax }),
        { palremitLiquidityRequest: liquidityRequest, requestId: 'req-1', importKyc, copySourceOfFundsDocument }
      )
    ).rejects.toThrow(/taxId is required/);
    expect(accountRepo.createAccount).not.toHaveBeenCalled();
  });

  it('rejects onramp create when accountHolder.type is business', async () => {
    const { accountRepo, userRepo, kybRepo, liquidityRequest, importKyc, copySourceOfFundsDocument } = makeOnrampDeps();

    await expect(
      createAccount(
        accountRepo,
        userRepo,
        kybRepo,
        'user-1',
        onrampCreateBody({ accountHolder: { ...onrampAccountHolder, type: 'business' } }),
        { palremitLiquidityRequest: liquidityRequest, requestId: 'req-1', importKyc, copySourceOfFundsDocument }
      )
    ).rejects.toThrow('INVALID_ACCOUNT');

    expect(accountRepo.createAccount).not.toHaveBeenCalled();
    expect(importKyc).not.toHaveBeenCalled();
  });

  it('imports and stores cus_* when flag true', async () => {
    const { accountRepo, userRepo, kybRepo, liquidityRequest, importKyc, copySourceOfFundsDocument } = makeOnrampDeps();

    const result = await createAccount(
      accountRepo,
      userRepo,
      kybRepo,
      'user-1',
      onrampCreateBody(),
      { palremitLiquidityRequest: liquidityRequest, requestId: 'req-1', importKyc, copySourceOfFundsDocument }
    );

    expect(result).toEqual({
      status: 'ACTIVE',
      message: 'Account created successfully',
      id: 'acc-onramp-1',
    });
    expect(accountRepo.createAccount).toHaveBeenCalledOnce();
    expect(accountRepo.createAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        railType: 'onramp',
        kycImportStatus: 'pending_import',
        creationRequestId: 'req-1',
        sofQuestionnaire: onrampSofQuestionnaire,
        sourceOfFundsDocumentPath: 'uploads/DOC-sof.pdf',
      })
    );
    expect(copySourceOfFundsDocument).toHaveBeenCalledWith('https://cdn.example.com/sof.pdf');
    expect(importKyc).toHaveBeenCalledOnce();
    expect(importKyc).toHaveBeenCalledWith(
      liquidityRequest,
      expect.objectContaining({
        clientReference: 'acc-onramp-1',
        importToken: 'share-token-abc',
        kycInput: expect.objectContaining({
          customer_type: 'individual',
          email: 'ada@example.com',
          first_name: 'Ada',
          last_name: 'Lovelace',
          phone: '+15551234567',
          tax_id: '123-45-6789',
        }),
      })
    );
    expect(accountRepo.updateKycImport).toHaveBeenCalledWith('acc-onramp-1', {
      kycImportStatus: 'approved',
      swipeluxCustomerId: 'cus_123',
    });
  });

  it('omits sumsubShareToken to start hosted KYC when flag true', async () => {
    const { accountRepo, userRepo, kybRepo, liquidityRequest, importKyc, copySourceOfFundsDocument } =
      makeOnrampDeps();
    importKyc.mockResolvedValue({
      ok: true,
      value: {
        channel_customer_id: 'cus_hosted',
        status: 'pending',
        verification_url: 'https://sumsub.example/verify/xyz',
      },
    });
    const { sumsubShareToken: _omit, ...bodyWithoutToken } = onrampCreateBody();

    const result = await createAccount(
      accountRepo,
      userRepo,
      kybRepo,
      'user-1',
      bodyWithoutToken,
      { palremitLiquidityRequest: liquidityRequest, requestId: 'req-hosted', importKyc, copySourceOfFundsDocument }
    );

    expect(result).toEqual({
      status: 'ACTIVE',
      message: 'Account created successfully',
      id: 'acc-onramp-1',
      verificationUrl: 'https://sumsub.example/verify/xyz',
    });
    expect(importKyc.mock.calls[0]?.[1]).not.toHaveProperty('importToken');
    expect(accountRepo.updateKycImport).toHaveBeenCalledWith('acc-onramp-1', {
      kycImportStatus: 'pending_import',
      swipeluxCustomerId: 'cus_hosted',
    });
  });

  it('replays same creationRequestId without calling importKyc again', async () => {
    const { accountRepo, userRepo, kybRepo, liquidityRequest, importKyc, copySourceOfFundsDocument } = makeOnrampDeps();
    accountRepo.findByCreationRequestId.mockResolvedValue(onrampAccountRow);

    const result = await createAccount(
      accountRepo,
      userRepo,
      kybRepo,
      'user-1',
      onrampCreateBody(),
      { palremitLiquidityRequest: liquidityRequest, requestId: 'req-1', importKyc, copySourceOfFundsDocument }
    );

    expect(result).toEqual({
      status: 'ACTIVE',
      message: 'Account already exists',
      id: 'acc-onramp-1',
    });
    expect(accountRepo.createAccount).not.toHaveBeenCalled();
    expect(importKyc).not.toHaveBeenCalled();
  });

  it('throws REQUEST_ID_MISMATCH and does NOT return the other user\'s account when the same creationRequestId belongs to a different userId', async () => {
    const { accountRepo, userRepo, kybRepo, liquidityRequest, importKyc, copySourceOfFundsDocument } = makeOnrampDeps();
    accountRepo.findByCreationRequestId.mockResolvedValue({
      ...onrampAccountRow,
      userId: 'user-2', // a different user's row happens to share this requestId
    });

    await expect(
      createAccount(
        accountRepo,
        userRepo,
        kybRepo,
        'user-1',
        onrampCreateBody(),
        { palremitLiquidityRequest: liquidityRequest, requestId: 'req-1', importKyc, copySourceOfFundsDocument }
      )
    ).rejects.toThrow(CreateAccountConflictError);

    expect(accountRepo.createAccount).not.toHaveBeenCalled();
    expect(importKyc).not.toHaveBeenCalled();
  });

  it('throws REQUEST_ID_MISMATCH when the same creationRequestId + userId belongs to a different identity', async () => {
    const { accountRepo, userRepo, kybRepo, liquidityRequest, importKyc, copySourceOfFundsDocument } = makeOnrampDeps();
    accountRepo.findByCreationRequestId.mockResolvedValue({
      ...onrampAccountRow,
      accountHolder: { ...onrampAccountHolder, email: 'someone-else@example.com' },
    });

    await expect(
      createAccount(
        accountRepo,
        userRepo,
        kybRepo,
        'user-1',
        onrampCreateBody(),
        { palremitLiquidityRequest: liquidityRequest, requestId: 'req-1', importKyc, copySourceOfFundsDocument }
      )
    ).rejects.toThrow('requestId was already used to create an onramp account with different data');

    expect(accountRepo.createAccount).not.toHaveBeenCalled();
    expect(importKyc).not.toHaveBeenCalled();
  });

  it('collapses a concurrent double-submit (P2002 on createAccount) into a lookup-and-return instead of throwing', async () => {
    const { accountRepo, userRepo, kybRepo, liquidityRequest, importKyc, copySourceOfFundsDocument } = makeOnrampDeps();
    // Pre-check sees nothing (no row yet); the other concurrent request wins the DB race and
    // inserts first, so our createAccount call hits the unique constraint.
    accountRepo.findByCreationRequestId
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(onrampAccountRow);
    accountRepo.createAccount.mockRejectedValueOnce({ code: 'P2002', message: 'Unique constraint failed' });

    const result = await createAccount(
      accountRepo,
      userRepo,
      kybRepo,
      'user-1',
      onrampCreateBody(),
      { palremitLiquidityRequest: liquidityRequest, requestId: 'req-1', importKyc, copySourceOfFundsDocument }
    );

    expect(result).toEqual({
      status: 'ACTIVE',
      message: 'Account already exists',
      id: 'acc-onramp-1',
    });
    expect(accountRepo.findByCreationRequestId).toHaveBeenCalledTimes(2);
    expect(importKyc).not.toHaveBeenCalled();
  });

  it('rethrows a P2002 from createAccount if the redo-lookup still finds nothing (should not happen, but must not swallow the error)', async () => {
    const { accountRepo, userRepo, kybRepo, liquidityRequest, importKyc, copySourceOfFundsDocument } = makeOnrampDeps();
    accountRepo.findByCreationRequestId.mockResolvedValue(null);
    const p2002 = { code: 'P2002', message: 'Unique constraint failed' };
    accountRepo.createAccount.mockRejectedValueOnce(p2002);

    await expect(
      createAccount(
        accountRepo,
        userRepo,
        kybRepo,
        'user-1',
        onrampCreateBody(),
        { palremitLiquidityRequest: liquidityRequest, requestId: 'req-1', importKyc, copySourceOfFundsDocument }
      )
    ).rejects.toBe(p2002);
  });

  it('marks the row failed and throws a transient error string on a 5xx import failure', async () => {
    const { accountRepo, userRepo, kybRepo, liquidityRequest, importKyc, copySourceOfFundsDocument } = makeOnrampDeps();
    importKyc.mockResolvedValue({ ok: false, status: 503, message: 'orchestrator down' });

    await expect(
      createAccount(
        accountRepo,
        userRepo,
        kybRepo,
        'user-1',
        onrampCreateBody(),
        { palremitLiquidityRequest: liquidityRequest, requestId: 'req-1', importKyc, copySourceOfFundsDocument }
      )
    ).rejects.toThrow('PALREMIT_SWIPELUX_KYC_IMPORT_TRANSIENT');

    expect(accountRepo.updateKycImport).toHaveBeenCalledWith('acc-onramp-1', {
      kycImportStatus: 'failed',
    });
  });

  it('marks the row failed and throws a permanent error string on a 4xx import failure', async () => {
    const { accountRepo, userRepo, kybRepo, liquidityRequest, importKyc, copySourceOfFundsDocument } = makeOnrampDeps();
    importKyc.mockResolvedValue({ ok: false, status: 422, message: 'invalid share token' });

    await expect(
      createAccount(
        accountRepo,
        userRepo,
        kybRepo,
        'user-1',
        onrampCreateBody(),
        { palremitLiquidityRequest: liquidityRequest, requestId: 'req-1', importKyc, copySourceOfFundsDocument }
      )
    ).rejects.toThrow('PALREMIT_SWIPELUX_KYC_IMPORT_PERMANENT');

    expect(accountRepo.updateKycImport).toHaveBeenCalledWith('acc-onramp-1', {
      kycImportStatus: 'failed',
    });
  });

  it('never passes sumsubShareToken into the persisted accountHolder or any log call', async () => {
    const { accountRepo, userRepo, kybRepo, liquidityRequest, importKyc, copySourceOfFundsDocument } = makeOnrampDeps();
    const { logger } = await import('@/lib/logger');
    const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => logger);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await createAccount(
      accountRepo,
      userRepo,
      kybRepo,
      'user-1',
      onrampCreateBody({ sumsubShareToken: 'super-secret-share-token' }),
      { palremitLiquidityRequest: liquidityRequest, requestId: 'req-1', importKyc, copySourceOfFundsDocument }
    );

    const createAccountCallArg = accountRepo.createAccount.mock.calls[0][0];
    expect(JSON.stringify(createAccountCallArg)).not.toContain('super-secret-share-token');

    const allLoggedText = [...infoSpy.mock.calls, ...logSpy.mock.calls, ...errorSpy.mock.calls]
      .flat()
      .map((v) => (typeof v === 'string' ? v : JSON.stringify(v)))
      .join(' ');
    expect(allLoggedText).not.toContain('super-secret-share-token');
    expect(allLoggedText).toContain('[redacted]');

    infoSpy.mockRestore();
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('provisions Graph named VA for USD Briana accounts and skips SwipeLux import', async () => {
    const { accountRepo, userRepo, kybRepo, importKyc, copySourceOfFundsDocument } = makeOnrampDeps(null);
    userRepo.findUserById.mockResolvedValue({
      id: BRIANA_BUSINESS_REFERENCE,
      kybStatus: 'approved',
      metadata: null,
    });
    const provisionCalls: { path: string; body?: Record<string, unknown> }[] = [];
    const liquidityRequest: PalremitLiquidityRequestFn = vi.fn(async (path, options) => {
      provisionCalls.push({ path, body: options?.body as Record<string, unknown> | undefined });
      if (path === '/v1/provisioned-accounts') {
        return {
          status: 201,
          data: {
            id: 'prov-graph-1',
            state: 'active',
            provider_name: 'graph',
            deposit_instructions: {
              kind: 'fiat_account',
              account_number: '9992740191426913',
              bank_code: '084106768',
              bank_name: 'Oval Bank',
              account_holder_name: 'Gilles Eykelberg',
              reference: 'GRAPH-1',
            },
          },
        };
      }
      throw new Error(`unexpected path ${path}`);
    }) as unknown as PalremitLiquidityRequestFn;

    const result = await createAccount(
      accountRepo,
      userRepo,
      kybRepo,
      BRIANA_BUSINESS_REFERENCE,
      onrampCreateBody({
        type: 'usd',
        sumsubShareToken: undefined,
        accountHolder: {
          ...onrampAccountHolder,
          dateOfBirth: '1989-01-16',
          idType: 'passport',
          idNumber: 'A12345678',
          idCountry: 'BE',
          address: {
            addressLine1: '1 Main St',
            city: 'Brussels',
            stateProvinceRegion: 'BRU',
            postalCode: '1000',
            country: 'BE',
          },
        },
        sofQuestionnaire: {
          ...onrampSofQuestionnaire,
          mostRecentOccupation: 'Engineer',
        },
        metadata: {
          documents: [{ type: 'passport', url: 'https://cdn.example.com/passport.png' }],
        },
      }),
      {
        palremitLiquidityRequest: liquidityRequest,
        requestId: 'req-graph-1',
        importKyc,
        copySourceOfFundsDocument,
      }
    );

    expect(importKyc).not.toHaveBeenCalled();
    expect(accountRepo.updateProviderIssuance).toHaveBeenCalledWith(
      'acc-onramp-1',
      expect.objectContaining({
        providerIssuanceStatus: 'active',
        provisionedAccountId: 'prov-graph-1',
      })
    );
    expect(result.providerIssuanceStatus).toBe('active');
    expect(result.depositDetails?.accountNumber).toBe('9992740191426913');
    expect(result.capabilities?.usdNamedDeposit.status).toBe('ready');
    expect(provisionCalls[0]?.body?.client_reference).toBe('acc-onramp-1');
    expect(provisionCalls[0]?.body?.preferred_provider).toBe('graph');
  });

  it('rejects Graph USD create when KYC documents are incomplete before persist', async () => {
    const { accountRepo, userRepo, kybRepo, liquidityRequest, importKyc, copySourceOfFundsDocument } =
      makeOnrampDeps({ graphUsdNamedDeposits: true });

    await expect(
      createAccount(
        accountRepo,
        userRepo,
        kybRepo,
        'user-1',
        onrampCreateBody({
          type: 'usd',
          sumsubShareToken: undefined,
          accountHolder: {
            type: 'individual',
            name: 'Ada Lovelace',
            firstName: 'Ada',
            lastName: 'Lovelace',
            email: 'ada@example.com',
            phone: '+15551234567',
          },
        }),
        {
          palremitLiquidityRequest: liquidityRequest,
          requestId: 'req-graph-bad',
          importKyc,
          copySourceOfFundsDocument,
        }
      )
    ).rejects.toThrow(GraphOnrampKycError);

    expect(accountRepo.createAccount).not.toHaveBeenCalled();
    expect(copySourceOfFundsDocument).not.toHaveBeenCalled();
  });
});

describe('createAccount — offramp (regression guard)', () => {
  it('creates an offramp account unaffected by the onramp branch', async () => {
    const { liquidityRequest, accountRepo, userRepo, kybRepo, importKyc } = makeOfframpDeps();

    const result = await createAccount(
      accountRepo,
      userRepo,
      kybRepo,
      'user-1',
      {
        rail: 'offramp',
        type: 'primary',
        accountHolder: offrampAccountHolder,
        corridor,
        destination: offrampDestination,
      },
      { palremitLiquidityRequest: liquidityRequest, requestId: 'req-offramp-1', importKyc }
    );

    expect(result).toEqual({
      status: 'ACTIVE',
      message: 'Account created successfully',
      id: 'acc-1',
    });
    expect(accountRepo.createAccount).toHaveBeenCalledOnce();
    expect(accountRepo.findByCreationRequestId).not.toHaveBeenCalled();
    expect(importKyc).not.toHaveBeenCalled();
  });

  it('rejects offramp create when type is blank', async () => {
    const { liquidityRequest, accountRepo, userRepo, kybRepo, importKyc } = makeOfframpDeps();

    await expect(
      createAccount(
        accountRepo,
        userRepo,
        kybRepo,
        'user-1',
        {
          rail: 'offramp',
          type: '   ',
          accountHolder: offrampAccountHolder,
          corridor,
          destination: offrampDestination,
        },
        { palremitLiquidityRequest: liquidityRequest, requestId: 'req-offramp-2', importKyc }
      )
    ).rejects.toThrow('INVALID_ACCOUNT: type is required');
  });

  it('rejects offramp create when corridor/destination are missing', async () => {
    const { liquidityRequest, accountRepo, userRepo, kybRepo, importKyc } = makeOfframpDeps();

    await expect(
      createAccount(
        accountRepo,
        userRepo,
        kybRepo,
        'user-1',
        {
          rail: 'offramp',
          type: 'primary',
          accountHolder: offrampAccountHolder,
        },
        { palremitLiquidityRequest: liquidityRequest, requestId: 'req-offramp-3', importKyc }
      )
    ).rejects.toThrow('INVALID_ACCOUNT: corridor and destination are required');
  });

  it('rejects offramp create when user is not KYB verified for the rail', async () => {
    const { liquidityRequest, accountRepo, userRepo, kybRepo, importKyc } = makeOfframpDeps();
    userRepo.findUserById.mockResolvedValue({ id: 'user-1', kybStatus: 'not_started', metadata: null });
    kybRepo.getKybRailStatuses.mockResolvedValue([{ rail: 'AED', status: 'under_review', capabilities: [] }]);

    await expect(
      createAccount(
        accountRepo,
        userRepo,
        kybRepo,
        'user-1',
        {
          rail: 'offramp',
          type: 'primary',
          accountHolder: offrampAccountHolder,
          corridor,
          destination: offrampDestination,
        },
        { palremitLiquidityRequest: liquidityRequest, requestId: 'req-offramp-4', importKyc }
      )
    ).rejects.toThrow('USER_NOT_KYB_VERIFIED');
  });

  it('throws USER_NOT_FOUND when the user does not exist', async () => {
    const { liquidityRequest, accountRepo, userRepo, kybRepo, importKyc } = makeOfframpDeps();
    userRepo.findUserById.mockResolvedValue(null);

    await expect(
      createAccount(
        accountRepo,
        userRepo,
        kybRepo,
        'user-1',
        {
          rail: 'offramp',
          type: 'primary',
          accountHolder: offrampAccountHolder,
          corridor,
          destination: offrampDestination,
        },
        { palremitLiquidityRequest: liquidityRequest, requestId: 'req-offramp-5', importKyc }
      )
    ).rejects.toThrow('USER_NOT_FOUND');
  });
});
