import { describe, expect, it } from 'vitest';
import type { Commit } from '~/types/bindings';
import { commitGraphLayout } from './commitGraphLayout';

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
    //
    // Lanes 1-3 carry branches of their own for the whole span, which is what
    // makes lane 6 a lane the branch has to stay on: with the canvas between
    // empty, `commitGraphLanes` would compact it and there would be no wide
    // jump left to cap.
    const { edges } = commitGraphLayout({
      commits: [
        commit('a', 0, ['b', 'p', 'q', 'r', 'f']),
        commit('b', 0),
        commit('p', 1),
        commit('q', 2),
        commit('r', 3),
        commit('f', 6)
      ]
    });
    expect(edges[0]!.d).toBe('M 10 30 L 80 30 Q 94 30, 94 44 L 94 330');
  });

  it('draws a compacted branch with the ordinary lane-change corner', () => {
    // A branch handed lane 4 by a burst of merges, moving down to lane 1 at one
    // of its own commits once the burst's lanes have been given back. The move
    // is drawn with the geometry a branch leaving its lane already gets — a
    // straight run down lane 4 and one rounded corner into lane 1 — and not
    // with a shape of its own.
    const { nodes, edges } = commitGraphLayout({
      commits: [
        commit('a', 0, ['b', 'p']),
        commit('b', 0, ['c', 'q']),
        commit('c', 0, ['d', 'r']),
        commit('d', 0, ['e', 'z']),
        commit('p', 1),
        commit('q', 2),
        commit('r', 3),
        commit('e', 0, ['older']),
        commit('z', 4, ['z2']),
        commit('z2', 4, ['z3']),
        commit('z3', 4)
      ]
    });
    // Row 8 still on lane 4 (x 66), rows 9-10 on lane 1 (x 24).
    expect(nodes[8]).toMatchObject({ hash: 'z', cx: 66 });
    expect(nodes[9]).toMatchObject({ hash: 'z2', cx: 24 });
    expect(nodes[10]).toMatchObject({ hash: 'z3', cx: 24 });
    expect(edges.map((e) => e.d)).toContain(
      'M 66 510 L 66 556 Q 66 570, 52 570 L 24 570'
    );
  });

  it('gives the column back once a straggler has moved down', () => {
    const layout = commitGraphLayout({
      commits: [
        commit('a', 0, ['b', 'p']),
        commit('b', 0, ['c', 'q']),
        commit('c', 0, ['d', 'r']),
        commit('d', 0, ['e', 'z']),
        commit('p', 1),
        commit('q', 2),
        commit('r', 3),
        commit('e', 0, ['older']),
        commit('z', 4, ['z2']),
        commit('z2', 4, ['z3']),
        commit('z3', 4)
      ]
    });
    // The rows the branch spent on lane 4 still pay for it...
    expect(layout.widthForRows(8, 8)).toBe(76);
    // ...and the rows below the move are back to two lanes instead of five.
    expect(layout.widthForRows(10, 10)).toBe(34);
  });

  it('uses the same corner where a branch leaves its lane', () => {
    // The mirrored path: child on the higher lane, parent two lanes left.
    const { edges } = commitGraphLayout({
      commits: [commit('a', 2, ['b']), commit('b', 0)]
    });
    expect(edges[0]!.d).toBe('M 38 30 L 38 76 Q 38 90, 24 90 L 10 90');
  });

  it('tags each node with the row it sits in', () => {
    // The row index is what lets the SVG be windowed against the same range
    // the commit rows are virtualized over; derived from `cy` it would drift
    // the moment the row height changed.
    const { nodes } = commitGraphLayout({
      commits: [commit('a', 0, ['b']), commit('b', 0, ['c']), commit('c', 0)]
    });
    expect(nodes.map((n) => n.row)).toEqual([0, 1, 2]);
  });

  it('records the rows each edge runs over', () => {
    // A branch merged three rows below where it diverged crosses rows 1 and 2
    // without owning a node there, so the span — not the endpoints — is what
    // keeps it drawn while those rows are on screen.
    const { edges } = commitGraphLayout({
      commits: [
        commit('a', 0, ['b', 'd']),
        commit('b', 0, ['c']),
        commit('c', 0, []),
        commit('d', 1, [])
      ]
    });
    const long = edges.find((e) => e.bottomRow - e.topRow === 3);
    expect(long).toMatchObject({ topRow: 0, bottomRow: 3 });
  });

  it('spans a truncated lane over every row below its commit', () => {
    // The "history continues below" line is drawn to the bottom edge, so its
    // span has to reach the last row or windowing would drop it as soon as
    // the commit it leaves from scrolled off the top.
    const { edges } = commitGraphLayout({
      commits: [commit('a', 0, ['b']), commit('b', 0, ['gone'])]
    });
    const truncated = edges.find((e) => e.topRow === 1);
    expect(truncated).toMatchObject({ topRow: 1, bottomRow: 1 });
    const longer = commitGraphLayout({
      commits: [commit('a', 0, ['missing']), commit('b', 0, []), commit('c', 0)]
    });
    expect(longer.edges[0]).toMatchObject({ topRow: 0, bottomRow: 2 });
  });

  it('draws no edge for a real root commit (no parents)', () => {
    const { edges } = commitGraphLayout({ commits: [commit('a', 0, [])] });
    expect(edges).toHaveLength(0);
  });
});
