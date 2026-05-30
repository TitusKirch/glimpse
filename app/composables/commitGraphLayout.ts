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

  const edges: GraphEdge[] = [];
  commits.forEach((c, i) => {
    for (const parent of c.parents) {
      const j = indexByHash.get(parent);
      if (j === undefined) continue;
      const x1 = laneX(c.lane);
      const y1 = nodeY(i);
      const x2 = laneX(commits[j]!.lane);
      const y2 = nodeY(j);
      const midY = (y1 + y2) / 2;
      edges.push({
        d: `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`,
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
