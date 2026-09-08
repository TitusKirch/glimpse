// How wide the commit graph's column is allowed to be. The geometry itself is
// `commitGraphLayout`'s job; this is the policy on top of it — how much of the
// pane the graph may claim, and how the width is allowed to change while the
// user scrolls. Kept out of the component so both questions are answerable
// without a DOM.

import {
  computed,
  onScopeDispose,
  readonly,
  ref,
  toValue,
  watch,
  type MaybeRefOrGetter
} from 'vue';

interface GraphColumnWidthOptions {
  // Largest share of the pane the graph may take before it starts clipping and
  // scrolls on its own. The remainder is the commit list's guaranteed share.
  maxPaneFraction?: number;
  // The cap never falls below this, so even a very narrow pane still draws a
  // lane or two rather than a sliver.
  minWidth?: number;
  // How long a narrower stretch has to hold before the column gives the width
  // back. Growing is never delayed — only shrinking is.
  settleDelay?: number;
}

export function useGraphColumnWidth(
  needed: MaybeRefOrGetter<number>,
  paneWidth: MaybeRefOrGetter<number>,
  options: GraphColumnWidthOptions = {}
) {
  const { maxPaneFraction = 0.4, minWidth = 54, settleDelay = 400 } = options;

  const cap = computed(() => {
    const pane = toValue(paneWidth);
    // An unmeasured pane (first tick, or a collapsed panel) is not a cap of
    // zero — there is simply nothing to cap against yet.
    if (!(pane > 0)) return Number.POSITIVE_INFINITY;
    return Math.max(minWidth, pane * maxPaneFraction);
  });

  const target = computed(() => Math.min(toValue(needed), cap.value));
  // Past the cap the column shows less than the graph draws, and says so: the
  // component turns that into its own horizontal scroll rather than hiding it.
  const overflows = computed(() => toValue(needed) > target.value);

  // Grow now, shrink later. A wider stretch scrolling into view must widen the
  // column at once or its lanes would be clipped for a frame; a narrower one
  // only reclaims the width after it has held, so the commit column's left edge
  // does not flicker on every row that happens to be single-lane.
  const settled = ref(target.value);
  let reclaim: ReturnType<typeof setTimeout> | undefined;
  const cancelReclaim = () => {
    if (reclaim === undefined) return;
    clearTimeout(reclaim);
    reclaim = undefined;
  };

  watch(target, (next) => {
    if (next >= settled.value) {
      cancelReclaim();
      settled.value = next;
      return;
    }
    // A wait is already running: let it finish rather than restarting it, so a
    // stretch that keeps narrowing settles after one delay, not never.
    if (reclaim !== undefined) return;
    reclaim = setTimeout(() => {
      reclaim = undefined;
      settled.value = target.value;
    }, settleDelay);
  });

  onScopeDispose(cancelReclaim);

  return { width: readonly(settled), overflows };
}
