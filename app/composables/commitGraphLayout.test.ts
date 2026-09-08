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
    expect(nodes[0]).toMatchObject({ hash: 'a', cx: 10, cy: 30 });
    // lane 1 -> originX + laneWidth = 24; second row -> rowHeight*1.5 = 90
    expect(nodes[1]).toMatchObject({ hash: 'b', cx: 24, cy: 90 });
  });

  it('draws a straight edge when parent shares the lane', () => {
    const { edges } = commitGraphLayout({
      commits: [commit('a', 0, ['b']), commit('b', 0)]
    });
    expect(edges).toHaveLength(1);
    expect(edges[0]!.d).toBe('M 10 30 L 10 90');
  });

  it('width and height grow with lanes and commit count', () => {
    const layout = commitGraphLayout({
      commits: [commit('a', 2, []), commit('b', 0, [])]
    });
    expect(layout.width).toBe(10 + 2 * 14 + 10); // 48
    expect(layout.height).toBe(2 * 60); // 120
  });

  it('continues a lane to the bottom when the parent is outside the range', () => {
    // Parent not loaded (truncated history): draw the lane down to the bottom
    // edge so it doesn't look like a root commit.
    const { edges, height } = commitGraphLayout({
      commits: [commit('a', 0, ['missing'])]
    });
    expect(edges).toHaveLength(1);
    expect(edges[0]!.d).toBe(`M 10 30 L 10 ${height}`);
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
    expect(layout.widthForRows(0, 1)).toBe(20);
    // 2 lanes in view -> the full width of this log
    expect(layout.widthForRows(0, 4)).toBe(34);
    expect(layout.width).toBe(34);
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
    expect(layout.widthForRows(2, 3)).toBe(34);
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
    expect(layout.widthForRows(0, 1)).toBe(34);
    expect(layout.widthForRows(3, 3)).toBe(20);
  });

  it('gives a merge edge the same tight corner however far it jumps', () => {
    // One lane across: the corner is a laneWidth (14) radius, so the straight
    // run out of the child has zero length.
    const oneLane = commitGraphLayout({
      commits: [commit('a', 0, ['b']), commit('b', 1)]
    });
    expect(oneLane.edges[0]!.d).toBe('M 10 30 L 10 30 Q 24 30, 24 44 L 24 90');

    // Two lanes across: the SAME corner, reached after a longer straight run.
    // A radius that grew with the span curved across the lanes it spanned,
    // which is what read as a bracket around empty canvas.
    const twoLanes = commitGraphLayout({
      commits: [commit('a', 0, ['b']), commit('b', 2)]
    });
    expect(twoLanes.edges[0]!.d).toBe('M 10 30 L 24 30 Q 38 30, 38 44 L 38 90');
  });

  it('caps the corner at one lane so no edge sweeps across its neighbours', () => {
    // Six lanes across, and the parent five rows down so the vertical distance
    // is not what bounds the corner: the radius still stops at laneWidth.
    const { edges } = commitGraphLayout({
      commits: [
        commit('a', 0, ['f']),
        commit('b', 0),
        commit('c', 0),
        commit('d', 0),
        commit('e', 0),
        commit('f', 6)
      ]
    });
    expect(edges[0]!.d).toBe('M 10 30 L 80 30 Q 94 30, 94 44 L 94 330');
  });

  it('uses the same corner where a branch leaves its lane', () => {
    // The mirrored path: child on the higher lane, parent two lanes left.
    const { edges } = commitGraphLayout({
      commits: [commit('a', 2, ['b']), commit('b', 0)]
    });
    expect(edges[0]!.d).toBe('M 38 30 L 38 76 Q 38 90, 24 90 L 10 90');
  });

  it('draws no edge for a real root commit (no parents)', () => {
    const { edges } = commitGraphLayout({ commits: [commit('a', 0, [])] });
    expect(edges).toHaveLength(0);
  });
});
