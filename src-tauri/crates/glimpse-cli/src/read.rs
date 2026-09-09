//! The read commands: what the GUI's viewing surfaces show, as text or JSON.
//!
//! Each command is two halves, kept apart on purpose. Fetching goes through
//! [`Repo`](glimpse_core::git::Repo) and needs a real repository; **rendering**
//! is a pure function over the fetched structs, so the human output can be
//! pinned by a test that never touches a filesystem. `--json` skips the
//! rendering entirely and serialises the struct — the very same camelCase
//! contract the GUI receives over IPC, so a script and the app never disagree
//! about what a field is called.

use crate::{fail, open_repo, parse_globals, wants_json};
use glimpse_core::git::{Branch, Commit, RepoInfo, StatusEntry};
use std::io::Write;

/// How many commits `log` shows when no `-n` is given. Matches the GUI's first
/// page of history rather than git's unbounded default: the terminal is not a
/// scrollback the app can lazily extend.
const DEFAULT_LOG_LIMIT: u32 = 50;

pub(crate) fn run(cmd: &str, args: &[String], out: &mut dyn Write, err: &mut dyn Write) -> i32 {
    let globals = match parse_globals(args) {
        Ok(g) => g,
        // `globals` is what failed, so the flag comes off argv instead — see
        // `wants_json`. Without it a `--json` caller gets a plain line here and
        // a JSON object everywhere else.
        Err(e) => return fail(err, wants_json(args), "glimpse", &e),
    };
    if globals.help {
        let _ = write!(out, "{}", crate::help());
        return 0;
    }
    let json = globals.json;

    // A bad flag and `--help` are answered above, before a repository is
    // opened; from here on every arm needs one.
    let result = match cmd {
        "status" => {
            let repo = open_repo(globals.dir);
            repo.status()
                .and_then(|entries| emit(&entries, json, || render_status(&entries)))
        }
        "log" => match log_limit(&globals.rest) {
            Ok(limit) => {
                let repo = open_repo(globals.dir);
                repo.log(limit)
                    .and_then(|commits| emit(&commits, json, || render_log(&commits)))
            }
            Err(e) => Err(e),
        },
        // `branches` renders from the whole `RepoInfo` (it needs to know which
        // branch is checked out) but emits only the branch array under --json,
        // so the machine shape is the list the command's name promises.
        "branches" | "branch" => {
            let repo = open_repo(globals.dir);
            repo.info().and_then(|info| {
                emit(&info.branches, json, || {
                    render_branches(&info.branches, &info.current_branch)
                })
            })
        }
        "info" => {
            let repo = open_repo(globals.dir);
            repo.info()
                .and_then(|info| emit(&info, json, || render_info(&info)))
        }
        other => Err(format!(
            "unknown subcommand: {other}\n\nRun `glimpse --help` for the list."
        )),
    };

    match result {
        Ok(text) => {
            let _ = write!(out, "{text}");
            0
        }
        Err(e) => fail(err, json, "glimpse", &e),
    }
}

/// Serialise under `--json`, otherwise render for a human. One place, so no
/// command can accidentally support only one of the two shapes.
fn emit<T: serde::Serialize>(
    value: &T,
    json: bool,
    render: impl FnOnce() -> String,
) -> Result<String, String> {
    if json {
        serde_json::to_string(value)
            .map(|s| format!("{s}\n"))
            .map_err(|e| format!("could not serialise the result: {e}"))
    } else {
        Ok(render())
    }
}

/// `log`'s own argument: `-n <count>`. Anything else is a mistake worth naming
/// rather than ignoring — a silently dropped flag reads as a wrong answer.
fn log_limit(rest: &[String]) -> Result<u32, String> {
    let mut limit = DEFAULT_LOG_LIMIT;
    let mut it = rest.iter();
    while let Some(a) = it.next() {
        match a.as_str() {
            "-n" | "--max-count" => {
                let raw = it.next().ok_or("missing count after -n")?;
                limit = raw
                    .parse()
                    .map_err(|_| format!("not a commit count: {raw}"))?;
            }
            other => return Err(format!("unexpected argument: {other}")),
        }
    }
    Ok(limit)
}

// ── Rendering ──────────────────────────────────────────────────────────────

/// Two status columns then the path, as `git status --short` writes them, plus
/// the two facts the GUI badges and porcelain does not spell out: a conflicted
/// entry and an LFS-managed one.
fn render_status(entries: &[StatusEntry]) -> String {
    if entries.is_empty() {
        return "clean working tree\n".to_string();
    }
    let mut out = String::new();
    for e in entries {
        let mut notes: Vec<&str> = Vec::new();
        if e.conflicted {
            notes.push("conflicted");
        }
        if e.is_lfs {
            notes.push("lfs");
        }
        let suffix = if notes.is_empty() {
            String::new()
        } else {
            format!("  ({})", notes.join(", "))
        };
        out.push_str(&format!(
            "{}{} {}{suffix}\n",
            column(&e.x),
            column(&e.y),
            e.path
        ));
    }
    out
}

/// An empty status column still has to occupy its place, or ` M file` and
/// `M  file` — unstaged versus staged — stop being distinguishable.
fn column(c: &str) -> &str {
    if c.is_empty() {
        " "
    } else {
        c
    }
}

/// One commit per line: short hash, date, author, subject, then any refs
/// pointing at it — the same fields the graph row shows, minus the drawing.
fn render_log(commits: &[Commit]) -> String {
    if commits.is_empty() {
        return "no commits\n".to_string();
    }
    let mut out = String::new();
    for c in commits {
        let short: String = c.hash.chars().take(7).collect();
        let refs = if c.refs.is_empty() {
            String::new()
        } else {
            format!("  ({})", c.refs.join(", "))
        };
        out.push_str(&format!(
            "{short}  {}  {}  {}{refs}\n",
            c.date, c.author, c.subject
        ));
    }
    out
}

/// Branches with the two things a terminal user actually asks for: which one is
/// checked out, and whether it has anywhere to push to.
fn render_branches(branches: &[Branch], current: &str) -> String {
    if branches.is_empty() {
        return "no branches\n".to_string();
    }
    let mut out = String::new();
    for b in branches {
        let marker = if b.name == current { "*" } else { " " };
        let mut notes: Vec<String> = Vec::new();
        if b.ahead > 0 {
            notes.push(format!("ahead {}", b.ahead));
        }
        if b.behind > 0 {
            notes.push(format!("behind {}", b.behind));
        }
        notes.push(if b.published { "published" } else { "local" }.to_string());
        out.push_str(&format!("{marker} {}  ({})\n", b.name, notes.join(", ")));
    }
    out
}

/// The header bar's worth of state, one fact per line.
fn render_info(info: &RepoInfo) -> String {
    let target = match &info.distro {
        Some(d) => format!("{} ({d})", info.flavor),
        None => info.flavor.clone(),
    };
    let mut out = String::new();
    out.push_str(&format!("Repository:  {}\n", info.toplevel));
    out.push_str(&format!("Branch:      {}\n", info.current_branch));
    out.push_str(&format!("Git:         {target}\n"));
    out.push_str(&format!(
        "Branches:    {} local, {} remote\n",
        info.branches.len(),
        info.remote_branches.len()
    ));
    out.push_str(&format!("Remotes:     {}\n", list_or_none(&info.remotes)));
    out.push_str(&format!("Tags:        {}\n", info.tags.len()));
    out.push_str(&format!("Stashes:     {}\n", info.stashes.len()));
    if info.rebase_in_progress {
        out.push_str("In progress: rebase\n");
    }
    if info.bisect_in_progress {
        out.push_str("In progress: bisect\n");
    }
    out
}

fn list_or_none(items: &[String]) -> String {
    if items.is_empty() {
        "none".to_string()
    } else {
        items.join(", ")
    }
}

#[cfg(test)]
mod tests {
    use super::{log_limit, render_branches, render_status, DEFAULT_LOG_LIMIT};
    use glimpse_core::git::{Branch, StatusEntry};

    fn entry(path: &str, x: &str, y: &str) -> StatusEntry {
        StatusEntry {
            path: path.to_string(),
            x: x.to_string(),
            y: y.to_string(),
            staged: !x.trim().is_empty(),
            unstaged: !y.trim().is_empty(),
            untracked: x == "?",
            conflicted: false,
            is_lfs: false,
        }
    }

    #[test]
    fn status_keeps_the_two_porcelain_columns_aligned() {
        let rows = [entry("a.txt", "", "M"), entry("b.txt", "M", "")];
        assert_eq!(render_status(&rows), " M a.txt\nM  b.txt\n");
    }

    #[test]
    fn status_names_the_states_porcelain_does_not() {
        let mut e = entry("c.txt", "U", "U");
        e.conflicted = true;
        e.is_lfs = true;
        assert_eq!(render_status(&[e]), "UU c.txt  (conflicted, lfs)\n");
    }

    #[test]
    fn a_clean_tree_says_so_rather_than_printing_nothing() {
        // Empty output reads as a broken command; the answer is "no changes".
        assert_eq!(render_status(&[]), "clean working tree\n");
    }

    fn branch(name: &str, ahead: u32, behind: u32, published: bool) -> Branch {
        Branch {
            name: name.to_string(),
            ahead,
            behind,
            published,
        }
    }

    #[test]
    fn branches_mark_the_checked_out_one_and_its_divergence() {
        let rows = [branch("main", 2, 1, true), branch("wip", 0, 0, false)];
        assert_eq!(
            render_branches(&rows, "main"),
            "* main  (ahead 2, behind 1, published)\n  wip  (local)\n"
        );
    }

    #[test]
    fn log_defaults_to_a_page_and_accepts_a_count() {
        assert_eq!(log_limit(&[]).unwrap(), DEFAULT_LOG_LIMIT);
        let args = ["-n".to_string(), "3".to_string()];
        assert_eq!(log_limit(&args).unwrap(), 3);
    }

    #[test]
    fn log_refuses_what_it_cannot_honour() {
        // Each of these was a plausible silent no-op; a wrong-looking log is
        // harder to notice than a refusal.
        let bad = ["-n".to_string(), "many".to_string()];
        assert!(log_limit(&bad).unwrap_err().contains("many"));
        let dangling = ["-n".to_string()];
        assert!(log_limit(&dangling).unwrap_err().contains("count"));
        let stray = ["--graph".to_string()];
        assert!(log_limit(&stray).unwrap_err().contains("--graph"));
    }
}
