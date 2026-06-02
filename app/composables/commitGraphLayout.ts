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

  // A lane change is a straight run plus ONE fixed-radius rounded corner at the
  // divergence/merge node — never a full-height diagonal. The corner radius is
  // constant regardless of how many lanes the edge spans, so a 2→3 jump curves
  // with the same "schwung" as a 2→7 one; the extra horizontal distance is just
  // a straight segment, not a flatter curve.
  const r = laneWidth;
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
    const rr = Math.min(r, Math.abs(y2 - y1) / 2);
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
    });
  });

  // Edges are built newest-first (index 0 = top row). SVG paints later elements
  // on top, so reverse them: an earlier (upper) row's edge then sits above a
  // later (lower) row's where they overlap, instead of the other way round.
  edges.reverse();

  const maxLane = commits.reduce((m, c) => Math.max(m, c.lane), 0);
  return {
    nodes,
    edges,
    width: laneX(maxLane) + originX,
    height,
    rowHeight
  };
}
