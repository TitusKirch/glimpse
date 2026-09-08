// A second pass over the backend's lane numbers: move a branch that is still
// running far out to the right down onto a lane that has since fallen empty,
// and let the renderer draw the move.
//
// `git::parse::assign_lanes` hands a branch the lowest lane free at the moment
// it appears and never revises that number. Lanes are given back out of order —
// a merge parent reached two rows below frees lane 3 while the branch handed
// lane 12 in the same burst runs for another two hundred rows — so the live set
// goes sparse and the column is paid for the deepest lane number rather than
// for the number of lanes actually in use. The emptiness is a record of what
// was live when the number was issued, not of what is live now.
//
// Renumbering per viewport would be the bigger win and is not an option: a
// line's horizontal position would then depend on what else is on screen, so
// lines would slide sideways while the list scrolls. Moving a branch *visibly*,
// once, at one of its own commits, keeps every line's position a property of
// the log rather than of the scroll offset. Two rules bound the move:
//
//   - only at a row where the branch has a commit, because a node is a joint
//     the line already articulates and a jog in a straight run explains nothing;
//   - only into a lane that stays free for the rest of that branch's run, so
//     the move is never undone and never collides.
//
// Lane assignment itself stays the backend's: this pass only revises numbers it
// was given, which is why it can be exercised with a commit list and no repo.

import type { Commit } from '~/types/bindings';

// How many lanes a branch has to gain before moving is worth a corner in the
// drawing. Measured over this repository's own history the graph is dense —
// 2.4 lanes occupied per row, 0.3 empty between them — while the stragglers
// worth moving are the scars of a merge burst, jumps of eight lanes and more.
// So the threshold is not a knob worth tuning: three keeps the pass inert on
// the dense rows (a branch on lane 0-2 is dropped before any work) and still
// catches every straggler.
const MIN_GAIN = 3;

// The rows on which a run holds its lane, inclusive.
interface Span {
  start: number;
  end: number;
}

// A maximal first-parent chain that stays in one lane — the thing a lane number
// identifies, and so the unit that moves.
interface Run {
  lane: number;
  nodes: number[];
}

export function commitGraphLanes(
  commits: Pick<Commit, 'hash' | 'parents' | 'lane'>[],
  { minGain = MIN_GAIN }: { minGain?: number } = {}
): number[] {
  const lanes = commits.map((c) => c.lane);
  const rows = commits.length;

  let deepest = 0;
  for (const lane of lanes) deepest = Math.max(deepest, lane);
  // No branch can gain `minGain` lanes, so there is nothing to look for. This
  // is the exit the overwhelming majority of histories take.
  if (deepest < minGain) return lanes;

  const rowByHash = new Map<string, number>();
  commits.forEach((c, row) => rowByHash.set(c.hash, row));
  // Row of each parent, -1 when it fell outside the loaded window.
  const parentRows = commits.map((c) =>
    c.parents.map((p) => rowByHash.get(p) ?? -1)
  );
  const childRows: number[][] = commits.map(() => []);
  parentRows.forEach((parents, row) => {
    for (const parent of parents) if (parent >= 0) childRows[parent]!.push(row);
  });

  // Commits arrive newest-first and a parent always sits below its child, so a
  // chain is always entered at its topmost commit: walking chains in row order
  // reaches every head before any of its members.
  const runOf = Array.from({ length: rows }, () => -1);
  const runs: Run[] = [];
  for (let head = 0; head < rows; head++) {
    if (runOf[head] !== -1) continue;
    const nodes: number[] = [];
    for (let row = head; ;) {
      runOf[row] = runs.length;
      nodes.push(row);
      const next = parentRows[row]![0] ?? -1;
      if (next < 0 || lanes[next] !== lanes[row] || runOf[next] !== -1) break;
      row = next;
    }
    runs.push({ lane: lanes[head]!, nodes });
  }

  // What one commit of a run reserves on that run's lane, mirroring
  // `commitGraphLayout`'s own rule that an edge occupies max(childLane,
  // parentLane) over every row it spans:
  //
  //   - its own row;
  //   - down to each parent it draws to — unless that parent sits on a DEEPER
  //     lane, where the reservation belongs to the parent's run instead;
  //   - up to each child drawing down into it from a shallower lane;
  //   - to the bottom edge when the first parent left the window, which the
  //     renderer draws as a "continues below" stub.
  //
  // Every endpoint outside the run also sets a floor. The run may only move to
  // a lane deeper than all of them, so that these edges keep reserving this
  // run's lane rather than quietly moving onto the lane of whatever they
  // connect to — which is a lane this pass has made no room on.
  const reach = {
    start: 0,
    end: 0,
    floor: 0
  };
  const resetReach = () => {
    reach.start = rows;
    reach.end = -1;
    reach.floor = 0;
  };
  const addNode = (row: number, run: number, lane: number) => {
    reach.start = Math.min(reach.start, row);
    reach.end = Math.max(reach.end, row);
    parentRows[row]!.forEach((parent, index) => {
      if (parent < 0) {
        if (index === 0) reach.end = rows - 1;
        return;
      }
      if (runOf[parent] === run) {
        reach.end = Math.max(reach.end, parent);
        return;
      }
      if (lanes[parent]! > lane) return;
      reach.floor = Math.max(reach.floor, lanes[parent]! + 1);
      reach.end = Math.max(reach.end, parent);
    });
    for (const child of childRows[row]!) {
      if (runOf[child] === run || lanes[child]! > lane) continue;
      reach.floor = Math.max(reach.floor, lanes[child]! + 1);
      reach.start = Math.min(reach.start, child);
    }
  };
  const spanOf = (run: number, from: number, to: number): Span => {
    const { lane, nodes } = runs[run]!;
    resetReach();
    for (let at = from; at <= to; at++) addNode(nodes[at]!, run, lane);
    return { start: reach.start, end: reach.end };
  };
  // What the run would hold if it moved at each of its commits in turn. Read
  // bottom-up so every commit's answer is the aggregate of itself and the ones
  // below it, in one pass rather than one pass per candidate row.
  const tailsOf = (run: number) => {
    const { lane, nodes } = runs[run]!;
    const starts: number[] = [];
    const ends: number[] = [];
    const floors: number[] = [];
    resetReach();
    for (let at = nodes.length - 1; at >= 0; at--) {
      addNode(nodes[at]!, run, lane);
      starts[at] = reach.start;
      ends[at] = reach.end;
      floors[at] = reach.floor;
    }
    return { starts, ends, floors };
  };

  const occupied: Span[][] = [];
  const spansOn = (lane: number) => (occupied[lane] ??= []);
  const isFree = (lane: number, start: number, end: number) =>
    !spansOn(lane).some((span) => span.start <= end && start <= span.end);
  const release = (lane: number, span: Span) => {
    const spans = spansOn(lane);
    const at = spans.indexOf(span);
    if (at >= 0) spans.splice(at, 1);
  };

  const spans = runs.map((run, index) =>
    spanOf(index, 0, run.nodes.length - 1)
  );
  runs.forEach((run, index) => spansOn(run.lane).push(spans[index]!));

  // Top-down, the order the graph is read in, so an earlier branch takes the
  // lane it frees for a later one rather than the other way round.
  const order = runs
    .map((_, index) => index)
    .sort(
      (a, b) =>
        spans[a]!.start - spans[b]!.start ||
        runs[a]!.lane - runs[b]!.lane ||
        a - b
    );

  for (const index of order) {
    const run = runs[index]!;
    const shallowest = run.lane - minGain;
    if (shallowest < 0) continue;

    const { starts, ends, floors } = tailsOf(index);
    // Out of the way while its own targets are probed, and back if it stays.
    release(run.lane, spans[index]!);

    let moved = false;
    for (let at = 0; at < run.nodes.length && !moved; at++) {
      const start = starts[at]!;
      const end = ends[at]!;
      for (let target = floors[at]!; target <= shallowest; target++) {
        if (!isFree(target, start, end)) continue;
        spansOn(target).push({ start, end });
        // The commits above the move keep the lane they were given, down to
        // the row the corner turns on.
        if (at > 0) spansOn(run.lane).push(spanOf(index, 0, at - 1));
        for (let rest = at; rest < run.nodes.length; rest++) {
          lanes[run.nodes[rest]!] = target;
        }
        moved = true;
        break;
      }
    }
    if (!moved) spansOn(run.lane).push(spans[index]!);
  }

  return lanes;
}
