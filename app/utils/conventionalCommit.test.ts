import { describe, expect, it } from 'vitest';
import {
  applyConventionalPrefix,
  CONVENTIONAL_TYPES
} from './conventionalCommit';

describe('CONVENTIONAL_TYPES', () => {
  it('lists the standard conventional types', () => {
    expect(CONVENTIONAL_TYPES).toContain('feat');
    expect(CONVENTIONAL_TYPES).toContain('fix');
    expect(CONVENTIONAL_TYPES).toContain('revert');
    expect(CONVENTIONAL_TYPES.length).toBe(11);
  });
});

describe('applyConventionalPrefix', () => {
  it('adds a type prefix to a bare subject', () => {
    expect(applyConventionalPrefix('add thing', { type: 'feat' })).toBe(
      'feat: add thing'
    );
  });

  it('includes the scope and the breaking marker', () => {
    expect(
      applyConventionalPrefix('change api', {
        type: 'feat',
        scope: 'core',
        breaking: true
      })
    ).toBe('feat(core)!: change api');
  });

  it('is idempotent — re-applying replaces the existing prefix', () => {
    const once = applyConventionalPrefix('add thing', { type: 'feat' });
    expect(applyConventionalPrefix(once, { type: 'fix' })).toBe(
      'fix: add thing'
    );
  });

  it('strips an existing scope/breaking prefix before re-applying', () => {
    expect(applyConventionalPrefix('feat(core)!: x', { type: 'docs' })).toBe(
      'docs: x'
    );
  });

  it('preserves the body (lines after the subject)', () => {
    expect(applyConventionalPrefix('subj\n\nbody line', { type: 'fix' })).toBe(
      'fix: subj\n\nbody line'
    );
  });

  it('drops an all-whitespace scope', () => {
    expect(applyConventionalPrefix('x', { type: 'feat', scope: '   ' })).toBe(
      'feat: x'
    );
  });
});
