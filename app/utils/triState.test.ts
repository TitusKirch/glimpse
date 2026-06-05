import { describe, expect, it } from 'vitest';
import { toTriState, triStateConfig } from './triState';

describe('toTriState', () => {
  it('maps the git-config string to a tri-state', () => {
    expect(toTriState('true')).toBe('on');
    expect(toTriState('false')).toBe('off');
    expect(toTriState('')).toBe('inherit');
  });

  it('treats any other non-empty value as off', () => {
    expect(toTriState('1')).toBe('off');
    expect(toTriState('yes')).toBe('off');
  });
});

describe('triStateConfig', () => {
  it('maps a tri-state to its config string; inherit clears (null)', () => {
    expect(triStateConfig('on')).toBe('true');
    expect(triStateConfig('off')).toBe('false');
    expect(triStateConfig('inherit')).toBeNull();
  });

  it('round-trips on/off through the config string', () => {
    expect(toTriState(triStateConfig('on')!)).toBe('on');
    expect(toTriState(triStateConfig('off')!)).toBe('off');
  });
});
