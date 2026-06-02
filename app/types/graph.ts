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
