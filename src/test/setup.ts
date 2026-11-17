import { beforeEach } from 'vitest';
import { _resetPairMarkupRulesForTests, setPairMarkupRulesFromSettings } from '@/core/quotes/pairMarkupStore';
import { TEST_PAIR_MARKUP_ROWS } from '@/test/pairMarkupFixture';

// Every test starts with the fixture rows loaded, as if the table had loaded.
beforeEach(() => {
  _resetPairMarkupRulesForTests();
  setPairMarkupRulesFromSettings(TEST_PAIR_MARKUP_ROWS);
});
