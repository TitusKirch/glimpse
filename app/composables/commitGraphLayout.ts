// Pure commit-graph geometry: commits (with backend-assigned lanes) → the node
// coordinates and bézier edge paths the SVG renders. No Vue, no DOM — the
// interface is the test surface. Lane *assignment* is the backend's job
// (git::parse); this is only the visual projection of those lanes, plus the one
// revision `commitGraphLanes` makes to them before they are projected.

import type { Commit } from '~/stores/repo';
import { commitGraphLanes } from './commitGraphLanes';
import type {
  GraphEdge,
  GraphLayout,
  GraphLayoutOptions,
  GraphNode
} from '~/types/graph';

const DEFAULTS = {
  rowHeight: 60,
  laneWidth: 14,
  originX: 10,
  // A wide hue spread so many parallel lanes stay visually distinct.
  colors: [
    '#22c55e', // green
    '#3b82f6', // blue
    '#f59e0b', // amber
    '#ec4899', // pink
    '#a855f7', // purple
    '#06b6d4', // cyan
    '#ef4444', // red
    '#84cc16', // lime
    '#f97316', // orange
    '#14b8a6' // teal
  ]
};

export function commitGraphLayout({
  commits,
  rowHeight = DEFAULTS.rowHeight,
  laneWidth = DEFAULTS.laneWidth,
  originX = DEFAULTS.originX,
  colors = DEFAULTS.colors
}: { commits: Commit[] } & GraphLayoutOptions): GraphLayout {
  const laneX = (lane: number) => originX + lane * laneWidth;
  const nodeY = (i: number) => rowHeight / 2 + i * rowHeight;
  const laneColor = (lane: number) => colors[lane % colors.length]!;

  const indexByHash = new Map<string, number>();
  commits.forEach((c, i) => indexByHash.set(c.hash, i));

  // A branch's lane can change once, at one of its own commits, where the lane
  // it was given has gone stale and a shallower one has fallen free for the
  // rest of its run. Everything below reads lanes from here rather than from
  // the commit, so the move is drawn by the geometry that is already here.
  const laneOf = commitGraphLanes(commits);

  const nodes: GraphNode[] = commits.map((c, i) => ({
    hash: c.hash,
    cx: laneX(laneOf[i]!),
    cy: nodeY(i),
    color: laneColor(laneOf[i]!)
  }));

  // A lane change is a straight run plus ONE rounded corner at the
  // divergence/merge node — never a full-height diagonal, and never an arc that
  // grows with the distance jumped. The radius is one lane wide whatever the
  // span, so a far merge is a long straight run ending in the same tight corner
  // a neighbouring one gets.
  //
  // This deliberately replaces a radius that *scaled* with the lane span. That
  // read as a sweeping bracket around empty canvas on wide jumps — the very
  // shape the scaling was meant to avoid — because a corner wider than the lane
  // spacing it lives in curves across its neighbours. Half the vertical
  // distance is the second cap, and keeps a corner from overshooting a parent
  // further down than one row. Past either cap the rest is a straight segment.
  const cornerRadius = (dx: number, dy: number) =>
    Math.min(Math.abs(dx), laneWidth, Math.abs(dy) / 2);
  const edgePath = ({
    x1,
    y1,
    x2,
    y2
  }: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  }) => {
    if (x1 === x2) return `M ${x1} ${y1} L ${x2} ${y2}`;
    const rr = cornerRadius(x2 - x1, y2 - y1);
    if (x2 > x1) {
      // Merge: sideways out of the child, one rounded corner into the parent's
      // lane, then straight down.
      return `M ${x1} ${y1} L ${x2 - rr} ${y1} Q ${x2} ${y1}, ${x2} ${y1 + rr} L ${x2} ${y2}`;
    }
    // Branch: straight down this lane, one rounded corner near the parent, then
    // sideways into the lower lane.
    return `M ${x1} ${y1} L ${x1} ${y2 - rr} Q ${x1} ${y2}, ${x1 - rr} ${y2} L ${x2} ${y2}`;
  };

  const height = commits.length * rowHeight;

  // An edge occupies its lanes on every row it crosses, not only on the rows
  // that carry its endpoints — a branch merged twenty commits later has no node
  // in between, yet its lane has to stay clear there. Each edge is recorded
  // against its deepest lane and the row span it runs over.
  const spansByStartRow = new Map<number, { lane: number; endRow: number }[]>();
  const reserveLane = (startRow: number, endRow: number, lane: number) => {
    const spans = spansByStartRow.get(startRow);
    if (spans) spans.push({ lane, endRow });
    else spansByStartRow.set(startRow, [{ lane, endRow }]);
  };

  const edges: GraphEdge[] = [];
  commits.forEach((c, i) => {
    c.parents.forEach((parent, pi) => {
      const j = indexByHash.get(parent);
      if (j === undefined) {
        // The parent is beyond the loaded window (older history). Continue this
        // commit's lane straight down to the bottom edge so a truncated branch
        // reads as "history continues below" instead of looking like a root.
        // Only the first parent owns this lane; a merge's extra parent that left
        // the window gets no phantom line (and the backend reserves it no lane).
        if (pi === 0) {
          const x = laneX(laneOf[i]!);
          edges.push({
            d: `M ${x} ${nodeY(i)} L ${x} ${height}`,
            color: laneColor(laneOf[i]!)
          });
          reserveLane(i, commits.length - 1, laneOf[i]!);
        }
        return;
      }
      edges.push({
        d: edgePath({
          x1: laneX(laneOf[i]!),
          y1: nodeY(i),
          x2: laneX(laneOf[j]!),
          y2: nodeY(j)
        }),
        color: laneColor(Math.max(laneOf[i]!, laneOf[j]!))
      });
      reserveLane(i, j, Math.max(laneOf[i]!, laneOf[j]!));
    });
  });

  // Edges are built newest-first (index 0 = top row). SVG paints later elements
  // on top, so reverse them: an earlier (upper) row's edge then sits above a
  // later (lower) row's where they overlap, instead of the other way round.
  edges.reverse();

  // Deepest lane in use at each row: the row's own commit plus every lane an
  // edge is still running through. Rows are swept top-down, so a lane the
  // backend freed and handed to a later branch is only counted while that
  // branch's own edge is live.
  const laneEndRow: number[] = [];
  const maxLaneByRow = commits.map((_, i) => {
    for (const span of spansByStartRow.get(i) ?? []) {
      laneEndRow[span.lane] = Math.max(
        laneEndRow[span.lane] ?? -1,
        span.endRow
      );
    }
    let maxLane = laneOf[i]!;
    for (let lane = laneEndRow.length - 1; lane > maxLane; lane--) {
      if ((laneEndRow[lane] ?? -1) >= i) {
        maxLane = lane;
        break;
      }
    }
    return maxLane;
  });

  const widthForRows = (startRow: number, endRow: number) => {
    const from = Math.max(0, Math.min(startRow, endRow));
    const to = Math.min(commits.length - 1, Math.max(startRow, endRow));
    let maxLane = 0;
    for (let i = from; i <= to; i++)
      maxLane = Math.max(maxLane, maxLaneByRow[i]!);
    return laneX(maxLane) + originX;
  };

  const maxLane = laneOf.reduce((m, lane) => Math.max(m, lane), 0);
  return {
    nodes,
    edges,
    width: laneX(maxLane) + originX,
    height,
    rowHeight,
    widthForRows
  };
}
