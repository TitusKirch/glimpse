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
use glimpse_core::git::{
    BlameLine, Branch, Commit, CommitFile, DiffData, ReflogEntry, Repo, RepoInfo, RepoStats,
    SparseStatus, StashEntry, StatusEntry, Submodule, Worktree,
};
use std::io::Write;

/// How many entries `log` and `reflog` show when no `-n` is given. Matches the
/// GUI's first page of history rather than git's unbounded default: the terminal
/// is not a scrollback the app can lazily extend.
const DEFAULT_LIMIT: u32 = 50;

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
        "log" => match count_limit(&globals.rest) {
            Ok(limit) => {
                let repo = open_repo(globals.dir);
                repo.log(limit)
                    .and_then(|commits| emit(&commits, json, || render_log(&commits)))
            }
            Err(e) => Err(e),
        },
        "diff" => match diff_args(&globals.rest) {
            Ok(opts) => {
                let repo = open_repo(globals.dir);
                collect_diffs(&repo, &opts)
                    .and_then(|diffs| emit(&diffs, json, || render_diffs(&diffs)))
            }
            Err(e) => Err(e),
        },
        "blame" => match one_file(&globals.rest, "blame") {
            Ok(file) => {
                let repo = open_repo(globals.dir);
                repo.blame(&file)
                    .and_then(|lines| emit(&lines, json, || render_blame(&lines)))
            }
            Err(e) => Err(e),
        },
        "show" => match one_rev(&globals.rest) {
            Ok(rev) => {
                let repo = open_repo(globals.dir);
                commit_detail(&repo, &rev)
                    .and_then(|detail| emit(&detail, json, || render_commit(&detail)))
            }
            Err(e) => Err(e),
        },
        "reflog" => match count_limit(&globals.rest) {
            Ok(limit) => {
                let repo = open_repo(globals.dir);
                repo.reflog(limit)
                    .and_then(|entries| emit(&entries, json, || render_reflog(&entries)))
            }
            Err(e) => Err(e),
        },
        // `--follow`s one file through renames, which is why it takes exactly
        // one path: `git log --follow` refuses more, and so should this.
        "history" | "file-history" => match one_file(&globals.rest, "history") {
            Ok(file) => {
                let repo = open_repo(globals.dir);
                repo.file_history(&file)
                    .and_then(|commits| emit(&commits, json, || render_log(&commits)))
            }
            Err(e) => Err(e),
        },
        // `branches` renders from the whole `RepoInfo` (it needs to know which
        // branch is checked out) but emits only the branch array under --json,
        // so the machine shape is the list the command's name promises.
        "branches" => {
            let repo = open_repo(globals.dir);
            repo.info().and_then(|info| {
                emit(&info.branches, json, || {
                    render_branches(&info.branches, &info.current_branch)
                })
            })
        }
        // The listing half of `glimpse tag` / `glimpse remote`. Both were only
        // ever readable through `info` before those groups existed, which meant
        // reading nine other things to see them.
        "tags" => {
            let repo = open_repo(globals.dir);
            repo.tag_names()
                .and_then(|names| emit(&names, json, || render_names(&names, "no tags")))
        }
        "remotes" => {
            let repo = open_repo(globals.dir);
            repo.remote_names()
                .and_then(|names| emit(&names, json, || render_names(&names, "no remotes")))
        }
        "info" => {
            let repo = open_repo(globals.dir);
            repo.info()
                .and_then(|info| emit(&info, json, || render_info(&info)))
        }
        "stashes" => {
            let repo = open_repo(globals.dir);
            repo.stash_list()
                .and_then(|entries| emit(&entries, json, || render_stashes(&entries)))
        }
        "worktrees" | "worktree" => {
            let repo = open_repo(globals.dir);
            repo.worktrees()
                .and_then(|trees| emit(&trees, json, || render_worktrees(&trees)))
        }
        "submodules" | "submodule" => {
            let repo = open_repo(globals.dir);
            repo.submodules()
                .and_then(|subs| emit(&subs, json, || render_submodules(&subs)))
        }
        "sparse" | "sparse-checkout" => {
            let repo = open_repo(globals.dir);
            repo.sparse_status()
                .and_then(|state| emit(&state, json, || render_sparse(&state)))
        }
        "stats" => {
            let repo = open_repo(globals.dir);
            repo.repo_stats()
                .and_then(|stats| emit(&stats, json, || render_stats(&stats)))
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

/// The `-n <count>` argument `log` and `reflog` share. Anything else is a
/// mistake worth naming rather than ignoring — a silently dropped flag reads as
/// a wrong answer.
fn count_limit(rest: &[String]) -> Result<u32, String> {
    let mut limit = DEFAULT_LIMIT;
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

/// `diff`'s own arguments: which side to read, whether to ignore whitespace,
/// and the files to look at.
struct DiffArgs {
    staged: bool,
    ignore_whitespace: bool,
    /// Empty means "whatever the working tree changed", resolved from `status`.
    files: Vec<String>,
}

/// Anything that is not a known flag is a path — but a word that *looks* like a
/// flag is a mistake, not a filename. `--cached` (git's spelling of `--staged`)
/// would otherwise be looked up as a file and reported as an empty diff.
fn diff_args(rest: &[String]) -> Result<DiffArgs, String> {
    let mut opts = DiffArgs {
        staged: false,
        ignore_whitespace: false,
        files: Vec::new(),
    };
    for a in rest {
        match a.as_str() {
            "--staged" => opts.staged = true,
            "-w" | "--ignore-whitespace" => opts.ignore_whitespace = true,
            other if other.starts_with('-') => return Err(format!("unexpected argument: {other}")),
            other => opts.files.push(other.to_string()),
        }
    }
    Ok(opts)
}

/// One [`DiffData`] per file that actually differs.
///
/// With no files named, the set comes from `status` — the same list `glimpse
/// status` prints, filtered to the side being read, so `diff` and `status` can
/// never disagree about what changed. A file whose diff is empty is dropped
/// rather than reported as a file with no hunks.
fn collect_diffs(repo: &Repo, opts: &DiffArgs) -> Result<Vec<DiffData>, String> {
    let files = if opts.files.is_empty() {
        repo.status()?
            .into_iter()
            .filter(|e| {
                if opts.staged {
                    e.staged
                } else {
                    // An untracked or conflicted entry carries NEITHER flag —
                    // `parse::status` clears both — yet both have working-tree
                    // content to show and both appear in `glimpse status`.
                    // Testing `unstaged` alone silently dropped every new file.
                    e.unstaged || e.untracked || e.conflicted
                }
            })
            .map(|e| e.path)
            .collect()
    } else {
        opts.files.clone()
    };

    let mut diffs = Vec::new();
    for file in files {
        if let Some(d) = repo.file_diff(&file, opts.staged, opts.ignore_whitespace, false)? {
            diffs.push(d);
        }
    }
    Ok(diffs)
}

/// The optional revision argument `show` takes, defaulting to `HEAD` — the
/// commit a user asking "what just landed?" means.
fn one_rev(rest: &[String]) -> Result<String, String> {
    match rest {
        [] => Ok("HEAD".to_string()),
        [rev] => Ok(rev.clone()),
        _ => Err(format!(
            "show takes one commit, got {}: {}",
            rest.len(),
            rest.join(", ")
        )),
    }
}

/// One commit's detail panel: the resolved hash, its full message and the files
/// it touched. Assembled here rather than in the engine because it is three
/// engine calls the GUI makes separately as the user opens the panel — the CLI
/// answers in one shot, so it asks for all three at once.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct CommitDetail {
    /// The revision resolved to a full hash, so a caller can quote it back.
    commit: String,
    message: String,
    files: Vec<CommitFile>,
}

fn commit_detail(repo: &Repo, rev: &str) -> Result<CommitDetail, String> {
    // Resolved first: one clear failure for a bad revision, rather than the
    // same one reported twice by the two calls that follow.
    let commit = repo.resolve_commit(rev)?;
    Ok(CommitDetail {
        message: repo.commit_body(&commit)?,
        files: repo.commit_files(&commit)?,
        commit,
    })
}

/// The single path argument the per-file commands take. Both failure modes are
/// named rather than guessed at: none given would otherwise read as "the whole
/// repository", and two given would silently ignore the second.
fn one_file(rest: &[String], cmd: &str) -> Result<String, String> {
    match rest {
        [file] => Ok(file.clone()),
        [] => Err(format!("{cmd} needs a file: glimpse {cmd} <file>")),
        _ => Err(format!(
            "{cmd} takes exactly one file, got {}: {}",
            rest.len(),
            rest.join(", ")
        )),
    }
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

/// The hunks, under a heading per file — a unified diff, which is what a
/// terminal reader and every downstream tool already know how to read. The two
/// facts the hunks cannot carry (an LFS pointer, a withheld side) are stated,
/// because a diff that quietly showed less than the file holds reads as broken.
fn render_diffs(diffs: &[DiffData]) -> String {
    if diffs.is_empty() {
        return "no changes\n".to_string();
    }
    let mut out = String::new();
    for d in diffs {
        out.push_str(&format!("--- {}\n", d.file_name));
        if d.is_lfs {
            out.push_str("    (Git LFS pointer — the hunks show the pointer, not the file)\n");
        }
        if d.whole_refused {
            out.push_str("    (too large for the whole-file view; showing the unified diff)\n");
        }
        for hunk in &d.hunks {
            out.push_str(hunk);
            if !hunk.ends_with('\n') {
                out.push('\n');
            }
        }
    }
    out
}

/// Blame in `git blame`'s own shape — hash, then who and when in parentheses,
/// then the line. Keeping git's layout means an eye (and an existing script)
/// trained on `git blame` reads this without relearning it.
fn render_blame(lines: &[BlameLine]) -> String {
    if lines.is_empty() {
        return "no lines to blame\n".to_string();
    }
    let mut out = String::new();
    for l in lines {
        out.push_str(&format!(
            "{}  ({} {} {:>4}) {}\n",
            l.hash, l.author, l.date, l.line, l.content
        ));
    }
    out
}

/// One commit: hash, message, then the files it touched with their status
/// letter — the detail panel's three sections, in its order.
fn render_commit(detail: &CommitDetail) -> String {
    let mut out = format!("commit {}\n\n", detail.commit);
    for line in detail.message.lines() {
        out.push_str(&format!("    {line}\n"));
    }
    if detail.files.is_empty() {
        out.push_str("\nNo files changed (an empty or merge commit).\n");
        return out;
    }
    out.push_str(&format!("\nFiles ({}):\n", detail.files.len()));
    for f in &detail.files {
        out.push_str(&format!("  {}  {}\n", f.status, f.path));
    }
    out
}

/// Reflog entries: selector, the commit it points at, and what moved HEAD.
/// The selector leads because it is what `git reset`/`checkout` takes back.
fn render_reflog(entries: &[ReflogEntry]) -> String {
    if entries.is_empty() {
        return "no reflog entries\n".to_string();
    }
    let mut out = String::new();
    for e in entries {
        out.push_str(&format!("{}  {}  {}\n", e.selector, e.hash, e.subject));
    }
    out
}

/// Stash entries, ref first — the ref is what every stash write action takes,
/// so it is the field a reader is here to copy.
/// A bare list of names, one per line — the whole shape `tags` and `remotes`
/// have. `empty` is the sentence for none, because a blank answer reads as a
/// command that failed quietly.
fn render_names(names: &[String], empty: &str) -> String {
    if names.is_empty() {
        return format!("{empty}\n");
    }
    let mut out = String::new();
    for n in names {
        out.push_str(n);
        out.push('\n');
    }
    out
}

fn render_stashes(entries: &[StashEntry]) -> String {
    if entries.is_empty() {
        return "no stashes\n".to_string();
    }
    let mut out = String::new();
    for e in entries {
        out.push_str(&format!("{}  {}\n", e.reference, e.message));
    }
    out
}

/// Worktrees, path first, then what is checked out there. A worktree with no
/// branch is the interesting one, so `detached`, `bare` and `locked` are spelled
/// out rather than left to an empty column.
fn render_worktrees(trees: &[Worktree]) -> String {
    if trees.is_empty() {
        return "no worktrees\n".to_string();
    }
    let mut out = String::new();
    for w in trees {
        let mut notes: Vec<String> = Vec::new();
        if w.bare {
            notes.push("bare".to_string());
        } else if w.detached {
            notes.push(format!("detached at {}", w.head));
        } else {
            notes.push(w.branch.clone());
        }
        if w.locked {
            notes.push("locked".to_string());
        }
        out.push_str(&format!("{}  ({})\n", w.path, notes.join(", ")));
    }
    out
}

/// Submodules with `git submodule status`'s leading state character spelled
/// out — the difference between "in sync" and "needs update" is the whole
/// reason to look, and a single punctuation mark is not a readable answer.
fn render_submodules(subs: &[Submodule]) -> String {
    if subs.is_empty() {
        return "no submodules\n".to_string();
    }
    let mut out = String::new();
    for s in subs {
        let state = match s.state.as_str() {
            "+" => "needs update",
            "-" => "uninitialised",
            "U" => "conflicts",
            _ => "in sync",
        };
        let short: String = s.sha.chars().take(7).collect();
        out.push_str(&format!("{}  {short}  ({state})\n", s.path));
    }
    out
}

/// Sparse-checkout is one of two states, and the off state is the one a reader
/// most needs said out loud: an empty pattern list and a disabled checkout look
/// identical otherwise.
fn render_sparse(state: &SparseStatus) -> String {
    if !state.enabled {
        return "sparse-checkout: disabled (the whole tree is checked out)\n".to_string();
    }
    let mut out = String::from("sparse-checkout: enabled\n");
    if state.patterns.is_empty() {
        out.push_str("  (no patterns — nothing outside the repository root)\n");
    }
    for p in &state.patterns {
        out.push_str(&format!("  {p}\n"));
    }
    out
}

/// How many contributors and churn entries the human rendering shows. `--json`
/// carries the whole list; a terminal summary that scrolls is not a summary.
const STATS_ROWS: usize = 10;

/// The insights panel as a page of text: the totals first, then the two lists
/// worth ranking, then the activity window as a range rather than a per-day
/// dump — a repository with years of history has more days than a screen.
fn render_stats(stats: &RepoStats) -> String {
    let mut out = String::new();
    out.push_str(&format!("Commits:      {}\n", stats.total_commits));
    out.push_str(&format!("Contributors: {}\n", stats.contributors.len()));

    if let (Some(first), Some(last)) = (stats.activity.first(), stats.activity.last()) {
        out.push_str(&format!(
            "Activity:     {} day(s), {} → {}\n",
            stats.activity.len(),
            first.date,
            last.date
        ));
    }

    if !stats.contributors.is_empty() {
        out.push_str(&format!(
            "\nTop contributors (of {}):\n",
            stats.contributors.len()
        ));
        for c in stats.contributors.iter().take(STATS_ROWS) {
            out.push_str(&format!("  {:>6}  {} <{}>\n", c.commits, c.name, c.email));
        }
    }

    if !stats.churn.is_empty() {
        out.push_str(&format!(
            "\nMost changed files (of {}):\n",
            stats.churn.len()
        ));
        for f in stats.churn.iter().take(STATS_ROWS) {
            out.push_str(&format!("  {:>6}  {}\n", f.changes, f.path));
        }
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
    use super::{count_limit, one_file, render_branches, render_status, DEFAULT_LIMIT};
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
        assert_eq!(count_limit(&[]).unwrap(), DEFAULT_LIMIT);
        let args = ["-n".to_string(), "3".to_string()];
        assert_eq!(count_limit(&args).unwrap(), 3);
    }

    #[test]
    fn log_refuses_what_it_cannot_honour() {
        // Each of these was a plausible silent no-op; a wrong-looking log is
        // harder to notice than a refusal.
        let bad = ["-n".to_string(), "many".to_string()];
        assert!(count_limit(&bad).unwrap_err().contains("many"));
        let dangling = ["-n".to_string()];
        assert!(count_limit(&dangling).unwrap_err().contains("count"));
        let stray = ["--graph".to_string()];
        assert!(count_limit(&stray).unwrap_err().contains("--graph"));
    }

    #[test]
    fn a_per_file_command_names_both_ways_its_path_can_be_wrong() {
        assert_eq!(one_file(&["a.txt".to_string()], "blame").unwrap(), "a.txt");
        // No path would otherwise read as "the whole repository"…
        let none = one_file(&[], "blame").unwrap_err();
        assert!(none.contains("blame") && none.contains("file"), "{none:?}");
        // …and a second path would be silently dropped.
        let two = ["a.txt".to_string(), "b.txt".to_string()];
        let many = one_file(&two, "blame").unwrap_err();
        assert!(many.contains("b.txt"), "{many:?}");
    }
}
