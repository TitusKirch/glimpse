//! The changelist model — a Rust port of the frontend's `app/utils/changelist.ts`.
//!
//! Changelists are N named groups of pending changes layered over one working
//! tree, with file-level membership (a changed path belongs to exactly one
//! list). The GUI owns the canonical model in TypeScript; this port exists so
//! the headless CLI (`glimpse cl …`, see [`crate::cli`]) can read, reconcile and
//! mutate the **same** on-disk store the GUI writes — without a JS runtime.
//!
//! The on-disk contract (`<git-dir>/glimpse/changelists.json`) is shared with
//! the frontend: keep [`SCHEMA_VERSION`] and the serde shape in lock-step with
//! the TS `serialize`/`deserialize` (and bump both together on any incompatible
//! change). The behaviour here mirrors the TS functions one-for-one; the shared
//! unit tests guard against drift.

use serde::{Deserialize, Serialize};
use std::collections::HashSet;

/// Bump together with the TS `CHANGELIST_SCHEMA_VERSION` on any incompatible
/// change to the on-disk shape.
pub const SCHEMA_VERSION: u32 = 1;
/// The permanent default list; brand-new/unassigned changes land in the active
/// list, which falls back to this one.
pub const DEFAULT_ID: &str = "default";

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Changelist {
    pub id: String,
    pub name: String,
    pub members: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub hunks: Vec<HunkRef>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangelistState {
    pub lists: Vec<Changelist>,
    pub active_id: String,
}

/// The on-disk envelope: the state plus a version tag. Separate from
/// [`ChangelistState`] so the version lives only in the file, not in memory.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Stored {
    version: u32,
    active_id: String,
    lists: Vec<Changelist>,
}

pub fn initial_state() -> ChangelistState {
    ChangelistState {
        lists: vec![Changelist {
            id: DEFAULT_ID.to_string(),
            name: "Default".to_string(),
            members: Vec::new(),
            hunks: Vec::new(),
        }],
        active_id: DEFAULT_ID.to_string(),
    }
}

/// Serialize to the on-disk JSON contract (pretty-printed, like the TS side, so
/// the file stays human- and diff-friendly).
pub fn serialize(state: &ChangelistState) -> String {
    let stored = Stored {
        version: SCHEMA_VERSION,
        active_id: state.active_id.clone(),
        lists: state.lists.clone(),
    };
    serde_json::to_string_pretty(&stored).unwrap_or_else(|_| "{}".to_string())
}

/// Parse the on-disk JSON back to state, or `None` when it is corrupt or from an
/// incompatible version — the caller then falls back to [`initial_state`]. The
/// result is always normalized.
pub fn deserialize(json: &str) -> Option<ChangelistState> {
    let stored: Stored = serde_json::from_str(json).ok()?;
    if stored.version != SCHEMA_VERSION {
        return None;
    }
    Some(normalize(ChangelistState {
        lists: stored.lists,
        active_id: stored.active_id,
    }))
}

/// Enforce the model invariants on (possibly hand-edited) input: the Default
/// list always exists and comes first, a path lives in exactly one list (first
/// wins), and the active id points at a real list.
fn normalize(mut state: ChangelistState) -> ChangelistState {
    match state.lists.iter().position(|l| l.id == DEFAULT_ID) {
        None => state.lists.insert(
            0,
            Changelist {
                id: DEFAULT_ID.to_string(),
                name: "Default".to_string(),
                members: Vec::new(),
                hunks: Vec::new(),
            },
        ),
        Some(0) => {}
        Some(i) => {
            let def = state.lists.remove(i);
            state.lists.insert(0, def);
        }
    }
    let mut seen: HashSet<String> = HashSet::new();
    for list in &mut state.lists {
        list.members.retain(|p| seen.insert(p.clone()));
    }
    // The same first-wins rule one level down: a hunk lives in exactly one list.
    let mut seen_hunks: HashSet<(String, String)> = HashSet::new();
    for list in &mut state.lists {
        list.hunks
            .retain(|h| seen_hunks.insert((h.path.clone(), h.hash.clone())));
    }
    if !state.lists.iter().any(|l| l.id == state.active_id) {
        state.active_id = DEFAULT_ID.to_string();
    }
    sync_members(state)
}

/// Derive a unique, stable-ish id from a name (mirrors the TS `freshId`).
fn fresh_id(state: &ChangelistState, name: &str) -> String {
    let mut base = String::new();
    let mut prev_dash = false;
    for c in name.to_lowercase().chars() {
        if c.is_ascii_alphanumeric() {
            base.push(c);
            prev_dash = false;
        } else if !prev_dash {
            base.push('-');
            prev_dash = true;
        }
    }
    let base = base.trim_matches('-').to_string();
    let base = if base.is_empty() {
        "list".to_string()
    } else {
        base
    };
    let taken: HashSet<&str> = state.lists.iter().map(|l| l.id.as_str()).collect();
    if !taken.contains(base.as_str()) {
        return base;
    }
    let mut n = 1;
    loop {
        n += 1;
        let candidate = format!("{base}-{n}");
        if !taken.contains(candidate.as_str()) {
            return candidate;
        }
    }
}

/// Create a new (empty) list; returns the new state and the new list's id.
pub fn create_list(state: &ChangelistState, name: &str) -> (ChangelistState, String) {
    let id = fresh_id(state, name);
    let mut next = state.clone();
    let trimmed = name.trim();
    next.lists.push(Changelist {
        id: id.clone(),
        name: if trimmed.is_empty() {
            id.clone()
        } else {
            trimmed.to_string()
        },
        members: Vec::new(),
        hunks: Vec::new(),
    });
    (next, id)
}

/// Delete a list (the Default list is permanent); its members fall back into
/// Default rather than vanishing.
pub fn delete_list(state: &ChangelistState, id: &str) -> ChangelistState {
    if id == DEFAULT_ID || !state.lists.iter().any(|l| l.id == id) {
        return state.clone();
    }
    let mut next = state.clone();
    let orphans: Vec<String> = next
        .lists
        .iter()
        .find(|l| l.id == id)
        .map(|l| l.members.clone())
        .unwrap_or_default();
    if let Some(def) = next.lists.iter_mut().find(|l| l.id == DEFAULT_ID) {
        for p in orphans {
            if !def.members.contains(&p) {
                def.members.push(p);
            }
        }
    }
    let dead_hunks: Vec<HunkRef> = next
        .lists
        .iter()
        .find(|l| l.id == id)
        .map(|l| l.hunks.clone())
        .unwrap_or_default();
    if let Some(def) = next.lists.iter_mut().find(|l| l.id == DEFAULT_ID) {
        for h in dead_hunks {
            if !def
                .hunks
                .iter()
                .any(|e| e.path == h.path && e.hash == h.hash)
            {
                def.hunks.push(h);
            }
        }
    }
    next.lists.retain(|l| l.id != id);
    if next.active_id == id {
        next.active_id = DEFAULT_ID.to_string();
    }
    next
}

pub fn set_active(state: &ChangelistState, id: &str) -> ChangelistState {
    if !state.lists.iter().any(|l| l.id == id) {
        return state.clone();
    }
    let mut next = state.clone();
    next.active_id = id.to_string();
    next
}

/// Move a whole path into `to_id`, removing it from whatever list currently
/// holds it — the one-path-one-list invariant is enforced here.
///
/// It takes the path's HUNKS with it: `members` is derived from them, so a hunk
/// left behind in the old list would let the next normalize recompute `members`
/// straight back and silently undo this move. The file-level gesture
/// deliberately asserts itself over any sub-file split of that path.
pub fn move_file(state: &ChangelistState, path: &str, to_id: &str) -> ChangelistState {
    if !state.lists.iter().any(|l| l.id == to_id) {
        return state.clone();
    }
    let mut next = state.clone();
    let mut moving: Vec<HunkRef> = Vec::new();
    for list in &mut next.lists {
        list.members.retain(|p| p != path);
        moving.extend(list.hunks.iter().filter(|h| h.path == path).cloned());
        list.hunks.retain(|h| h.path != path);
    }
    if let Some(target) = next.lists.iter_mut().find(|l| l.id == to_id) {
        target.members.push(path.to_string());
        target.hunks.extend(moving);
    }
    next
}

/// The id of the list holding `path` at FILE level. For a path split across
/// lists that is the majority holder (see `sync_members`), so this deliberately
/// cannot distinguish a split path from a whole-file one — ask `list_of_hunk`
/// when the difference matters. Mirrors the TS `listOf`.
#[cfg_attr(not(test), allow(dead_code))]
pub fn list_of<'a>(state: &'a ChangelistState, path: &str) -> Option<&'a str> {
    state
        .lists
        .iter()
        .find(|l| l.members.iter().any(|p| p == path))
        .map(|l| l.id.as_str())
}

/// Reconcile stored membership with the real set of changed paths from git:
/// drop members no longer changed, route brand-new changes into the active list
/// (Default if the active list is gone), keep every still-valid assignment.
pub fn reconcile(state: &ChangelistState, changed_paths: &[String]) -> ChangelistState {
    let changed: HashSet<&str> = changed_paths.iter().map(String::as_str).collect();
    let mut lists: Vec<Changelist> = state
        .lists
        .iter()
        .map(|l| Changelist {
            id: l.id.clone(),
            name: l.name.clone(),
            members: l
                .members
                .iter()
                .filter(|p| changed.contains(p.as_str()))
                .cloned()
                .collect(),
            hunks: l
                .hunks
                .iter()
                .filter(|h| changed.contains(h.path.as_str()))
                .cloned()
                .collect(),
        })
        .collect();
    if lists.is_empty() {
        lists.push(Changelist {
            id: DEFAULT_ID.to_string(),
            name: "Default".to_string(),
            members: Vec::new(),
            hunks: Vec::new(),
        });
    }
    let assigned: HashSet<String> = lists
        .iter()
        .flat_map(|l| l.members.iter().cloned())
        .collect();
    let active_id = if lists.iter().any(|l| l.id == state.active_id) {
        state.active_id.clone()
    } else {
        DEFAULT_ID.to_string()
    };
    let target = lists.iter().position(|l| l.id == active_id).unwrap_or(0);
    for p in changed_paths {
        if !assigned.contains(p) {
            lists[target].members.push(p.clone());
        }
    }
    ChangelistState { lists, active_id }
}

// ── Hunk-level membership (#112) — stubs, implemented next ────────────────

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct HunkRef {
    pub path: String,
    pub hash: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub lines: Vec<String>,
}

/// FNV-1a (64-bit) over the UTF-8 bytes. Must stay byte-identical to the TS
/// `fnv1a64` — both sides hash into the *same file* — hence bytes rather than
/// chars, and the fixed 16-char hex rendering. Pinned vectors guard it.
fn fnv1a64(input: &str) -> String {
    const PRIME: u64 = 0x100000001b3;
    let mut hash: u64 = 0xcbf29ce484222325;
    for b in input.as_bytes() {
        hash ^= u64::from(*b);
        hash = hash.wrapping_mul(PRIME);
    }
    format!("{hash:016x}")
}

/// Split a raw hunk into git's caption (whatever follows the closing `@@`) and
/// its body. The `@@` line numbers are dropped on purpose: they move whenever
/// anything above the hunk changes, and riding that out is the whole point.
/// Mirrors the TS `/^@@[^@]*@@(.*)$/` exactly, '@' handling included.
fn hunk_parts(hunk: &str) -> (String, &str) {
    let (header, body) = match hunk.find('\n') {
        Some(i) => (&hunk[..i], &hunk[i + 1..]),
        None => (hunk, ""),
    };
    let caption = header
        .strip_prefix("@@")
        .and_then(|rest| {
            let at = rest.find('@')?;
            rest[at..].strip_prefix("@@")
        })
        .unwrap_or("")
        .trim()
        .to_string();
    (caption, body)
}

/// The added/removed lines, prefix kept so a `+foo` never matches a `-foo`.
fn changed_lines(body: &str) -> Vec<String> {
    body.split('\n')
        .filter(|l| l.starts_with('+') || l.starts_with('-'))
        .map(str::to_string)
        .collect()
}

/// The durable id of a hunk: caption and body, without the line numbers.
pub fn hunk_hash(hunk: &str) -> String {
    let (caption, body) = hunk_parts(hunk);
    fnv1a64(&format!("{caption}\n{body}"))
}

fn hunk_ref(path: &str, hunk: &str) -> HunkRef {
    let (_, body) = hunk_parts(hunk);
    HunkRef {
        path: path.to_string(),
        hash: hunk_hash(hunk),
        lines: changed_lines(body).iter().map(|l| fnv1a64(l)).collect(),
    }
}

/// `members` stays the file-level view for readers that know nothing of hunks,
/// so it is DERIVED: a split path is filed under whichever list holds most of
/// its hunks, ties going to the earlier list. Paths without hunks are untouched.
fn sync_members(mut state: ChangelistState) -> ChangelistState {
    let mut paths: Vec<String> = Vec::new();
    for l in &state.lists {
        for h in &l.hunks {
            if !paths.contains(&h.path) {
                paths.push(h.path.clone());
            }
        }
    }
    for path in paths {
        let mut best: Option<usize> = None;
        let mut best_count = 0usize;
        for (i, l) in state.lists.iter().enumerate() {
            let n = l.hunks.iter().filter(|h| h.path == path).count();
            if n > best_count {
                best_count = n;
                best = Some(i);
            }
        }
        for l in &mut state.lists {
            l.members.retain(|p| p != &path);
        }
        if let Some(i) = best {
            state.lists[i].members.push(path);
        }
    }
    state
}

/// Assign one hunk to `to_id`, removing it from whatever list holds it — the
/// hunk-in-exactly-one-list invariant, the sub-file counterpart of `move_file`.
/// Takes the raw hunk, not its hash: the stored ref carries the +/- line hashes
/// too, which is what lets reconcile recover a hunk whose context drifted.
#[cfg_attr(not(test), allow(dead_code))]
pub fn move_hunk(state: &ChangelistState, path: &str, hunk: &str, to_id: &str) -> ChangelistState {
    if !state.lists.iter().any(|l| l.id == to_id) {
        return state.clone();
    }
    let r = hunk_ref(path, hunk);
    let mut next = state.clone();
    for l in &mut next.lists {
        l.hunks.retain(|h| !(h.path == r.path && h.hash == r.hash));
    }
    if let Some(t) = next.lists.iter_mut().find(|l| l.id == to_id) {
        t.hunks.push(r);
    }
    sync_members(next)
}

#[cfg_attr(not(test), allow(dead_code))]
pub fn list_of_hunk<'a>(state: &'a ChangelistState, path: &str, hash: &str) -> Option<&'a str> {
    state
        .lists
        .iter()
        .find(|l| l.hunks.iter().any(|h| h.path == path && h.hash == hash))
        .map(|l| l.id.as_str())
}

/// Share of the smaller +/- line set the two hunks have in common.
#[cfg_attr(not(test), allow(dead_code))]
fn overlap(a: &[String], b: &[String]) -> f64 {
    if a.is_empty() || b.is_empty() {
        return 0.0;
    }
    let shared = a.iter().filter(|l| b.contains(l)).count();
    shared as f64 / a.len().min(b.len()) as f64
}

/// A stage-2 match must be good enough AND clearly the best, so a hunk is never
/// pulled into a list on a coin-flip between two similar candidates.
#[cfg_attr(not(test), allow(dead_code))]
const OVERLAP_MIN: f64 = 0.5;

/// Reconcile stored hunk membership against the diff as it stands now. Two
/// stages; a hunk surviving neither is treated exactly like a brand-new change
/// — it goes to the ACTIVE list, never to a list it was not in, and its file is
/// reported so the panel can mark it.
#[cfg_attr(not(test), allow(dead_code))]
pub fn reconcile_hunks(
    state: &ChangelistState,
    files: &[(String, Vec<String>)],
) -> (ChangelistState, Vec<String>) {
    let mut next = state.clone();
    let active_id = if next.lists.iter().any(|l| l.id == next.active_id) {
        next.active_id.clone()
    } else {
        DEFAULT_ID.to_string()
    };
    let active_idx = next
        .lists
        .iter()
        .position(|l| l.id == active_id)
        .unwrap_or(0);
    let mut drifted: Vec<String> = Vec::new();

    // Everything stored, with the list that held it. Consumed as matches are
    // made, so one stored hunk can never claim two fresh ones.
    let stored: Vec<(HunkRef, String)> = next
        .lists
        .iter()
        .flat_map(|l| l.hunks.iter().map(|h| (h.clone(), l.id.clone())))
        .collect();

    // Rebuilt from scratch: a stored hunk absent from the fresh diff is gone.
    for l in &mut next.lists {
        l.hunks.clear();
    }

    for (path, hunks) in files {
        let candidates: Vec<&(HunkRef, String)> =
            stored.iter().filter(|(h, _)| &h.path == path).collect();
        let mut taken = vec![false; candidates.len()];
        let fresh: Vec<HunkRef> = hunks.iter().map(|h| hunk_ref(path, h)).collect();

        // Stage 1 — exact context hash.
        let mut unresolved: Vec<HunkRef> = Vec::new();
        for r in fresh {
            let hit = candidates
                .iter()
                .enumerate()
                .find(|(i, (h, _))| !taken[*i] && h.hash == r.hash)
                .map(|(i, (_, list_id))| (i, list_id.clone()));
            match hit {
                Some((i, list_id)) => {
                    taken[i] = true;
                    if let Some(l) = next.lists.iter_mut().find(|l| l.id == list_id) {
                        l.hunks.push(r);
                    }
                }
                None => unresolved.push(r),
            }
        }

        // Stage 2 — overlap of the +/- lines, for a hunk whose context moved.
        for r in unresolved {
            let mut best: Option<(usize, String, f64)> = None;
            let mut tied = false;
            for (i, (h, list_id)) in candidates.iter().enumerate() {
                if taken[i] {
                    continue;
                }
                let score = overlap(&r.lines, &h.lines);
                if score < OVERLAP_MIN {
                    continue;
                }
                match &best {
                    Some((_, _, b)) if score > *b => {
                        best = Some((i, list_id.clone(), score));
                        tied = false;
                    }
                    Some((_, _, b)) if (score - *b).abs() < f64::EPSILON => tied = true,
                    Some(_) => {}
                    None => best = Some((i, list_id.clone(), score)),
                }
            }
            match best {
                Some((i, list_id, _)) if !tied => {
                    taken[i] = true;
                    if let Some(l) = next.lists.iter_mut().find(|l| l.id == list_id) {
                        l.hunks.push(r);
                    }
                }
                // Stage 3 — unresolvable. Brand-new treatment: the active list,
                // and the file surfaced rather than quietly re-filed.
                _ => {
                    next.lists[active_idx].hunks.push(r);
                    if !drifted.contains(path) {
                        drifted.push(path.clone());
                    }
                }
            }
        }
    }

    (sync_members(next), drifted)
}

#[cfg(test)]
mod tests {
    use super::*;

    const HUNK_A: &str = "@@ -1,3 +1,4 @@ fn alpha()\n ctx\n-removed\n+added";
    const HUNK_B: &str = "@@ -20,2 +21,3 @@ fn beta()\n keep\n+beta line";

    // Pinned in the TS suite too (app/utils/changelist.test.ts): both sides read
    // and write the same file, so a drift in either hash has to go red here.
    #[test]
    fn hunk_hash_matches_the_typescript_vectors() {
        assert_eq!(hunk_hash(HUNK_A), "c907e1087d29ad53");
        assert_eq!(hunk_hash("@@ -1 +1 @@ grüßen\n+äöü"), "4086f7e513f4fc64");
    }

    #[test]
    fn hunk_hash_ignores_line_numbers_but_not_the_caption() {
        let moved = "@@ -80,3 +91,4 @@ fn alpha()\n ctx\n-removed\n+added";
        assert_eq!(hunk_hash(moved), hunk_hash(HUNK_A));
        let other = "@@ -1,3 +1,4 @@ fn gamma()\n ctx\n-removed\n+added";
        assert_ne!(hunk_hash(other), hunk_hash(HUNK_A));
    }

    #[test]
    fn move_hunk_keeps_a_hunk_in_one_list_and_lets_a_path_span_lists() {
        let s = initial_state();
        let (s, feature) = create_list(&s, "Feature");
        let s = move_hunk(&s, "a.ts", HUNK_A, &feature);
        let s = move_hunk(&s, "a.ts", HUNK_A, DEFAULT_ID);
        assert_eq!(
            list_of_hunk(&s, "a.ts", &hunk_hash(HUNK_A)),
            Some(DEFAULT_ID)
        );
        assert_eq!(s.lists.iter().flat_map(|l| &l.hunks).count(), 1);

        let s = move_hunk(&s, "a.ts", HUNK_B, &feature);
        assert_eq!(
            list_of_hunk(&s, "a.ts", &hunk_hash(HUNK_A)),
            Some(DEFAULT_ID)
        );
        assert_eq!(
            list_of_hunk(&s, "a.ts", &hunk_hash(HUNK_B)),
            Some(feature.as_str())
        );
    }

    #[test]
    fn members_follow_the_majority_holder_with_list_order_breaking_ties() {
        let s = initial_state();
        let (s, feature) = create_list(&s, "Feature");
        let third = "@@ -40,1 +40,2 @@\n x\n+third";
        let s = move_hunk(&s, "a.ts", HUNK_A, &feature);
        let s = move_hunk(&s, "a.ts", third, &feature);
        let s = move_hunk(&s, "a.ts", HUNK_B, DEFAULT_ID);
        assert_eq!(list_of(&s, "a.ts"), Some(feature.as_str()));

        // 1 vs 1 → the earlier list (Default) wins.
        let t = initial_state();
        let (t, feat2) = create_list(&t, "Feature");
        let t = move_hunk(&t, "b.ts", HUNK_A, DEFAULT_ID);
        let t = move_hunk(&t, "b.ts", HUNK_B, &feat2);
        assert_eq!(list_of(&t, "b.ts"), Some(DEFAULT_ID));
    }

    #[test]
    fn delete_list_rehomes_hunks_into_default() {
        let s = initial_state();
        let (s, feature) = create_list(&s, "Feature");
        let s = move_hunk(&s, "a.ts", HUNK_A, &feature);
        let s = delete_list(&s, &feature);
        assert_eq!(
            list_of_hunk(&s, "a.ts", &hunk_hash(HUNK_A)),
            Some(DEFAULT_ID)
        );
    }

    #[test]
    fn reconcile_hunks_resolves_by_hash_then_overlap_then_falls_to_active() {
        let s = initial_state();
        let (s, feature) = create_list(&s, "Feature");
        let (s, other) = create_list(&s, "Other");
        let s = set_active(&s, &other);
        let s = move_hunk(&s, "a.ts", HUNK_A, &feature);

        // Stage 1 — untouched.
        let (out, drifted) = reconcile_hunks(&s, &[("a.ts".into(), vec![HUNK_A.into()])]);
        assert_eq!(
            list_of_hunk(&out, "a.ts", &hunk_hash(HUNK_A)),
            Some(feature.as_str())
        );
        assert!(drifted.is_empty());

        // Stage 2 — context moved, same +/- lines.
        let shifted = "@@ -1,4 +1,5 @@ fn alpha()\n ctx\n other\n-removed\n+added";
        assert_ne!(hunk_hash(shifted), hunk_hash(HUNK_A));
        let (out, drifted) = reconcile_hunks(&s, &[("a.ts".into(), vec![shifted.into()])]);
        assert_eq!(
            list_of_hunk(&out, "a.ts", &hunk_hash(shifted)),
            Some(feature.as_str())
        );
        assert!(drifted.is_empty());

        // Stage 3 — unresolvable: the ACTIVE list, never the one it was not in.
        let unrelated = "@@ -99,1 +99,2 @@ fn zeta()\n q\n+totally different";
        let (out, drifted) = reconcile_hunks(&s, &[("a.ts".into(), vec![unrelated.into()])]);
        assert_eq!(
            list_of_hunk(&out, "a.ts", &hunk_hash(unrelated)),
            Some(other.as_str())
        );
        assert_eq!(drifted, vec!["a.ts".to_string()]);

        // A hunk gone from the diff is dropped.
        let (out, _) = reconcile_hunks(&s, &[]);
        assert_eq!(list_of_hunk(&out, "a.ts", &hunk_hash(HUNK_A)), None);
    }

    #[test]
    fn hunk_persistence_is_additive_and_stays_at_version_1() {
        let s = initial_state();
        let (s, feature) = create_list(&s, "Feature");
        let s = move_hunk(&s, "a.ts", HUNK_A, &feature);
        let json = serialize(&s);
        assert!(json.contains(r#""version": 1"#));
        assert_eq!(deserialize(&json), Some(s));

        // A file written before hunks existed still reads.
        let old = deserialize(
            r#"{"version":1,"activeId":"default","lists":[
                {"id":"default","name":"Default","members":["a.ts"]}]}"#,
        )
        .expect("reads a pre-hunk file");
        assert_eq!(list_of(&old, "a.ts"), Some(DEFAULT_ID));

        // And a hunk cannot sit in two lists after a hand edit.
        let dup = deserialize(
            r#"{"version":1,"activeId":"default","lists":[
                {"id":"default","name":"Default","members":[],"hunks":[{"path":"a.ts","hash":"deadbeef"}]},
                {"id":"feature","name":"Feature","members":[],"hunks":[{"path":"a.ts","hash":"deadbeef"}]}]}"#,
        )
        .expect("normalizes");
        assert_eq!(list_of_hunk(&dup, "a.ts", "deadbeef"), Some(DEFAULT_ID));
        assert_eq!(dup.lists.iter().flat_map(|l| &l.hunks).count(), 1);
    }

    #[test]
    fn move_file_takes_the_paths_hunks_with_it() {
        let s = initial_state();
        let (s, feature) = create_list(&s, "Feature");
        let s = move_hunk(&s, "a.ts", HUNK_A, &feature);
        let s = move_hunk(&s, "a.ts", HUNK_B, DEFAULT_ID);

        // The file-level gesture asserts itself over the sub-file split...
        let s = move_file(&s, "a.ts", &feature);
        assert_eq!(list_of(&s, "a.ts"), Some(feature.as_str()));
        assert_eq!(
            list_of_hunk(&s, "a.ts", &hunk_hash(HUNK_B)),
            Some(feature.as_str())
        );

        // ...and the result is a fixed point: a round-trip through normalize
        // must not recompute `members` back out of a hunk left behind.
        let back = deserialize(&serialize(&s)).expect("round-trips");
        assert_eq!(list_of(&back, "a.ts"), Some(feature.as_str()));
    }

    #[test]
    fn move_file_keeps_one_path_in_one_list() {
        let s = initial_state();
        let (s, feature) = create_list(&s, "Feature");
        let s = move_file(&s, "a.ts", &feature);
        let s = move_file(&s, "a.ts", DEFAULT_ID);
        assert_eq!(list_of(&s, "a.ts"), Some(DEFAULT_ID));
        let count = s
            .lists
            .iter()
            .flat_map(|l| &l.members)
            .filter(|p| *p == "a.ts")
            .count();
        assert_eq!(count, 1);
    }

    #[test]
    fn delete_list_returns_members_to_default_and_never_deletes_default() {
        let s = initial_state();
        let (s, feature) = create_list(&s, "Feature");
        let s = move_file(&s, "a.ts", &feature);
        let s = delete_list(&s, &feature);
        assert_eq!(
            s.lists.iter().map(|l| l.id.as_str()).collect::<Vec<_>>(),
            vec![DEFAULT_ID]
        );
        assert_eq!(list_of(&s, "a.ts"), Some(DEFAULT_ID));
        let before = serialize(&s);
        let s = delete_list(&s, DEFAULT_ID);
        assert_eq!(serialize(&s), before);
    }

    #[test]
    fn reconcile_prunes_vanished_and_routes_new_to_active() {
        let s = initial_state();
        let (s, feature) = create_list(&s, "Feature");
        let s = set_active(&s, &feature);
        let s = move_file(&s, "kept.ts", &feature);
        let s = move_file(&s, "gone.ts", DEFAULT_ID);
        let s = reconcile(&s, &["kept.ts".to_string(), "new.ts".to_string()]);
        assert_eq!(list_of(&s, "gone.ts"), None);
        assert_eq!(list_of(&s, "kept.ts"), Some(feature.as_str()));
        assert_eq!(list_of(&s, "new.ts"), Some(feature.as_str()));
    }

    #[test]
    fn round_trips_through_serialize_deserialize() {
        let s = initial_state();
        let (s, feature) = create_list(&s, "Feature");
        let s = set_active(&s, &feature);
        let s = move_file(&s, "a.ts", &feature);
        assert_eq!(deserialize(&serialize(&s)), Some(s));
    }

    #[test]
    fn deserialize_rejects_bad_input_and_normalizes() {
        assert_eq!(deserialize("{not json"), None);
        assert_eq!(
            deserialize(r#"{"version":999,"activeId":"default","lists":[]}"#),
            None
        );
        // Unknown active id resets to Default; Default re-added at the front; a
        // duplicated path is kept only in the first list.
        let s = deserialize(
            r#"{"version":1,"activeId":"ghost","lists":[
                {"id":"feature","name":"Feature","members":["a.ts","b.ts"]},
                {"id":"other","name":"Other","members":["a.ts"]}]}"#,
        )
        .expect("normalizes");
        assert_eq!(s.lists[0].id, DEFAULT_ID);
        assert_eq!(s.active_id, DEFAULT_ID);
        assert_eq!(list_of(&s, "a.ts"), Some("feature"));
    }
}
