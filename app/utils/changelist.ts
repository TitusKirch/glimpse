// The pure changelist model: N named groups of pending changes layered over one
// working tree, file-level membership (a changed path belongs to exactly one
// list). No I/O — the store and panel call into this. Validated as a prototype
// (prototypes/changelist) before being lifted here.

import { z } from 'zod';

export interface Changelist {
  id: string;
  name: string; // doubles as the commit message/description
  members: string[]; // file paths, relative to the repo toplevel
}

export interface ChangelistState {
  lists: Changelist[]; // always contains the DEFAULT list, at index 0
  activeId: string; // brand-new / unassigned changes land here
}

export const DEFAULT_ID = 'default';

export function initialState(): ChangelistState {
  return {
    lists: [{ id: DEFAULT_ID, name: 'Default', members: [] }],
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

function clone(state: ChangelistState): ChangelistState {
  return {
    activeId: state.activeId,
    lists: state.lists.map((l) => ({ ...l, members: [...l.members] }))
  };
}

export function createList(
  state: ChangelistState,
  name: string
): { state: ChangelistState; id: string } {
  const id = freshId(state, name);
  const next = clone(state);
  next.lists.push({ id, name: name.trim() || id, members: [] });
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

// Move a path into `toId`, removing it from whatever list currently holds it —
// the one-path-one-list invariant is enforced here.
export function moveFile(
  state: ChangelistState,
  path: string,
  toId: string
): ChangelistState {
  if (!state.lists.some((l) => l.id === toId)) return state;
  const next = clone(state);
  for (const l of next.lists) l.members = l.members.filter((p) => p !== path);
  const target = next.lists.find((l) => l.id === toId)!;
  target.members.push(path);
  return next;
}

export function listOf(state: ChangelistState, path: string): string | null {
  return state.lists.find((l) => l.members.includes(path))?.id ?? null;
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
    members: l.members.filter((p) => changed.has(p))
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
      members: z.array(z.string())
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
    members: [...l.members]
  }));
  const defIdx = lists.findIndex((l) => l.id === DEFAULT_ID);
  if (defIdx < 0) {
    lists.unshift({ id: DEFAULT_ID, name: 'Default', members: [] });
  } else if (defIdx > 0) {
    lists.unshift(lists.splice(defIdx, 1)[0]!);
  }
  const seen = new Set<string>();
  for (const l of lists)
    l.members = l.members.filter((p) => !seen.has(p) && seen.add(p));
  const activeId = lists.some((l) => l.id === state.activeId)
    ? state.activeId
    : DEFAULT_ID;
  return { lists, activeId };
}

// Serialize state to the on-disk JSON contract. Pretty-printed so the file stays
// human- and diff-friendly (it lives in the git dir, not the working tree).
export function serialize(state: ChangelistState): string {
  return JSON.stringify(
    {
      version: CHANGELIST_SCHEMA_VERSION,
      activeId: state.activeId,
      lists: state.lists
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
    lists: result.data.lists
  });
}
