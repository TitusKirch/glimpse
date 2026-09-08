// Geometry types for the commit-graph projection (see composables/commitGraphLayout).
// Kept out of the composable so that file holds a single same-named export.

export interface GraphNode {
  hash: string;
  // The row this node sits in, so the drawn graph can be windowed against the
  // same row range the commit rows are virtualized over (see graphWindow).
  row: number;
  cx: number;
  cy: number;
  color: string;
}

export interface GraphEdge {
  d: string;
  color: string;
  // The rows this edge runs over, normalised so `topRow <= bottomRow`. An edge
  // occupies every row between its endpoints, not just the two that carry
  // them, so windowing it needs the span rather than the endpoints — a merge
  // line 40 rows long has nothing to anchor it in the rows it merely crosses.
  topRow: number;
  bottomRow: number;
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
