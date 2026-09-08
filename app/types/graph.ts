// Geometry types for the commit-graph projection (see composables/commitGraphLayout).
// Kept out of the composable so that file holds a single same-named export.

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
  // Width the whole loaded log needs — the SVG's own content width.
  width: number;
  height: number;
  rowHeight: number;
  // Width the graph column needs to draw the rows `startRow`..`endRow`
  // (inclusive) without clipping a lane, so the column can follow the viewport
  // instead of the whole loaded log.
  widthForRows: (startRow: number, endRow: number) => number;
}

export interface GraphLayoutOptions {
  rowHeight?: number;
  laneWidth?: number;
  originX?: number;
  colors?: string[];
}
