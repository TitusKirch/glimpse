// The repo tab strip scrolls instead of squeezing its tabs, which puts four
// decisions in front of the component: where a wheel gesture should take it,
// which edge chevrons are live, how far a chevron click pages, and where a tab
// has to be brought to be visible. Each is arithmetic over scroll geometry, and
// each is wrong in a way that is invisible until it is on screen — a chevron
// that never disarms, a page that overshoots, a gesture swallowed at the end of
// the strip. So they live here as pure functions, the way `graphPan` does, and
// the component only reads the DOM and applies the result.

export interface TabWheelGesture {
  deltaX: number;
  deltaY: number;
}

export interface TabScroll {
  scrollLeft: number;
  // Whether the strip took the gesture — false whenever nothing moved, so the
  // event is not swallowed at either extreme.
  claim: boolean;
}

export interface TabViewport {
  scrollLeft: number;
  viewportWidth: number;
  maxScroll: number;
}

// Browsers report `scrollLeft` fractionally while `scrollWidth`/`clientWidth`
// are rounded, so an at-the-end position can read a fraction short of the
// maximum. Anything under a pixel is the same place.
const EPSILON = 1;

export function clampTabScroll(scrollLeft: number, maxScroll: number): number {
  return Math.min(Math.max(0, scrollLeft), Math.max(0, maxScroll));
}

// A vertical wheel scrolls the strip sideways. Unlike the commit graph, there
// is no second axis to arbitrate against — nothing in the header scrolls
// vertically — so the gesture needs no shift key and no mostly-sideways test,
// and a plain mouse gets a scroll path rather than only the chevrons.
export function tabStripScrollTarget(
  gesture: TabWheelGesture,
  scrollLeft: number,
  maxScroll: number
): TabScroll {
  const current = clampTabScroll(scrollLeft, maxScroll);
  const delta = gesture.deltaX !== 0 ? gesture.deltaX : gesture.deltaY;
  const next = clampTabScroll(current + delta, maxScroll);
  return { scrollLeft: next, claim: next !== scrollLeft };
}

// Which chevrons have somewhere to go. They appear and disappear rather than
// sitting disabled, and they overlay the strip, so this never causes a reflow.
export function tabStripEdges(
  scrollLeft: number,
  maxScroll: number
): { left: boolean; right: boolean } {
  return {
    left: scrollLeft > EPSILON,
    right: scrollLeft < maxScroll - EPSILON
  };
}

// A chevron click pages by most of a viewport, keeping a sliver of the previous
// page on screen so the eye can carry across the jump.
const PAGE_FRACTION = 0.8;

export function tabStripPage(
  direction: 1 | -1,
  scrollLeft: number,
  viewportWidth: number,
  maxScroll: number
): number {
  return clampTabScroll(
    scrollLeft + direction * viewportWidth * PAGE_FRACTION,
    maxScroll
  );
}

// Where to scroll so the tab at `tabLeft` is visible. Selecting a repo from the
// command palette or the recent list has to bring its tab into view, and the
// active tab has to stay there.
export function tabIntoView(
  tabLeft: number,
  tabWidth: number,
  view: TabViewport
): number {
  const { scrollLeft, viewportWidth, maxScroll } = view;
  // A tab wider than the viewport cannot be shown whole; show its leading edge,
  // because that is where the repo name starts.
  if (tabWidth >= viewportWidth || tabLeft < scrollLeft) {
    return clampTabScroll(tabLeft, maxScroll);
  }
  const overshoot = tabLeft + tabWidth - (scrollLeft + viewportWidth);
  if (overshoot > 0) return clampTabScroll(scrollLeft + overshoot, maxScroll);
  return clampTabScroll(scrollLeft, maxScroll);
}
