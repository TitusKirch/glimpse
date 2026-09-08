import { describe, expect, it } from 'vitest';
import type { Commit } from '~/types/bindings';
import { commitGraphLayout } from './commitGraphLayout';

function commit(hash: string, lane: number, parents: string[] = []): Commit {
  return { hash, subject: '', author: '', date: '', refs: [], parents, lane };
}

describe('commitGraphLayout', () => {
  it('positions nodes by lane (x) and index (y)', () => {
    const { nodes } = commitGraphLayout({
      commits: [commit('a', 0, ['b']), commit('b', 1)]
    });
    expect(nodes[0]).toMatchObject({ hash: 'a', cx: 18, cy: 30 });
    // lane 1 -> originX + laneWidth = 36; second row -> rowHeight*1.5 = 90
    expect(nodes[1]).toMatchObject({ hash: 'b', cx: 36, cy: 90 });
  });

  it('draws a straight edge when parent shares the lane', () => {
    const { edges } = commitGraphLayout({
      commits: [commit('a', 0, ['b']), commit('b', 0)]
    });
    expect(edges).toHaveLength(1);
    expect(edges[0]!.d).toBe('M 18 30 L 18 90');
  });

  it('width and height grow with lanes and commit count', () => {
    const layout = commitGraphLayout({
      commits: [commit('a', 2, []), commit('b', 0, [])]
    });
    expect(layout.width).toBe(18 + 2 * 18 + 18); // 72
    expect(layout.height).toBe(2 * 60); // 120
  });

  it('continues a lane to the bottom when the parent is outside the range', () => {
    // Parent not loaded (truncated history): draw the lane down to the bottom
    // edge so it doesn't look like a root commit.
    const { edges, height } = commitGraphLayout({
      commits: [commit('a', 0, ['missing'])]
    });
    expect(edges).toHaveLength(1);
    expect(edges[0]!.d).toBe(`M 18 30 L 18 ${height}`);
  });

  it('sizes the column from the rows in view, not from the whole log', () => {
    // A side branch that only exists in the older half of the window: lane 1 is
    // reached from the merge at row 2 downwards, rows 0-1 are single-lane.
    const layout = commitGraphLayout({
      commits: [
        commit('a', 0, ['b']),
        commit('b', 0, ['c']),
        commit('c', 0, ['d', 'e']),
        commit('d', 0, []),
        commit('e', 1, [])
      ]
    });
    // 1 lane in view -> originX + 0 * laneWidth + originX
    expect(layout.widthForRows(0, 1)).toBe(36);
    // 2 lanes in view -> the full width of this log
    expect(layout.widthForRows(0, 4)).toBe(54);
    expect(layout.width).toBe(54);
  });

  it('reserves the width of a lane an edge only passes through', () => {
    // A long-lived branch merged five commits later: lane 1 carries the merge
    // edge across rows 0-4 but has a node only on the last of them. Rows 2-3
    // still have to leave room for that edge.
    const layout = commitGraphLayout({
      commits: [
        commit('a', 0, ['b', 'e']),
        commit('b', 0, ['c']),
        commit('c', 0, ['d']),
        commit('d', 0, []),
        commit('e', 1, [])
      ]
    });
    expect(layout.widthForRows(2, 3)).toBe(54);
  });

  it('continues to reserve a lane only while its edge is running', () => {
    // Lane 1's edge ends at row 1; the rows below it are single-lane again and
    // give the width back.
    const layout = commitGraphLayout({
      commits: [
        commit('a', 0, ['b', 'x']),
        commit('x', 1, ['b']),
        commit('b', 0, ['c']),
        commit('c', 0, [])
      ]
    });
    expect(layout.widthForRows(0, 1)).toBe(54);
    expect(layout.widthForRows(3, 3)).toBe(36);
  });

  it('draws no edge for a real root commit (no parents)', () => {
    const { edges } = commitGraphLayout({ commits: [commit('a', 0, [])] });
    expect(edges).toHaveLength(0);
  });
});
