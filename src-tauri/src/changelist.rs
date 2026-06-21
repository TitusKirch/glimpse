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
    if !state.lists.iter().any(|l| l.id == state.active_id) {
        state.active_id = DEFAULT_ID.to_string();
    }
    state
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

/// Move a path into `to_id`, removing it from whatever list currently holds it —
/// the one-path-one-list invariant is enforced here.
pub fn move_file(state: &ChangelistState, path: &str, to_id: &str) -> ChangelistState {
    if !state.lists.iter().any(|l| l.id == to_id) {
        return state.clone();
    }
    let mut next = state.clone();
    for list in &mut next.lists {
        list.members.retain(|p| p != path);
    }
    if let Some(target) = next.lists.iter_mut().find(|l| l.id == to_id) {
        target.members.push(path.to_string());
    }
    next
}

/// The id of the list holding `path`, if any. Part of the ported model API
/// (mirrors the TS `listOf`); currently exercised only by the tests.
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
        })
        .collect();
    if lists.is_empty() {
        lists.push(Changelist {
            id: DEFAULT_ID.to_string(),
            name: "Default".to_string(),
            members: Vec::new(),
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

#[cfg(test)]
mod tests {
    use super::*;

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
