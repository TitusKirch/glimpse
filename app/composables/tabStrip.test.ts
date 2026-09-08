import { describe, expect, it } from 'vitest';
import {
  clampTabScroll,
  tabStripEdges,
  tabStripPage,
  tabStripScrollTarget,
  tabIntoView
} from './tabStrip';

describe('tabStripScrollTarget', () => {
  it('turns a plain vertical wheel into horizontal scrolling', () => {
    // The whole point of the gesture: a mouse without a tilt wheel has to be
    // able to reach the tabs that are off-screen. Nothing in the header
    // scrolls vertically, so there is nothing to take the event from.
    expect(tabStripScrollTarget({ deltaX: 0, deltaY: 40 }, 0, 200)).toEqual({
      scrollLeft: 40,
      claim: true
    });
  });

  it('uses the horizontal delta when the trackpad supplies one', () => {
    expect(tabStripScrollTarget({ deltaX: 30, deltaY: 0 }, 10, 200)).toEqual({
      scrollLeft: 40,
      claim: true
    });
  });

  it('prefers the horizontal delta over vertical drift on a sideways swipe', () => {
    expect(tabStripScrollTarget({ deltaX: 25, deltaY: -4 }, 0, 200)).toEqual({
      scrollLeft: 25,
      claim: true
    });
  });

  it('clamps at both ends and stops claiming once nothing moves', () => {
    // Claiming an event that changed nothing swallows the gesture at either
    // extreme — and with no tabs overflowing there is nothing to swallow for.
    expect(tabStripScrollTarget({ deltaX: 0, deltaY: -50 }, 0, 200)).toEqual({
      scrollLeft: 0,
      claim: false
    });
    expect(tabStripScrollTarget({ deltaX: 0, deltaY: 50 }, 200, 200)).toEqual({
      scrollLeft: 200,
      claim: false
    });
    expect(tabStripScrollTarget({ deltaX: 0, deltaY: 40 }, 0, 0)).toEqual({
      scrollLeft: 0,
      claim: false
    });
  });
});

describe('tabStripEdges', () => {
  it('shows a chevron only where there is something to scroll to', () => {
    expect(tabStripEdges(0, 200)).toEqual({ left: false, right: true });
    expect(tabStripEdges(120, 200)).toEqual({ left: true, right: true });
    expect(tabStripEdges(200, 200)).toEqual({ left: true, right: false });
  });

  it('shows neither when the strip is not overflowing', () => {
    expect(tabStripEdges(0, 0)).toEqual({ left: false, right: false });
  });

  it('tolerates the sub-pixel scroll positions a browser reports', () => {
    // scrollWidth/clientWidth are rounded while scrollLeft is fractional, so an
    // end-of-strip position can read as 199.6 of 200 and leave a dead chevron.
    expect(tabStripEdges(199.6, 200)).toEqual({ left: true, right: false });
    expect(tabStripEdges(0.4, 200)).toEqual({ left: false, right: true });
  });
});

describe('tabStripPage', () => {
  it('pages by most of a viewport, keeping a sliver for context', () => {
    expect(tabStripPage(1, 0, 300, 600)).toBe(240);
    expect(tabStripPage(-1, 240, 300, 600)).toBe(0);
  });

  it('never overshoots either end', () => {
    expect(tabStripPage(1, 500, 300, 600)).toBe(600);
    expect(tabStripPage(-1, 30, 300, 600)).toBe(0);
  });
});

describe('tabIntoView', () => {
  const view = { scrollLeft: 100, viewportWidth: 300, maxScroll: 600 };

  it('leaves a tab that is already fully visible alone', () => {
    expect(tabIntoView(150, 80, view)).toBe(100);
  });

  it('scrolls left to reveal a tab cut off at the leading edge', () => {
    // Tab starts at 60, viewport starts at 100 — bring its left edge in.
    expect(tabIntoView(60, 80, view)).toBe(60);
  });

  it('scrolls right to reveal a tab cut off at the trailing edge', () => {
    // Tab spans 350..450; the viewport ends at 400, so scroll by the shortfall.
    expect(tabIntoView(350, 100, view)).toBe(150);
  });

  it('clamps to the scrollable range', () => {
    expect(tabIntoView(900, 80, view)).toBe(600);
    expect(tabIntoView(-20, 80, view)).toBe(0);
  });

  it('shows the leading edge of a tab wider than the viewport', () => {
    // Nothing can show it whole, and its name reads from the left.
    expect(tabIntoView(200, 500, view)).toBe(200);
  });
});

describe('clampTabScroll', () => {
  it('keeps a position inside the scrollable range', () => {
    expect(clampTabScroll(-10, 200)).toBe(0);
    expect(clampTabScroll(500, 200)).toBe(200);
    expect(clampTabScroll(50, 0)).toBe(0);
  });
});
