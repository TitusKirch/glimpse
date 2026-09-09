// The pure changelist model: N named groups of pending changes layered over one
// working tree, file-level membership (a changed path belongs to exactly one
// list). No I/O — the store and panel call into this. Validated as a prototype
// (prototypes/changelist) before being lifted here.

import { z } from 'zod';

// One hunk's durable identity within a file. `hash` is the context hash — the
// caption plus the body, deliberately WITHOUT the @@ line numbers, so an edit
// above a hunk does not change its id. `lines` hashes the +/- body lines only,
// and is what the second reconcile pass overlaps when the context itself moved.
export interface HunkRef {
  path: string;
  hash: string;
  lines: string[];
}

export interface Changelist {
  id: string;
  name: string; // doubles as the commit message/description
  members: string[]; // file paths, relative to the repo toplevel
  // Sub-file membership. Empty for a list that only holds whole files, which is
  // every list written before this existed — `members` stays the file-level
  // truth so an older build reads the file unchanged.
  hunks: HunkRef[];
}

export interface ChangelistState {
  lists: Changelist[]; // always contains the DEFAULT list, at index 0
  activeId: string; // brand-new / unassigned changes land here
}

export const DEFAULT_ID = 'default';

export function initialState(): ChangelistState {
  return {
    lists: [{ id: DEFAULT_ID, name: 'Default', members: [], hunks: [] }],
    activeId: DEFAULT_ID
  };
}

// Derive a unique, stable-ish id from a name.
function freshId(state: ChangelistState, name: string): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'list';
  const taken = new Set(state.lists.map((l) => l.id));
  let id = base;
  let n = 1;
  while (taken.has(id)) id = `${base}-${++n}`;
  return id;
}

// A state rehydrated straight out of `localStorage` predates hunk membership
// and arrives WITHOUT `hunks` — the Pinia store persists `byRepo` as raw JSON,
// so it never passes through `deserialize` and the zod schema never sees it.
// Every entry point that meets raw state defaults the field rather than
// dereferencing it; past this boundary `hunks` is always an array.
function hunksOf(list: Changelist): HunkRef[] {
  return list.hunks ?? [];
}

function clone(state: ChangelistState): ChangelistState {
  return {
    activeId: state.activeId,
    lists: state.lists.map((l) => ({
      ...l,
      members: [...l.members],
      hunks: hunksOf(l).map((h) => ({ ...h, lines: [...h.lines] }))
    }))
  };
}

export function createList(
  state: ChangelistState,
  name: string
): { state: ChangelistState; id: string } {
  const id = freshId(state, name);
  const next = clone(state);
  next.lists.push({ id, name: name.trim() || id, members: [], hunks: [] });
  return { state: next, id };
}

export function renameList(
  state: ChangelistState,
  id: string,
  name: string
): ChangelistState {
  const next = clone(state);
  const list = next.lists.find((l) => l.id === id);
  if (list) list.name = name.trim() || list.name;
  return next;
}

export function deleteList(
  state: ChangelistState,
  id: string
): ChangelistState {
  if (id === DEFAULT_ID) return state; // the default list is permanent
  const target = state.lists.find((l) => l.id === id);
  if (!target) return state;
  const next = clone(state);
  const def = next.lists.find((l) => l.id === DEFAULT_ID)!;
  // Orphaned members fall back into Default rather than vanishing.
  for (const p of target.members)
    if (!def.members.includes(p)) def.members.push(p);
  // Hunks are rehomed the same way members are — dropping them would silently
  // discard a split the user built.
  const deadHunks = next.lists.find((l) => l.id === id)!.hunks;
  for (const h of deadHunks)
    if (!def.hunks.some((e) => e.path === h.path && e.hash === h.hash))
      def.hunks.push(h);
  next.lists = next.lists.filter((l) => l.id !== id);
  if (next.activeId === id) next.activeId = DEFAULT_ID;
  return next;
}

export function setActive(state: ChangelistState, id: string): ChangelistState {
  if (!state.lists.some((l) => l.id === id)) return state;
  const next = clone(state);
  next.activeId = id;
  return next;
}

// Move a whole path into `toId`, removing it from whatever list currently holds
// it — the one-path-one-list invariant is enforced here.
//
// It takes the path's HUNKS with it: `members` is derived from them, so leaving
// a hunk behind in the old list would let the next normalize recompute
// `members` straight back and silently undo this move. The file-level gesture
// deliberately asserts itself over any sub-file split of that path.
export function moveFile(
  state: ChangelistState,
  path: string,
  toId: string
): ChangelistState {
  if (!state.lists.some((l) => l.id === toId)) return state;
  const next = clone(state);
  const moving: HunkRef[] = [];
  for (const l of next.lists) {
    l.members = l.members.filter((p) => p !== path);
    moving.push(...l.hunks.filter((h) => h.path === path));
    l.hunks = l.hunks.filter((h) => h.path !== path);
  }
  const target = next.lists.find((l) => l.id === toId)!;
  target.members.push(path);
  target.hunks.push(...moving);
  return next;
}

// The list a path is filed under at FILE level. For a path split across lists
// that is the majority holder (see `syncMembers`), so this deliberately cannot
// distinguish a split path from a whole-file one — ask `listOfHunk` when the
// difference matters.
export function listOf(state: ChangelistState, path: string): string | null {
  return state.lists.find((l) => l.members.includes(path))?.id ?? null;
}

// ── Hunk identity ─────────────────────────────────────────────────────────
// FNV-1a (64-bit) over the UTF-8 bytes. Not cryptographic — this only has to
// tell hunks apart — but it must be BYTE-identical to the Rust port, since both
// read and write the same file: hence UTF-8 bytes rather than UTF-16 units, and
// a fixed 16-char hex rendering.
function fnv1a64(input: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (const byte of new TextEncoder().encode(input)) {
    hash = ((hash ^ BigInt(byte)) * prime) & mask;
  }
  return hash.toString(16).padStart(16, '0');
}

// Split a raw hunk into the two parts that survive an edit elsewhere in the
// file: git's caption after the closing `@@`, and the body. The @@ line numbers
// are deliberately dropped — they shift whenever anything above the hunk moves,
// which is precisely the drift this identity has to ride out.
function hunkParts(hunk: string): { caption: string; body: string } {
  const nl = hunk.indexOf('\n');
  const header = nl < 0 ? hunk : hunk.slice(0, nl);
  const body = nl < 0 ? '' : hunk.slice(nl + 1);
  const caption = /^@@[^@]*@@(.*)$/.exec(header)?.[1] ?? '';
  return { caption: caption.trim(), body };
}

// The added/removed lines, prefix kept so a '+foo' never matches a '-foo'.
function changedLines(body: string): string[] {
  return body.split('\n').filter((l) => l.startsWith('+') || l.startsWith('-'));
}

// The durable id of a hunk: its caption and body, without the line numbers.
export function hunkHash(hunk: string): string {
  const { caption, body } = hunkParts(hunk);
  return fnv1a64(`${caption}\n${body}`);
}

function hunkRef(path: string, hunk: string): HunkRef {
  const { body } = hunkParts(hunk);
  return {
    path,
    hash: hunkHash(hunk),
    lines: changedLines(body).map(fnv1a64)
  };
}

// `members` stays the file-level view for readers that know nothing of hunks,
// so it is DERIVED here rather than set by hand: a path that is split across
// lists is filed under whichever list holds most of its hunks, ties going to
// the earlier list. Only paths that actually carry hunks are touched — a
// whole-file assignment keeps whatever `moveFile` gave it.
function syncMembers(state: ChangelistState): ChangelistState {
  const paths = new Set(
    state.lists.flatMap((l) => hunksOf(l).map((h) => h.path))
  );
  for (const path of paths) {
    let best: Changelist | null = null;
    let bestCount = 0;
    for (const l of state.lists) {
      const n = hunksOf(l).filter((h) => h.path === path).length;
      if (n > bestCount) {
        bestCount = n;
        best = l;
      }
    }
    for (const l of state.lists)
      l.members = l.members.filter((p) => p !== path);
    if (best) best.members.push(path);
  }
  return state;
}

// Assign one hunk to `toId`, removing it from whatever list holds it — the
// hunk-in-exactly-one-list invariant, the sub-file counterpart of `moveFile`.
// Takes the raw hunk rather than its hash because the stored ref carries the
// +/- line hashes too, which is what lets reconcile recover a drifted hunk.
export function moveHunk(
  state: ChangelistState,
  path: string,
  hunk: string,
  toId: string
): ChangelistState {
  if (!state.lists.some((l) => l.id === toId)) return state;
  const ref = hunkRef(path, hunk);
  const next = clone(state);
  for (const l of next.lists)
    l.hunks = l.hunks.filter(
      (h) => !(h.path === ref.path && h.hash === ref.hash)
    );
  next.lists.find((l) => l.id === toId)!.hunks.push(ref);
  return syncMembers(next);
}

export function listOfHunk(
  state: ChangelistState,
  path: string,
  hash: string
): string | null {
  return (
    state.lists.find((l) =>
      hunksOf(l).some((h) => h.path === path && h.hash === hash)
    )?.id ?? null
  );
}

// How much two hunks' +/- lines have in common, as a share of the smaller set.
function overlap(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const inB = new Set(b);
  const shared = a.filter((l) => inB.has(l)).length;
  return shared / Math.min(a.length, b.length);
}

// A stage-2 match has to be both good enough and clearly the best, so a hunk is
// never pulled into a list on a coin-flip between two similar candidates.
const OVERLAP_MIN = 0.5;

// Reconcile stored hunk membership against the diff as it stands now. Two
// stages, and a hunk that survives neither is treated exactly like a brand-new
// change — it goes to the ACTIVE list, never to some list it was not in, and
// its file is reported in `drifted` so the panel can mark it.
export function reconcileHunks(
  state: ChangelistState,
  files: { path: string; hunks: string[] }[]
): { state: ChangelistState; drifted: string[] } {
  const next = clone(state);
  const activeId = next.lists.some((l) => l.id === next.activeId)
    ? next.activeId
    : DEFAULT_ID;
  const active = next.lists.find((l) => l.id === activeId)!;
  const drifted: string[] = [];

  // Everything stored, keyed by path, alongside the list that held it. Consumed
  // as matches are made so one stored hunk can never claim two fresh ones.
  const stored = new Map<string, { ref: HunkRef; listId: string }[]>();
  for (const l of next.lists)
    for (const h of l.hunks) {
      const bucket = stored.get(h.path) ?? [];
      bucket.push({ ref: h, listId: l.id });
      stored.set(h.path, bucket);
    }

  // Rebuilt from scratch: a stored hunk absent from the fresh diff is gone.
  for (const l of next.lists) l.hunks = [];

  for (const file of files) {
    const candidates = stored.get(file.path) ?? [];
    const taken = new Set<HunkRef>();
    const fresh = file.hunks.map((h) => hunkRef(file.path, h));

    // Stage 1 — exact context hash.
    const unresolved: HunkRef[] = [];
    for (const ref of fresh) {
      const hit = candidates.find(
        (c) => !taken.has(c.ref) && c.ref.hash === ref.hash
      );
      if (hit) {
        taken.add(hit.ref);
        next.lists.find((l) => l.id === hit.listId)!.hunks.push(ref);
      } else {
        unresolved.push(ref);
      }
    }

    // Stage 2 — overlap of the +/- lines, for a hunk whose context moved.
    for (const ref of unresolved) {
      let best: { listId: string; stored: HunkRef; score: number } | null =
        null;
      let tied = false;
      for (const c of candidates) {
        if (taken.has(c.ref)) continue;
        const score = overlap(ref.lines, c.ref.lines);
        if (score < OVERLAP_MIN) continue;
        if (!best || score > best.score) {
          best = { listId: c.listId, stored: c.ref, score };
          tied = false;
        } else if (score === best.score) {
          tied = true;
        }
      }
      if (best && !tied) {
        taken.add(best.stored);
        next.lists.find((l) => l.id === best!.listId)!.hunks.push(ref);
      } else {
        // Stage 3 — unresolvable. Treated as brand new: the active list, and
        // the file is surfaced rather than quietly re-filed.
        active.hunks.push(ref);
        if (!drifted.includes(file.path)) drifted.push(file.path);
      }
    }
  }

  return { state: syncMembers(next), drifted };
}

// Reconcile stored membership with the real set of changed paths from git:
//   1. drop members that are no longer changed (committed / discarded elsewhere)
//   2. route brand-new changes into the active list (Default if active is gone)
//   3. leave every still-valid assignment exactly where it was
// This is what keeps the lists correct when anyone runs git on the side.
export function reconcile(
  state: ChangelistState,
  changedPaths: string[]
): ChangelistState {
  const changed = new Set(changedPaths);
  const lists = state.lists.map((l) => ({
    ...l,
    members: l.members.filter((p) => changed.has(p)),
    hunks: hunksOf(l).filter((h) => changed.has(h.path))
  }));
  const assigned = new Set(lists.flatMap((l) => l.members));
  const activeId = lists.some((l) => l.id === state.activeId)
    ? state.activeId
    : DEFAULT_ID;
  const target = lists.find((l) => l.id === activeId)!;
  for (const p of changedPaths) if (!assigned.has(p)) target.members.push(p);
  return { lists, activeId };
}

// ── On-disk contract ──────────────────────────────────────────────────────
// Membership is persisted as JSON in the git dir (`<git-dir>/glimpse/
// changelists.json`) so it travels with the working copy and any external tool
// — the CLI, an AI agent — can read/write it by the same documented shape. Bump
// the version when that shape changes incompatibly; an unrecognised version is
// treated as "no stored membership" rather than mis-parsed.
export const CHANGELIST_SCHEMA_VERSION = 1;

const storedSchema = z.object({
  version: z.literal(CHANGELIST_SCHEMA_VERSION),
  activeId: z.string(),
  lists: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      members: z.array(z.string()),
      // Additive: absent in every file written before hunk membership existed,
      // and absent again in any list that holds only whole files.
      hunks: z
        .array(
          z.object({
            path: z.string(),
            hash: z.string(),
            lines: z.array(z.string()).optional()
          })
        )
        .optional()
    })
  )
});

// Enforce the model invariants on (possibly untrusted) input: the Default list
// always exists and comes first, a path lives in exactly one list (first wins),
// and the active id points at a real list. So a hand-edited or CLI-written file
// can never put the model into an illegal state.
function normalize(state: ChangelistState): ChangelistState {
  const lists = state.lists.map((l) => ({
    id: l.id,
    name: l.name,
    members: [...l.members],
    hunks: hunksOf(l).map((h) => ({ ...h, lines: [...h.lines] }))
  }));
  const defIdx = lists.findIndex((l) => l.id === DEFAULT_ID);
  if (defIdx < 0) {
    lists.unshift({ id: DEFAULT_ID, name: 'Default', members: [], hunks: [] });
  } else if (defIdx > 0) {
    lists.unshift(lists.splice(defIdx, 1)[0]!);
  }
  const seen = new Set<string>();
  for (const l of lists)
    l.members = l.members.filter((p) => !seen.has(p) && seen.add(p));
  // The same first-wins rule one level down: a hunk lives in exactly one list.
  const seenHunks = new Set<string>();
  for (const l of lists)
    l.hunks = l.hunks.filter((h) => {
      const key = `${h.path}\u0000${h.hash}`;
      return !seenHunks.has(key) && seenHunks.add(key);
    });
  const activeId = lists.some((l) => l.id === state.activeId)
    ? state.activeId
    : DEFAULT_ID;
  return syncMembers({ lists, activeId });
}

// Serialize state to the on-disk JSON contract. Pretty-printed so the file stays
// human- and diff-friendly (it lives in the git dir, not the working tree).
export function serialize(state: ChangelistState): string {
  return JSON.stringify(
    {
      version: CHANGELIST_SCHEMA_VERSION,
      activeId: state.activeId,
      // An empty `hunks` is left out entirely: a repo that never splits a file
      // keeps writing byte-for-byte what it wrote before this feature existed.
      lists: state.lists.map((l) =>
        hunksOf(l).length > 0
          ? { id: l.id, name: l.name, members: l.members, hunks: hunksOf(l) }
          : { id: l.id, name: l.name, members: l.members }
      )
    },
    null,
    2
  );
}

// Parse the on-disk JSON back to state, or null when it is missing, corrupt, or
// from an incompatible version — the caller then falls back (cache or
// initialState) instead of throwing. The result is always normalized.
export function deserialize(
  json: string | null | undefined
): ChangelistState | null {
  if (!json) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  const result = storedSchema.safeParse(parsed);
  if (!result.success) return null;
  return normalize({
    activeId: result.data.activeId,
    lists: result.data.lists.map((l) => ({
      id: l.id,
      name: l.name,
      members: l.members,
      hunks: (l.hunks ?? []).map((h) => ({
        path: h.path,
        hash: h.hash,
        lines: h.lines ?? []
      }))
    }))
  });
}
