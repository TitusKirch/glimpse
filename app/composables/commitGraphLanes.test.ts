import { describe, expect, it } from 'vitest';
import { commitGraphLanes } from './commitGraphLanes';

// Rows are newest-first, the order `git log` hands them over, and `lane` is
// what `git::parse::assign_lanes` handed out: the lowest lane free at the
// moment the branch appeared. Every fixture below is a faithful trace of that
// assignment, so the numbers a test starts from are numbers the backend could
// really produce.
function commit(hash: string, lane: number, parents: string[] = []) {
  return { hash, lane, parents };
}

describe('commitGraphLanes', () => {
  it('leaves a dense graph alone', () => {
    // The common case, measured on this repo: two or three lanes live and
    // nothing empty between them. Nothing to gain, so nothing moves.
    const lanes = commitGraphLanes([
      commit('a', 0, ['b', 'x']),
      commit('b', 0, ['c']),
      commit('x', 1, ['c']),
      commit('c', 0, [])
    ]);
    expect(lanes).toEqual([0, 0, 1, 0]);
  });

  it('moves a straggler down once the lanes below it fall empty', () => {
    // A burst of merges opens lanes 1-3 in three rows; the branch that appears
    // next has to take lane 4. Lanes 1-3 are given back at rows 4-6 while the
    // branch on lane 4 keeps running, which is the whole defect: lane 4 is a
    // record of what was live three rows ago.
    const lanes = commitGraphLanes([
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
    ]);
    // `z` keeps lane 4: the merge edge that opened it runs from row 3, so lane
    // 1 is still busy over the rows that edge crosses. The move happens one
    // commit later, where the branch's own row is clear of the burst.
    expect(lanes).toEqual([0, 0, 0, 0, 1, 2, 3, 0, 4, 1, 1]);
  });

  it('migrates at a commit of the branch, never between two', () => {
    const commits = [
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
    ];
    const lanes = commitGraphLanes(commits);
    // Every row whose lane changed carries a commit of the migrating branch,
    // and the branch is on exactly two lanes: the one it was given and the one
    // it moved to. A jog in the middle of a straight run would show up as a
    // third value, or as a change on a row this branch has no commit on.
    const changed = lanes
      .map((lane, row) => ({ lane, row }))
      .filter(({ lane, row }) => lane !== commits[row]!.lane);
    expect(changed).toEqual([
      { row: 9, lane: 1 },
      { row: 10, lane: 1 }
    ]);
  });

  it('keeps a branch where no lower lane is ever free', () => {
    // Same burst, but the three branches it opened run off the bottom of the
    // window, so lanes 1-3 are never given back.
    const lanes = commitGraphLanes([
      commit('a', 0, ['b', 'p']),
      commit('b', 0, ['c', 'q']),
      commit('c', 0, ['d', 'r']),
      commit('d', 0, ['e', 'z']),
      commit('e', 0, ['older']),
      commit('p', 1, ['older']),
      commit('q', 2, ['older']),
      commit('r', 3, ['older']),
      commit('z', 4, ['z2']),
      commit('z2', 4)
    ]);
    expect(lanes).toEqual([0, 0, 0, 0, 0, 1, 2, 3, 4, 4]);
  });

  it('refuses a lane that is taken again before the branch ends', () => {
    // The migrating fixture with one row moved: row 9 merges a second branch,
    // which is handed the lane 1 that row 4 gave back. At row 8 — the row the
    // branch would otherwise move on — lane 1 is free and has been free for
    // four rows; it is only below that row that it is taken again. Looking at
    // the migration row alone would move the branch and then have to undo it,
    // so the whole remaining run has to be clear.
    const lanes = commitGraphLanes([
      commit('a', 0, ['b', 'p']),
      commit('b', 0, ['c', 'q']),
      commit('c', 0, ['d', 'r']),
      commit('d', 0, ['e', 'z']),
      commit('p', 1),
      commit('q', 2),
      commit('r', 3),
      commit('z', 4, ['z2']),
      commit('z2', 4, ['z3']),
      commit('e', 0, ['f', 'p2']),
      commit('z3', 4),
      commit('f', 0, ['older']),
      commit('p2', 1)
    ]);
    expect(lanes).toEqual([0, 0, 0, 0, 1, 2, 3, 4, 4, 0, 4, 0, 1]);
  });

  it('stops at the shallowest lane its own edges still reach', () => {
    // A six-merge burst opens lanes 1-6, the straggler takes lane 7, and the
    // branch merges back at row 15 into the branch on lane 2. Lane 1 is free
    // from row 9 down, but moving there would put this branch to the LEFT of
    // the one it merges into, so the closing edge would start reserving that
    // branch's lane instead of its own. It stops at lane 3.
    const lanes = commitGraphLanes([
      commit('a', 0, ['b', 'u1']),
      commit('b', 0, ['c', 'q']),
      commit('c', 0, ['d', 'u3']),
      commit('d', 0, ['e', 'u4']),
      commit('e', 0, ['f', 'u5']),
      commit('f', 0, ['g', 'u6']),
      commit('g', 0, ['h', 'z']),
      commit('h', 0, ['older']),
      commit('u1', 1),
      commit('u3', 3),
      commit('u4', 4),
      commit('u5', 5),
      commit('u6', 6),
      commit('z', 7, ['z2']),
      commit('z2', 7, ['q']),
      commit('q', 2)
    ]);
    expect(lanes).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 1, 3, 4, 5, 6, 7, 3, 2]);
  });

  it('holds a branch still for a gain smaller than the threshold', () => {
    // Lane 3 with only lane 1 free below it: a two-lane gain, which buys a
    // corner in the drawing and almost no width. Lowering the threshold to two
    // is what makes the same branch move, so it is the threshold refusing it
    // and not the absence of a free lane.
    const commits = [
      commit('a', 0, ['b', 'p']),
      commit('b', 0, ['c', 'q']),
      commit('c', 0, ['d', 'z']),
      commit('p', 1),
      commit('q', 2),
      commit('d', 0, ['older']),
      commit('z', 3, ['z2']),
      commit('z2', 3)
    ];
    expect(commitGraphLanes(commits)).toEqual([0, 0, 0, 1, 2, 0, 3, 3]);
    expect(commitGraphLanes(commits, { minGain: 2 })).toEqual([
      0, 0, 0, 1, 2, 0, 3, 1
    ]);
  });

  it('ignores a merge parent that left the window', () => {
    // Row 8 merges something older than the loaded log. The renderer draws no
    // line for it and the backend reserves it no lane, so it must not hold the
    // branch's lane down to the bottom edge either — only a FIRST parent off
    // the window does that, because that one is drawn as a stub. Lane 1 is
    // taken again at row 10, so treating the merge as a stub would reach past
    // it and refuse the move this branch is entitled to.
    const lanes = commitGraphLanes([
      commit('a', 0, ['b', 'p']),
      commit('b', 0, ['c', 'q']),
      commit('c', 0, ['d', 'r']),
      commit('d', 0, ['e', 'z']),
      commit('p', 1),
      commit('q', 2),
      commit('r', 3),
      commit('z', 4, ['z2']),
      commit('z2', 4, ['z3', 'gone']),
      commit('z3', 4),
      commit('e', 0, ['f', 'p2']),
      commit('f', 0, ['older']),
      commit('p2', 1)
    ]);
    expect(lanes).toEqual([0, 0, 0, 0, 1, 2, 3, 4, 1, 1, 0, 0, 1]);
  });

  it('handles an empty log', () => {
    expect(commitGraphLanes([])).toEqual([]);
  });
});
