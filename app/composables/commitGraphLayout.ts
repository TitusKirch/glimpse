// Pure commit-graph geometry: commits (with backend-assigned lanes) → the node
// coordinates and bézier edge paths the SVG renders. No Vue, no DOM — the
// interface is the test surface. Lane *assignment* is the backend's job
// (git::parse); this is only the visual projection of those lanes.

import type { Commit } from '~/stores/repo';

export interface GraphNode {
  hash: string;
  cx: number;
  cy: number;
  color: string;
}

export interface GraphEdge {
  d: string;
  color: string;
}

export interface GraphLayout {
  nodes: GraphNode[];
  edges: GraphEdge[];
  width: number;
  height: number;
  rowHeight: number;
}

export interface GraphLayoutOptions {
  rowHeight?: number;
  laneWidth?: number;
  originX?: number;
  colors?: string[];
}

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

export function commitGraphLayout(
  commits: Commit[],
  options: GraphLayoutOptions = {}
): GraphLayout {
  const { rowHeight, laneWidth, originX, colors } = {
    ...DEFAULTS,
    ...options
  };
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

  // A lane change is drawn as a straight vertical run plus a tight rounded 90°
  // corner at the divergence/merge node, not a full-height diagonal — so
  // parallel branches read as straight lines.
  const edgePath = (x1: number, y1: number, x2: number, y2: number) => {
    if (x1 === x2) return `M ${x1} ${y1} L ${x2} ${y2}`;
    const r = Math.min(rowHeight / 2, Math.abs(y2 - y1) / 2);
    if (x2 > x1) {
      // Child shifts into a higher lane: corner just below the child (merge).
      return `M ${x1} ${y1} C ${x1} ${y1 + r}, ${x2} ${y1}, ${x2} ${y1 + r} L ${x2} ${y2}`;
    }
    // Child rejoins a lower lane: straight down, corner at the parent (branch).
    return `M ${x1} ${y1} L ${x1} ${y2 - r} C ${x1} ${y2}, ${x2} ${y2 - r}, ${x2} ${y2}`;
  };

  const edges: GraphEdge[] = [];
  commits.forEach((c, i) => {
    for (const parent of c.parents) {
      const j = indexByHash.get(parent);
      if (j === undefined) continue;
      edges.push({
        d: edgePath(laneX(c.lane), nodeY(i), laneX(commits[j]!.lane), nodeY(j)),
        color: laneColor(Math.max(c.lane, commits[j]!.lane))
      });
    }
  });

  const maxLane = commits.reduce((m, c) => Math.max(m, c.lane), 0);
  return {
    nodes,
    edges,
    width: laneX(maxLane) + originX,
    height: commits.length * rowHeight,
    rowHeight
  };
}
