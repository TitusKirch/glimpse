// Past its cap the graph column shows less than the graph draws, so it pans
// horizontally rather than hiding lanes. The gutter is click-through (rows stay
// selectable across their full width), so the pan is forwarded from the list's
// wheel events — which means this code decides, per event, whether a gesture
// belongs to the graph at all. Getting that wrong costs the commit list its
// vertical scrolling, so the decision lives here as a pure function instead of
// inside the component, where nothing could test it.

export interface WheelGesture {
  deltaX: number;
  deltaY: number;
  shiftKey: boolean;
}

export interface GraphPan {
  // Where the gutter should be scrolled to, already clamped to the graph.
  scrollLeft: number;
  // Whether the gesture is the graph's — and so whether the event should be
  // taken from the commit list. False whenever nothing actually moved.
  claim: boolean;
}

export function clampGraphPan(scrollLeft: number, maxPan: number): number {
  return Math.min(Math.max(0, scrollLeft), Math.max(0, maxPan));
}

export function graphPanTarget(
  gesture: WheelGesture,
  scrollLeft: number,
  maxPan: number
): GraphPan {
  const current = clampGraphPan(scrollLeft, maxPan);
  // A trackpad's vertical swipe carries a little sideways drift, so `deltaX`
  // alone is no signal of intent: pan only when the gesture is mostly sideways,
  // or when shift says so outright.
  const horizontal =
    gesture.shiftKey || Math.abs(gesture.deltaX) > Math.abs(gesture.deltaY);
  // Shift+wheel reaches us either way round: some browsers translate it into
  // `deltaX` themselves, others leave it on `deltaY`.
  const dx =
    gesture.deltaX !== 0
      ? gesture.deltaX
      : gesture.shiftKey
        ? gesture.deltaY
        : 0;
  const next = horizontal ? clampGraphPan(current + dx, maxPan) : current;
  // Claiming an event that changed nothing swallows the gesture at either
  // extreme, and once the column stops overflowing there is nothing left to
  // swallow it for.
  return { scrollLeft: next, claim: next !== scrollLeft };
}
