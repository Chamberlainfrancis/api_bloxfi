import { describe, expect, it, vi } from 'vitest';
import { enableWalletChains, defaultChainSelection, type ProvisionWalletDeps } from './provisionWallet';

const USER = 'c758e59d-0f04-486e-9a62-434381c9d055';

function deps(over: Partial<ProvisionWalletDeps> = {}) {
  const rows: Array<Record<string, unknown>> = [];
  const d: ProvisionWalletDeps = {
    findUser: vi.fn(async () => ({ id: USER, businessInfo: { email: 'ops@sky.test', legalName: 'Sky Pay' }, legalRepresentative: {} })),
    upsertBusinessWallet: vi.fn(async () => ({ enabled: true } as never)),
    listDepositAddresses: vi.fn(async () => rows as never),
    upsertDepositAddress: vi.fn(async (r) => { rows.push({ ...r }); return r as never; }),
    provision: vi.fn(async (body) => ({
      account: { id: `pa-${String(body.network)}`, client_reference: String(body.client_reference), asset: String(body.asset), mode: 'CRYPTO_DEPOSIT', network: String(body.network), state: 'active',
        deposit_instructions: { kind: 'crypto_address', address: `addr-${String(body.network)}`, network: String(body.network), memo: null } },
    })),
    waitUntilActive: vi.fn(),
    names: () => ({ first_name: 'Sky', last_name: 'Pay' }),
    email: () => 'ops@sky.test',
    ...over,
  };
  return d;
}

describe('enableWalletChains', () => {
  it('defaults to USDT on Tron and USDC on Ethereum', () => {
    expect(defaultChainSelection()).toEqual([{ asset: 'USDT', chain: 'TRC20' }, { asset: 'USDC', chain: 'ERC20' }]);
  });

  it('opens one Tatum-pinned WAL- address per asset and chain', async () => {
    const d = deps();
    await enableWalletChains(d, USER, defaultChainSelection(), 'emmanuel');
    expect(d.provision).toHaveBeenCalledTimes(2);
    expect(d.provision).toHaveBeenCalledWith(
      expect.objectContaining({ client_reference: `WAL-${USER}`, preferred_provider: 'tatum', mode: 'CRYPTO_DEPOSIT', asset: 'USDT', network: 'TRC20' }),
      `wallet-prov:${USER}:USDT:TRC20`
    );
    expect(d.upsertDepositAddress).toHaveBeenCalledWith(expect.objectContaining({ status: 'active', address: 'addr-TRC20', provisionedAccountId: 'pa-TRC20' }));
  });

  it('does not re-open an active address', async () => {
    const d = deps({ listDepositAddresses: vi.fn(async () => [{ asset: 'USDT', chain: 'TRC20', status: 'active' }] as never) });
    await enableWalletChains(d, USER, [{ asset: 'USDT', chain: 'TRC20' }], 'emmanuel');
    expect(d.provision).not.toHaveBeenCalled();
  });

  it('refuses a chain that is not allowed for the asset', async () => {
    await expect(enableWalletChains(deps(), USER, [{ asset: 'USDC', chain: 'TRC20' }], 'x')).rejects.toThrow('CHAIN_NOT_ALLOWED');
  });

  it('records a failed address instead of throwing', async () => {
    const d = deps({ provision: vi.fn(async () => null) });
    await enableWalletChains(d, USER, [{ asset: 'USDT', chain: 'TRC20' }], 'x');
    expect(d.upsertDepositAddress).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }));
  });
});
