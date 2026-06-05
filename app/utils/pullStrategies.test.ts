import { describe, expect, it } from 'vitest';
import { PULL_STRATEGIES } from './pullStrategies';

describe('PULL_STRATEGIES', () => {
  it('lists merge, rebase and ff-only in order', () => {
    expect(PULL_STRATEGIES.map((s) => s.value)).toEqual([
      'merge',
      'rebase',
      'ff-only'
    ]);
  });

  it('gives each strategy an icon and a pull.* label key', () => {
    for (const s of PULL_STRATEGIES) {
      expect(s.icon).toBeTruthy();
      expect(s.labelKey).toMatch(/^pull\./);
    }
  });
});
