import { describe, expect, it } from 'vitest';
import type { Commit } from '~/types/bindings';
import { commitGraphLayout } from './commitGraphLayout';

function commit(hash: string, lane: number, parents: string[] = []): Commit {
  return { hash, subject: '', author: '', date: '', refs: [], parents, lane };
}

describe('commitGraphLayout', () => {
  it('positions nodes by lane (x) and index (y)', () => {
    const { nodes } = commitGraphLayout([
      commit('a', 0, ['b']),
      commit('b', 1)
    ]);
    expect(nodes[0]).toMatchObject({ hash: 'a', cx: 18, cy: 30 });
    // lane 1 -> originX + laneWidth = 36; second row -> rowHeight*1.5 = 90
    expect(nodes[1]).toMatchObject({ hash: 'b', cx: 36, cy: 90 });
  });

  it('draws a straight edge when parent shares the lane', () => {
    const { edges } = commitGraphLayout([
      commit('a', 0, ['b']),
      commit('b', 0)
    ]);
    expect(edges).toHaveLength(1);
    expect(edges[0]!.d).toBe('M 18 30 L 18 90');
  });

  it('width and height grow with lanes and commit count', () => {
    const layout = commitGraphLayout([commit('a', 2, []), commit('b', 0, [])]);
    expect(layout.width).toBe(18 + 2 * 18 + 18); // 72
    expect(layout.height).toBe(2 * 60); // 120
  });

  it('skips edges to parents outside the loaded range', () => {
    const { edges } = commitGraphLayout([commit('a', 0, ['missing'])]);
    expect(edges).toHaveLength(0);
  });
});
