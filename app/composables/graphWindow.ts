// Which of the graph's drawn parts are mounted at all. The row virtualizer
// already windows the commit rows; the SVG gutter beside them did not, so a
// loaded history kept one `<path>` and one `<circle>` alive per commit — after
// a few pages of "load more history" that is thousands of elements, all but a
// screenful of them scrolled out of view.
//
// The decision is arithmetic over row indices, so it lives here rather than in
// the component: the failure mode it has to avoid does not show up in a
// screenshot of the top of the list. An edge spans rows, and a branch merged
// far below where it diverged has NO endpoint anywhere near the middle of its
// own run. Keeping edges by "does an endpoint land in the window" would erase
// exactly those long lines for every screen they pass through — a lane that
// stops dead at the top of the viewport and reappears below it. So an edge is
// kept when its row span *intersects* the window, never when it starts inside
// it.

import type { GraphEdge, GraphNode } from '~/types/graph';
import type { RowWindow } from './useGraphColumnWidth';

export interface WindowedGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export function graphWindow(
  graph: { nodes: GraphNode[]; edges: GraphEdge[] },
  rows: RowWindow
): WindowedGraph {
  // The window arrives from the virtualizer, which reports its items in
  // ascending order — but reading it back to front would silently window down
  // to nothing, so it is normalised rather than trusted.
  const first = Math.min(rows.first, rows.last);
  const last = Math.max(rows.first, rows.last);
  return {
    // A node sits in exactly one row, so containment is the whole test. The
    // window already carries the virtualizer's overscan, which is what keeps a
    // dot from popping in at the edge of the viewport.
    nodes: graph.nodes.filter((n) => n.row >= first && n.row <= last),
    // Inclusive at both ends: an edge that terminates on the boundary row
    // still draws its corner inside the window.
    edges: graph.edges.filter((e) => e.bottomRow >= first && e.topRow <= last)
  };
}
