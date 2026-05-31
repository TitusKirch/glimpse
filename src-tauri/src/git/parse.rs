//! Pure parsers: raw `git` output → serde structs. No IO, no shell-out — the
//! risky decoding logic (lane assignment, hunk splitting, porcelain decoding)
//! lives here so it is testable through a string interface. See
//! `docs/ARCHITECTURE.md` §9.

use super::{lines, Commit, CommitFile, DiffData, StatusEntry, US};

/// Decode `git status --porcelain=v1 --untracked-files=all -z`.
pub fn status(raw: &str) -> Vec<StatusEntry> {
    let tokens: Vec<&str> = raw.split('\u{0}').filter(|s| !s.is_empty()).collect();
    let mut entries = Vec::new();
    let mut i = 0;
    while i < tokens.len() {
        let tok = tokens[i];
        i += 1;
        if tok.len() < 3 {
            continue;
        }
        let bytes = tok.as_bytes();
        let x = bytes[0] as char;
        let y = bytes[1] as char;
        let path = tok[3..].to_string();
        // Renames/copies carry an extra "from" path token; skip it.
        if x == 'R' || x == 'C' {
            i += 1;
        }
        let untracked = x == '?';
        entries.push(StatusEntry {
            path,
            x: x.to_string(),
            y: y.to_string(),
            staged: !untracked && x != ' ',
            unstaged: !untracked && y != ' ',
            untracked,
        });
    }
    entries
}

/// Decode the `%H␟%P␟%an␟%ad␟%D␟%s` log format and assign graph lanes.
pub fn log(raw: &str) -> Vec<Commit> {
    let mut commits: Vec<Commit> = raw
        .lines()
        .filter_map(|line| {
            let mut f = line.split(US);
            let hash = f.next()?.to_string();
            let parents = f
                .next()
                .unwrap_or("")
                .split_whitespace()
                .map(str::to_string)
                .collect();
            let author = f.next().unwrap_or("").to_string();
            let date = f.next().unwrap_or("").to_string();
            let refs = f
                .next()
                .unwrap_or("")
                .split(", ")
                .filter(|r| !r.is_empty())
                .map(str::to_string)
                .collect();
            let subject = f.next().unwrap_or("").to_string();
            Some(Commit {
                hash,
                subject,
                author,
                date,
                refs,
                parents,
                lane: 0,
            })
        })
        .collect();

    assign_lanes(&mut commits);
    commits
}

/// Assign a column ("lane") to each commit so the frontend can draw a
/// multi-branch graph. Commits arrive newest-first. Each lane tracks the hash
/// of the next commit expected to occupy it; the first parent continues a
/// lane, extra parents (merges) open new lanes.
fn assign_lanes(commits: &mut [Commit]) {
    let mut lanes: Vec<Option<String>> = Vec::new();

    let free_lane = |lanes: &mut Vec<Option<String>>| -> usize {
        match lanes.iter().position(Option::is_none) {
            Some(i) => i,
            None => {
                lanes.push(None);
                lanes.len() - 1
            }
        }
    };

    for commit in commits.iter_mut() {
        let lane = match lanes
            .iter()
            .position(|l| l.as_deref() == Some(&commit.hash))
        {
            Some(i) => i,
            None => free_lane(&mut lanes),
        };
        commit.lane = lane as u32;

        // A commit can be awaited by several lanes at once — it is the branch
        // point where a side branch later merges back into this line. Free
        // every lane that was waiting for it, otherwise those reservations go
        // stale and the graph keeps getting wider. The chosen lane carries on
        // via the first parent below.
        for slot in lanes.iter_mut() {
            if slot.as_deref() == Some(&commit.hash) {
                *slot = None;
            }
        }

        // First parent continues this lane; clear it otherwise.
        lanes[lane] = commit.parents.first().cloned();

        // Extra parents (merge) reserve their own lanes if not already tracked.
        for parent in commit.parents.iter().skip(1) {
            if !lanes.iter().any(|l| l.as_deref() == Some(parent.as_str())) {
                let i = free_lane(&mut lanes);
                lanes[i] = Some(parent.clone());
            }
        }
    }
}

/// List of files changed by a commit, from `git show --name-status --format=`.
pub fn commit_files(raw: &str) -> Vec<CommitFile> {
    lines(raw)
        .filter_map(|line| {
            let mut parts = line.split('\t');
            let status = parts.next()?.chars().next()?;
            // For renames/copies the last field is the new path.
            let path = parts.next_back()?.to_string();
            Some(CommitFile {
                path,
                status: status.to_string(),
            })
        })
        .collect()
}

/// Pull the first file's name + hunks out of a unified-diff blob. The content
/// fields are left empty; the caller fills them from `git show`.
pub fn diff(raw: &str) -> Option<DiffData> {
    let mut file_name: Option<String> = None;
    let mut hunks: Vec<String> = Vec::new();
    let mut cur: Option<String> = None;

    for line in raw.lines() {
        if line.starts_with("diff --git") {
            if file_name.is_some() {
                break; // only the first file in this skeleton
            }
            continue;
        }
        if let Some(name) = line.strip_prefix("+++ b/") {
            file_name = Some(name.to_string());
            continue;
        }
        if line.starts_with("@@") {
            if let Some(h) = cur.take() {
                hunks.push(h);
            }
            cur = Some(line.to_string());
        } else if let Some(h) = cur.as_mut() {
            h.push('\n');
            h.push_str(line);
        }
    }
    if let Some(h) = cur.take() {
        hunks.push(h);
    }

    file_name
        .filter(|_| !hunks.is_empty())
        .map(|name| DiffData {
            file_name: name,
            old_content: String::new(),
            new_content: String::new(),
            hunks,
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn z(parts: &[&str]) -> String {
        parts.join("\u{0}") + "\u{0}"
    }

    #[test]
    fn status_classifies_index_and_worktree() {
        let raw = z(&["M  staged.rs", " M dirty.rs", "?? new.rs"]);
        let e = status(&raw);
        assert_eq!(e.len(), 3);
        assert!(e[0].staged && !e[0].unstaged);
        assert!(!e[1].staged && e[1].unstaged);
        assert!(e[2].untracked && !e[2].staged && !e[2].unstaged);
    }

    #[test]
    fn status_skips_rename_from_path() {
        // Rename carries an extra "from" token that must not become an entry.
        let raw = z(&["R  new_name.rs", "old_name.rs", " M other.rs"]);
        let e = status(&raw);
        assert_eq!(e.len(), 2);
        assert_eq!(e[0].path, "new_name.rs");
        assert_eq!(e[1].path, "other.rs");
    }

    #[test]
    fn log_parses_fields_and_refs() {
        let line =
            format!("abc123{US}p1 p2{US}Ada{US}2026-05-31{US}HEAD -> main, origin/main{US}feat: x");
        let c = log(&line);
        assert_eq!(c.len(), 1);
        assert_eq!(c[0].hash, "abc123");
        assert_eq!(c[0].parents, vec!["p1", "p2"]);
        assert_eq!(c[0].refs, vec!["HEAD -> main", "origin/main"]);
        assert_eq!(c[0].subject, "feat: x");
    }

    #[test]
    fn lanes_linear_history_stays_in_lane_zero() {
        let raw = format!(
            "c{US}b{US}a{US}d{US}{US}third\nb{US}a{US}a{US}d{US}{US}second\na{US}{US}a{US}d{US}{US}first"
        );
        let c = log(&raw);
        assert_eq!(c.iter().map(|x| x.lane).collect::<Vec<_>>(), vec![0, 0, 0]);
    }

    #[test]
    fn lanes_merge_opens_second_lane() {
        // m has two parents (p1, p2) -> p2 must get its own lane.
        let raw = format!(
            "m{US}p1 p2{US}a{US}d{US}{US}merge\np1{US}base{US}a{US}d{US}{US}p1\np2{US}base{US}a{US}d{US}{US}p2"
        );
        let c = log(&raw);
        assert_eq!(c[0].lane, 0);
        assert_eq!(c[1].lane, 0); // p1 continues lane 0
        assert_eq!(c[2].lane, 1); // p2 in the lane the merge reserved
    }

    #[test]
    fn status_copy_skips_source_path() {
        let raw = z(&["C  copy.rs", "orig.rs", " M other.rs"]);
        let e = status(&raw);
        assert_eq!(e.len(), 2);
        assert_eq!(e[0].path, "copy.rs");
        assert!(e[0].staged);
        assert_eq!(e[1].path, "other.rs");
    }

    #[test]
    fn empty_inputs_yield_empty_results() {
        assert!(status("").is_empty());
        assert!(log("").is_empty());
        assert!(commit_files("").is_empty());
        assert!(diff("").is_none());
    }

    #[test]
    fn lanes_are_reused_after_a_branch_merges_back() {
        // Two side branches (S2, S1) each branch off the mainline and merge
        // back (at M2, M1). Once a branch rejoins, its lane must free so the
        // next branch reuses it — otherwise the graph keeps widening.
        let raw = format!(
            "M2{US}C S2{US}a{US}d{US}{US}m2\n\
             S2{US}C{US}a{US}d{US}{US}s2\n\
             C{US}M1{US}a{US}d{US}{US}c\n\
             M1{US}A S1{US}a{US}d{US}{US}m1\n\
             S1{US}A{US}a{US}d{US}{US}s1\n\
             A{US}{US}a{US}d{US}{US}a"
        );
        let c = log(&raw);
        let max_lane = c.iter().map(|k| k.lane).max().unwrap();
        assert_eq!(max_lane, 1, "branch lanes must be reused, not accumulated");
    }

    #[test]
    fn commit_files_takes_new_path_on_rename() {
        let raw = "M\tsrc/a.rs\nR100\told.rs\tsrc/new.rs\n";
        let f = commit_files(raw);
        assert_eq!(f.len(), 2);
        assert_eq!(f[0].status, "M");
        assert_eq!(f[1].status, "R");
        assert_eq!(f[1].path, "src/new.rs");
    }

    #[test]
    fn diff_splits_hunks_and_takes_first_file() {
        let raw = "diff --git a/x.rs b/x.rs\n--- a/x.rs\n+++ b/x.rs\n@@ -1 +1 @@\n-old\n+new\n@@ -5 +5 @@\n context\ndiff --git a/y.rs b/y.rs\n+++ b/y.rs\n@@ -1 +1 @@\n-z\n+w";
        let d = diff(raw).expect("a diff");
        assert_eq!(d.file_name, "x.rs");
        assert_eq!(d.hunks.len(), 2);
        assert!(d.hunks[0].starts_with("@@ -1 +1 @@"));
    }

    #[test]
    fn diff_without_hunks_is_none() {
        assert!(diff("diff --git a/x b/x\n").is_none());
    }
}
