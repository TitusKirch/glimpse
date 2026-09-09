import { describe, expect, it } from 'vitest';
import type { Commit } from '~/types/bindings';
import { commitGraphLayout } from './commitGraphLayout';
import { graphWindow } from './graphWindow';
import type { GraphEdge, GraphNode } from '~/types/graph';

function node(row: number): GraphNode {
  return { hash: `c${row}`, row, cx: 10, cy: 30 + row * 60, color: '#22c55e' };
}

function edge(topRow: number, bottomRow: number): GraphEdge {
  return { d: `${topRow}->${bottomRow}`, color: '#22c55e', topRow, bottomRow };
}

function commit(hash: string, lane: number, parents: string[] = []): Commit {
  return {
    hash,
    subject: '',
    author: '',
    date: '',
    refs: [],
    parents,
    lane,
    signatureStatus: '',
    signerName: '',
    signerKey: ''
  };
}

describe('graphWindow', () => {
  it('keeps only the nodes whose rows are in the window', () => {
    const graph = { nodes: [0, 1, 2, 3, 4].map(node), edges: [] };
    expect(
      graphWindow(graph, { first: 1, last: 3 }).nodes.map((n) => n.row)
    ).toEqual([1, 2, 3]);
  });

  it('keeps the nodes sitting exactly on the window edges', () => {
    // Off-by-one here shows as the top and bottom commit dots missing while
    // their rows are plainly on screen.
    const graph = { nodes: [0, 1, 2].map(node), edges: [] };
    expect(
      graphWindow(graph, { first: 0, last: 2 }).nodes.map((n) => n.row)
    ).toEqual([0, 1, 2]);
  });

  it('keeps an edge that crosses the window with both ends outside it', () => {
    // The failure this whole module has to avoid: a branch merged far below
    // where it diverged has NO endpoint anywhere near the middle of its own
    // run. Windowing edges by "does an endpoint land in view" would erase the
    // long line for every screen it passes through, leaving a lane that stops
    // at the top of the viewport and reappears below it.
    const graph = { nodes: [], edges: [edge(2, 400)] };
    expect(graphWindow(graph, { first: 100, last: 120 }).edges).toHaveLength(1);
  });

  it('keeps an edge that only reaches into the window from above', () => {
    const graph = { nodes: [], edges: [edge(3, 11)] };
    expect(graphWindow(graph, { first: 10, last: 20 }).edges).toHaveLength(1);
  });

  it('keeps an edge that only reaches into the window from below', () => {
    const graph = { nodes: [], edges: [edge(19, 40)] };
    expect(graphWindow(graph, { first: 10, last: 20 }).edges).toHaveLength(1);
  });

  it('keeps an edge that merely touches a window edge', () => {
    // Endpoint on the boundary row: half of its corner is still drawn inside
    // the window, so dropping it clips a visible line.
    const graph = { nodes: [], edges: [edge(1, 10), edge(20, 33)] };
    expect(graphWindow(graph, { first: 10, last: 20 }).edges).toHaveLength(2);
  });

  it('drops an edge that lies entirely above or below the window', () => {
    const graph = { nodes: [], edges: [edge(0, 9), edge(21, 30)] };
    expect(graphWindow(graph, { first: 10, last: 20 }).edges).toEqual([]);
  });

  it('reads a window given back to front', () => {
    const graph = { nodes: [0, 1, 2].map(node), edges: [edge(0, 1)] };
    const w = graphWindow(graph, { first: 2, last: 0 });
    expect(w.nodes.map((n) => n.row)).toEqual([0, 1, 2]);
    expect(w.edges).toHaveLength(1);
  });

  it('bounds the drawn graph by the window, not by the loaded history', () => {
    // The point of the exercise: 500 commits in a single lane must still mount
    // a screenful of graphics, not 500 circles and 500 paths.
    const commits = Array.from({ length: 500 }, (_, i) =>
      commit(`c${i}`, 0, i < 499 ? [`c${i + 1}`] : [])
    );
    const layout = commitGraphLayout({ commits });
    const w = graphWindow(layout, { first: 200, last: 224 });
    expect(w.nodes).toHaveLength(25);
    // 25 rows of one-lane history: the edges into the window plus the one
    // arriving from the row above it.
    expect(w.edges.length).toBeLessThanOrEqual(26);
  });

  it('still draws a lane running off the bottom of a truncated history', () => {
    // The "history continues below" edge starts at its own commit and runs to
    // the very bottom. Scrolled far past that commit it is the only thing
    // holding the lane open, so its span has to keep it alive.
    const commits = Array.from({ length: 100 }, (_, i) =>
      commit(`c${i}`, 0, [`c${i + 1}`])
    );
    const layout = commitGraphLayout({ commits });
    const w = graphWindow(layout, { first: 98, last: 99 });
    expect(w.edges.some((e) => e.d.endsWith(`L 10 ${layout.height}`))).toBe(
      true
    );
  });

  it('keeps a long merge line alive through the rows it crosses', () => {
    // Same case as the synthetic crossing test, but through the real layout: a
    // branch that diverges at row 0 and is merged back 40 rows later.
    const commits = [
      commit('head', 0, ['main1', 'side']),
      ...Array.from({ length: 40 }, (_, i) =>
        commit(`main${i + 1}`, 0, [`main${i + 2}`])
      ),
      commit('side', 1, ['main41'])
    ];
    const layout = commitGraphLayout({ commits });
    const w = graphWindow(layout, { first: 15, last: 25 });
    // Lane 1's line has no node in these rows at all, yet must be drawn.
    expect(w.nodes.every((n) => n.cx === 10)).toBe(true);
    expect(w.edges.some((e) => e.topRow <= 15 && e.bottomRow >= 25)).toBe(true);
  });
});
