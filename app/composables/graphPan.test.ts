import { describe, expect, it } from 'vitest';
import { clampGraphPan, graphPanTarget } from './graphPan';

describe('graphPanTarget', () => {
  it('pans by the horizontal delta of a horizontal gesture', () => {
    expect(
      graphPanTarget({ deltaX: 40, deltaY: 2, shiftKey: false }, 0, 200)
    ).toEqual({ scrollLeft: 40, claim: true });
  });

  it('leaves a mostly-vertical trackpad swipe to the commit list', () => {
    // A trackpad reports a little sideways drift on almost every vertical
    // swipe. Claiming it would pan the graph by 3px and swallow the 40px of
    // vertical scrolling the user actually asked for.
    expect(
      graphPanTarget({ deltaX: -3, deltaY: -40, shiftKey: false }, 60, 200)
    ).toEqual({ scrollLeft: 60, claim: false });
  });

  it('treats shift as an explicit horizontal intent on a wheel', () => {
    // A mouse wheel has no deltaX of its own; shift is how it asks to pan.
    expect(
      graphPanTarget({ deltaX: 0, deltaY: 30, shiftKey: true }, 0, 200)
    ).toEqual({ scrollLeft: 30, claim: true });
  });

  it('uses the horizontal delta where shift has already been applied', () => {
    // Some browsers translate shift+wheel into deltaX themselves, leaving
    // deltaY at zero; reading deltaY there would pan by nothing.
    expect(
      graphPanTarget({ deltaX: 30, deltaY: 0, shiftKey: true }, 0, 200)
    ).toEqual({ scrollLeft: 30, claim: true });
  });

  it('clamps a pan that would run past the end of the graph', () => {
    expect(
      graphPanTarget({ deltaX: 500, deltaY: 0, shiftKey: false }, 180, 200)
    ).toEqual({ scrollLeft: 200, claim: true });
  });

  it('clamps a pan that would run back past the first lane', () => {
    expect(
      graphPanTarget({ deltaX: -500, deltaY: 0, shiftKey: false }, 20, 200)
    ).toEqual({ scrollLeft: 0, claim: true });
  });

  it('releases the gesture once the graph is panned to its end', () => {
    // Nothing moved, so the event belongs to whatever else wants it rather
    // than being swallowed at the extreme.
    expect(
      graphPanTarget({ deltaX: 40, deltaY: 0, shiftKey: false }, 200, 200)
    ).toEqual({ scrollLeft: 200, claim: false });
  });

  it('releases the gesture at the other end too', () => {
    expect(
      graphPanTarget({ deltaX: -40, deltaY: 0, shiftKey: false }, 0, 200)
    ).toEqual({ scrollLeft: 0, claim: false });
  });

  it('claims nothing while the graph fits its column', () => {
    expect(
      graphPanTarget({ deltaX: 40, deltaY: 0, shiftKey: false }, 0, 0)
    ).toEqual({ scrollLeft: 0, claim: false });
  });

  it('gives back an offset left over from a wider stretch', () => {
    // The column narrowed while the gutter was still scrolled: the very next
    // gesture must be able to bring lane 0 back, not be refused.
    expect(
      graphPanTarget({ deltaX: 10, deltaY: 0, shiftKey: false }, 120, 0)
    ).toEqual({ scrollLeft: 0, claim: true });
  });
});

describe('clampGraphPan', () => {
  it('keeps an offset that is still within the graph', () => {
    expect(clampGraphPan(120, 200)).toBe(120);
  });

  it('pulls the offset back when the graph narrows', () => {
    expect(clampGraphPan(180, 60)).toBe(60);
  });

  it('returns to the first lane once the graph fits its column again', () => {
    // Otherwise lane 0 sits off the left edge of a column that no longer
    // overflows, drawn misaligned with rows whose indent is already correct.
    expect(clampGraphPan(180, 0)).toBe(0);
  });

  it('never reports a negative offset', () => {
    expect(clampGraphPan(-20, 200)).toBe(0);
  });
});
