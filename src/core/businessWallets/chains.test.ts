import { describe, expect, it } from 'vitest';
import { normalizeWalletAddress, parseWalletClientReference, walletClientReference, chainFamily } from './chains';

describe('wallet chains', () => {
  it('normalizes EVM addresses to lower case and keeps Tron base58', () => {
    expect(normalizeWalletAddress('ERC20', '0xF9CD061Ac329a364A935B65b75B2ce258Ff60665')).toBe('0xf9cd061ac329a364a935b65b75b2ce258ff60665');
    expect(normalizeWalletAddress('TRC20', 'TXjTdP8HfNnAYZ6974pFuogvdinn6Nh5Vv')).toBe('TXjTdP8HfNnAYZ6974pFuogvdinn6Nh5Vv');
  });
  it('refuses an address that does not fit the chain', () => {
    expect(normalizeWalletAddress('TRC20', '0xF9CD061Ac329a364A935B65b75B2ce258Ff60665')).toBeNull();
    expect(normalizeWalletAddress('ERC20', 'TXjTdP8HfNnAYZ6974pFuogvdinn6Nh5Vv')).toBeNull();
    expect(normalizeWalletAddress('SOL', 'abc')).toBeNull();
    expect(chainFamily('XLM')).toBeNull();
  });
  it('round-trips the wallet client reference', () => {
    const id = 'c758e59d-0f04-486e-9a62-434381c9d055';
    expect(parseWalletClientReference(walletClientReference(id))).toBe(id);
    expect(parseWalletClientReference('OFF-0123')).toBeNull();
  });
});
