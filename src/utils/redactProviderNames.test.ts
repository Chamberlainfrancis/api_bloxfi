import { describe, it, expect } from 'vitest';
import {
  containsProviderName,
  redactProviderNamesFromClientMessage,
} from '@/utils/redactProviderNames';

describe('redactProviderNamesFromClientMessage', () => {
  it('leaves clean messages unchanged', () => {
    expect(redactProviderNamesFromClientMessage('User not found')).toBe('User not found');
    expect(redactProviderNamesFromClientMessage('missing required fields for USD KYC: email')).toBe(
      'missing required fields for USD KYC: email'
    );
  });

  it('redacts common provider brands', () => {
    expect(redactProviderNamesFromClientMessage('Palremit rates unavailable')).toBe(
      'provider rates unavailable'
    );
    expect(redactProviderNamesFromClientMessage('SwipeLux KYC import rejected')).toBe(
      'provider KYC import rejected'
    );
    expect(
      redactProviderNamesFromClientMessage(
        'GRAPH_ONRAMP_KYC_INCOMPLETE: missing required fields for Graph USD KYC: email'
      )
    ).toBe('GRAPH_ONRAMP_KYC_INCOMPLETE: missing required fields for provider USD KYC: email');
  });

  it('does not redact substrings of unrelated words', () => {
    expect(containsProviderName('Photographic evidence required')).toBe(false);
    expect(redactProviderNamesFromClientMessage('Photographic evidence required')).toBe(
      'Photographic evidence required'
    );
  });
});
