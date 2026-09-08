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

// The row range the width is measured over, snapped out to fixed block
// boundaries around the rows in view.
//
// Measuring the visible rows *exactly* is what made scrolling feel broken: in a
// history whose lane depth varies, almost every scroll step pulls a deeper or
// shallower row through the virtualizer's overscan, so the column resizes
// continuously and the commit subjects' left edge never holds still. Neither
// transition fixes that — easing it turns a twitch into a slide, snapping it
// turns it into a stutter — because the fault is the *frequency* of the change,
// not its shape.
//
// Snapping the measured range to blocks makes the width constant while you
// scroll within a block, and moves it at most once per block boundary crossed.
// The column is then a little wider than the rows strictly need (it carries the
// block's deepest lane, not the viewport's) and still far narrower than the
// whole log, which is the trade this column exists to make.
export function measuredBlock(
  window: RowWindow,
  block: number,
  count: number
): RowWindow {
  if (count <= 0 || block <= 0) return window;
  const first = Math.max(0, Math.floor(window.first / block) * block);
  const last = Math.min(
    count - 1,
    Math.ceil((window.last + 1) / block) * block - 1
  );
  return { first, last: Math.max(first, last) };
}

interface GraphColumnWidthOptions {
  // Largest share of the pane the graph may take before it starts clipping and
  // scrolls on its own. The remainder is the commit list's guaranteed share.
  maxPaneFraction?: number;
  // The cap never falls below this, so even a very narrow pane still draws a
  // lane or two rather than a sliver.
  minWidth?: number;
  // How long a narrower stretch must hold before the column gives the width
  // back. Growing is never delayed; only shrinking waits.
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

  // Grow now, shrink after a hold — and then in one step, not across a
  // transition. An interpolated width was tried and reverted: sliding the
  // column while the rows it indents keep re-rendering read as a glitch rather
  // than as motion, and it kept the column wider than the rows needed for the
  // whole span of every shrink. The hold is what stops the edge twitching as
  // single rows enter and leave; once it expires the width is simply correct.
  const settled = ref(target.value);

  let settleTimer: ReturnType<typeof setTimeout> | undefined;
  const stopSettle = () => {
    if (settleTimer === undefined) return;
    clearTimeout(settleTimer);
    settleTimer = undefined;
  };

  // Until the pane has been measured there is no cap, so `settled` is seeded at
  // whatever the rows asked for — on a pathological history, far too wide. The
  // first measurement corrects that seed rather than reclaiming width, so it
  // lands at once; a pane that merely resizes later goes through the rule below.
  watch(cap, (next, previous) => {
    if (previous !== Number.POSITIVE_INFINITY) return;
    if (next === Number.POSITIVE_INFINITY) return;
    stopSettle();
    settled.value = target.value;
  });

  watch(target, (next) => {
    if (next >= settled.value) {
      stopSettle();
      settled.value = next;
      return;
    }
    // Settle once: a stretch that keeps narrowing arrives one hold after it
    // started narrowing, rather than pushing the deadline back on every row.
    if (settleTimer !== undefined) return;
    settleTimer = setTimeout(() => {
      settleTimer = undefined;
      settled.value = target.value;
    }, settleDelay);
  });

  onScopeDispose(stopSettle);

  // How far the graph reaches past the column it is actually drawn in — the pan
  // range the component's own horizontal scroll has to cover. Measured against
  // the width on screen, not the target, so a column still holding a wider
  // stretch correctly reports nothing to pan until it has given the width back.
  // Past the cap the column shows less than the graph draws, and says by how
  // much: the component turns that into its own horizontal scroll rather than
  // hiding it.
  const overflow = computed(() => Math.max(0, toValue(needed) - settled.value));

  return { width: readonly(settled), overflow };
}
