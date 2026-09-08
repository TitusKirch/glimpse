// Pure commit-graph geometry: commits (with backend-assigned lanes) → the node
// coordinates and bézier edge paths the SVG renders. No Vue, no DOM — the
// interface is the test surface. Lane *assignment* is the backend's job
// (git::parse); this is only the visual projection of those lanes.

import type { Commit } from '~/stores/repo';
import type {
  GraphEdge,
  GraphLayout,
  GraphLayoutOptions,
  GraphNode
} from '~/types/graph';

const DEFAULTS = {
  rowHeight: 60,
  laneWidth: 18,
  originX: 18,
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

  const nodes: GraphNode[] = commits.map((c, i) => ({
    hash: c.hash,
    cx: laneX(c.lane),
    cy: nodeY(i),
    color: laneColor(c.lane)
  }));

  // A lane change is a straight run plus ONE rounded corner at the
  // divergence/merge node — never a full-height diagonal. The corner radius
  // *scales with the lane span*: a 2→3 jump keeps a tight laneWidth corner, a
  // 2→7 one curves through a visibly wider arc, so a far merge reads as a join
  // rather than as a square bracket around empty canvas.
  //
  // Two caps bound it. Half a row (`rowHeight / 2`) is the hard one — past it no
  // edge could stay inside the row it belongs to — and half the vertical
  // distance keeps a corner from overshooting a parent that sits further down
  // than one row. Beyond the cap the extra horizontal distance is a straight
  // segment, exactly as before.
  const cornerRadius = (dx: number, dy: number) =>
    Math.min(Math.abs(dx), rowHeight / 2, Math.abs(dy) / 2);
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
          const x = laneX(c.lane);
          edges.push({
            d: `M ${x} ${nodeY(i)} L ${x} ${height}`,
            color: laneColor(c.lane)
          });
          reserveLane(i, commits.length - 1, c.lane);
        }
        return;
      }
      edges.push({
        d: edgePath({
          x1: laneX(c.lane),
          y1: nodeY(i),
          x2: laneX(commits[j]!.lane),
          y2: nodeY(j)
        }),
        color: laneColor(Math.max(c.lane, commits[j]!.lane))
      });
      reserveLane(i, j, Math.max(c.lane, commits[j]!.lane));
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
  const maxLaneByRow = commits.map((c, i) => {
    for (const span of spansByStartRow.get(i) ?? []) {
      laneEndRow[span.lane] = Math.max(
        laneEndRow[span.lane] ?? -1,
        span.endRow
      );
    }
    let maxLane = c.lane;
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

  const maxLane = commits.reduce((m, c) => Math.max(m, c.lane), 0);
  return {
    nodes,
    edges,
    width: laneX(maxLane) + originX,
    height,
    rowHeight,
    widthForRows
  };
}
