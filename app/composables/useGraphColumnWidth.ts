// How wide the commit graph's column is allowed to be. The geometry itself is
// `commitGraphLayout`'s job; this is the policy on top of it — which rows the
// width is measured from, how much of the pane the graph may claim, and how the
// width is allowed to move while the user scrolls. Kept out of the component so
// all three are answerable without a DOM.

import {
  computed,
  onScopeDispose,
  readonly,
  ref,
  toValue,
  watch,
  type MaybeRefOrGetter
} from 'vue';

export interface RowWindow {
  first: number;
  last: number;
}

// Extend the measured row range in the direction of travel, past the rows the
// virtualizer is holding. A wider stretch then raises the column's width while
// its rows are still below the fold, so the width *leads* the scroll instead of
// stepping up the moment a wide row appears. Growth cannot be eased — a lane
// drawn outside the gutter is a lane lost — so arriving early is what makes it
// read as continuous.
export function lookaheadWindow(
  window: RowWindow,
  direction: -1 | 1,
  rows: number,
  count: number
): RowWindow {
  if (count <= 0) return window;
  const last = Math.min(count - 1, window.last);
  if (direction > 0) {
    return { first: window.first, last: Math.min(count - 1, last + rows) };
  }
  return { first: Math.max(0, window.first - rows), last };
}

interface GraphColumnWidthOptions {
  // Largest share of the pane the graph may take before it starts clipping and
  // scrolls on its own. The remainder is the commit list's guaranteed share.
  maxPaneFraction?: number;
  // The cap never falls below this, so even a very narrow pane still draws a
  // lane or two rather than a sliver.
  minWidth?: number;
  // How long the column takes to give width back. Growing is never delayed —
  // only shrinking, and it eases across this span rather than waiting it out.
  settleDelay?: number;
  // How often the ease steps while it is running. Nothing is scheduled once the
  // column has settled.
  frameInterval?: number;
}

export function useGraphColumnWidth(
  needed: MaybeRefOrGetter<number>,
  paneWidth: MaybeRefOrGetter<number>,
  options: GraphColumnWidthOptions = {}
) {
  const {
    maxPaneFraction = 0.4,
    minWidth = 54,
    settleDelay = 400,
    frameInterval = 16
  } = options;

  const cap = computed(() => {
    const pane = toValue(paneWidth);
    // An unmeasured pane (first tick, or a collapsed panel) is not a cap of
    // zero — there is simply nothing to cap against yet.
    if (!(pane > 0)) return Number.POSITIVE_INFINITY;
    return Math.max(minWidth, pane * maxPaneFraction);
  });

  const target = computed(() => Math.min(toValue(needed), cap.value));

  // Grow now, ease down later. A wider stretch scrolling into view must widen
  // the column at once or its lanes would be clipped; a narrower one gives the
  // width back over `settleDelay`, so the commit column's left edge slides
  // rather than snapping every time a row enters or leaves the viewport.
  const settled = ref(target.value);

  let ease: ReturnType<typeof setInterval> | undefined;
  // The value and the moment the run in flight interpolates from, plus the
  // deadline it interpolates to. Retargeting moves the first two; the deadline
  // is what "settle once, don't restart the wait" preserves.
  let easeFrom = 0;
  let easeSince = 0;
  let easeUntil = 0;

  const stopEase = () => {
    if (ease === undefined) return;
    clearInterval(ease);
    ease = undefined;
  };

  const stepEase = () => {
    const now = Date.now();
    if (now >= easeUntil) {
      stopEase();
      settled.value = target.value;
      return;
    }
    const span = easeUntil - easeSince;
    const progress = span > 0 ? (now - easeSince) / span : 1;
    settled.value = easeFrom + (target.value - easeFrom) * progress;
  };

  // Until the pane has been measured there is no cap, so `settled` is seeded at
  // whatever the rows asked for — on a pathological history, far too wide. The
  // first measurement corrects that seed rather than reclaiming width, so it
  // lands at once; a pane that merely resizes later goes through the rule below.
  watch(cap, (next, previous) => {
    if (previous !== Number.POSITIVE_INFINITY) return;
    if (next === Number.POSITIVE_INFINITY) return;
    stopEase();
    settled.value = target.value;
  });

  watch(target, (next) => {
    if (next >= settled.value) {
      stopEase();
      settled.value = next;
      return;
    }
    if (ease !== undefined) {
      // Retarget the run in flight from where it has got to, keeping its
      // deadline, so a stretch that keeps narrowing arrives after one delay
      // rather than never — and without the value jumping as it retargets.
      easeFrom = settled.value;
      easeSince = Date.now();
      return;
    }
    easeFrom = settled.value;
    easeSince = Date.now();
    easeUntil = easeSince + settleDelay;
    ease = setInterval(stepEase, frameInterval);
  });

  onScopeDispose(stopEase);

  // How far the graph reaches past the column it is actually drawn in — the pan
  // range the component's own horizontal scroll has to cover. Measured against
  // the width on screen, not the target, so a column still easing down from a
  // wider stretch correctly reports nothing to pan while it is on the way.
  // Past the cap the column shows less than the graph draws, and says by how
  // much: the component turns that into its own horizontal scroll rather than
  // hiding it.
  const overflow = computed(() => Math.max(0, toValue(needed) - settled.value));

  return { width: readonly(settled), overflow };
}
