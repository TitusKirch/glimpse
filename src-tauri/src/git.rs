//! Git engine. A [`Repo`] is a resolved repository: the platform decision
//! (native git vs. WSL git) is made once in [`Repo::open`], then every git
//! operation is a method on the handle. Output is decoded by the pure
//! [`parse`] module into serde structs that mirror the frontend's store shapes.

use crate::platform::{self, GitTarget};
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::process::Stdio;
use ts_rs::TS;

mod parse;

const US: char = '\u{1f}'; // unit separator, safe field delimiter

fn lines(s: &str) -> impl Iterator<Item = &str> {
    s.lines().filter(|l| !l.trim().is_empty())
}

/// Reject a value git could misread as a command-line option. Applied to every
/// ref / branch / tag / hash / remote-name / stash-ref / URL before it reaches
/// git. This is the backend's own authoritative guard, independent of the
/// frontend's zod (which only runs in the browser layer and is bypassed by a
/// direct IPC call, XSS, or attacker-controlled ref names coming back from a
/// malicious repository). A leading `-` is the option-injection vector; control
/// characters can't appear in a valid ref anyway.
fn reject_option(v: &str) -> Result<(), String> {
    if v.is_empty() || v.starts_with('-') || v.bytes().any(|b| b < 0x20) {
        return Err(format!("rejected unsafe argument: {v:?}"));
    }
    Ok(())
}

/// Reject a working-tree path that escapes the repository (absolute path or
/// `..` traversal) or that could inject extra headers into an interpolated
/// patch (CR/LF/NUL). Used for every file path an IPC command passes through.
fn reject_unsafe_path(v: &str) -> Result<(), String> {
    if v.is_empty() || is_unsafe_path(v) {
        return Err(format!("rejected unsafe path: {v:?}"));
    }
    Ok(())
}

/// Reject a hunk body that isn't pure hunk content. Every line of a real hunk
/// begins with a hunk-header (`@`) or a context / add / remove / no-newline
/// marker (` `, `+`, `-`, `\`). A line starting with anything else terminates
/// the hunk in `git apply`'s parser, which would let an attacker smuggle a
/// SECOND file section (e.g. `diff --git a/other …`) and stage content into a
/// different in-repo path. The body is interpolated raw into the patch, so it
/// must be validated as tightly as the file path.
fn reject_unsafe_hunk(hunk: &str) -> Result<(), String> {
    for line in hunk.lines() {
        let valid =
            line.is_empty() || matches!(line.as_bytes()[0], b'@' | b' ' | b'+' | b'-' | b'\\');
        if !valid {
            return Err(format!("rejected unsafe hunk line: {line:?}"));
        }
    }
    Ok(())
}

/// True if `v` escapes the repository or could inject into an interpolated
/// patch. Detects Unix-absolute (`/…`), UNC (`\\…`), and Windows-drive
/// (`C:\…`) paths regardless of the build target — the WSL path runs on Windows
/// where these all matter — plus `..` traversal and CR/LF/NUL. Shared so the
/// native `read_file` sink applies the exact same rule.
pub fn is_unsafe_path(v: &str) -> bool {
    let bytes = v.as_bytes();
    let win_drive = bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':';
    v.starts_with('/')
        || v.starts_with('\\')
        || std::path::Path::new(v).is_absolute()
        || win_drive
        || v.split(['/', '\\']).any(|c| c == "..")
        || v.bytes().any(|b| b == b'\n' || b == b'\r' || b == 0)
}

/// Reduce a unified-diff hunk to only the user-selected `+`/`-` lines, for
/// line-level (sub-hunk) staging. `selected` holds 0-based indices into the hunk
/// body — every context / add / remove line counts; the `@@` header and any
/// `\ No newline` marker do not. The transform is direction-dependent:
///
/// * Staging (`reverse == false`, forward `git apply --cached`): keep context
///   and selected lines; **drop** unselected additions (they must not land in
///   the index) and demote unselected removals to context (the line still exists
///   on the index/old side, so it stays).
/// * Unstaging (`reverse == true`, `git apply --cached --reverse`): the patch is
///   applied backwards, so the roles flip — demote unselected additions to
///   context (they stay staged) and **drop** unselected removals.
///
/// The `@@` line counts are left as-is and recomputed by `git apply --recount`;
/// only the start offsets matter and those are unchanged by the reduction.
fn build_partial_hunk(hunk: &str, selected: &[u32], reverse: bool) -> String {
    let mut out = String::new();
    let mut body: u32 = 0;
    for (i, line) in hunk.lines().enumerate() {
        if i == 0 {
            out.push_str(line);
            out.push('\n');
            continue;
        }
        let Some(&marker) = line.as_bytes().first() else {
            continue; // a blank separator line carries no diff content
        };
        if marker == b'\\' {
            // "\ No newline at end of file" — metadata for the preceding line.
            out.push_str(line);
            out.push('\n');
            continue;
        }
        let rest = &line[1..];
        let idx = body;
        body += 1;
        let keep = selected.contains(&idx);
        let mut push = |m: char| {
            out.push(m);
            out.push_str(rest);
            out.push('\n');
        };
        match marker {
            b' ' => push(' '),
            b'+' => {
                if keep {
                    push('+');
                } else if reverse {
                    push(' ');
                }
            }
            b'-' => {
                if keep {
                    push('-');
                } else if !reverse {
                    push(' ');
                }
            }
            _ => {}
        }
    }
    out
}

/// Parse `git check-attr --stdin -z filter` output into the set of paths whose
/// `filter` attribute is `lfs`. The `-z` stream is flat NUL-separated fields in
/// `path\0 attr\0 value\0` triplets.
fn lfs_from_check_attr(out: &str) -> std::collections::HashSet<String> {
    let fields: Vec<&str> = out.split('\u{0}').collect();
    let mut set = std::collections::HashSet::new();
    let mut i = 0;
    while i + 2 < fields.len() {
        if fields[i + 1] == "filter" && fields[i + 2] == "lfs" {
            set.insert(fields[i].to_string());
        }
        i += 3;
    }
    set
}

/// Build a `git rebase -i` todo list from a plan, plus the message files it
/// references. `reword` becomes a `pick` and `squash`/`reword` with a new message
/// get an `exec git commit --amend --file=<path>` line right after, so the
/// message is applied from a file (no shell-quoting of free text) and no editor
/// opens. `msg_prefix` is the absolute path stem of those files *as git sees it*
/// (a Linux path inside WSL). Returns the todo and the `(path, message)` pairs
/// the caller must write. An unknown action is treated as `pick`.
fn build_rebase_todo(steps: &[RebaseStep], msg_prefix: &str) -> (String, Vec<(String, String)>) {
    let mut todo = String::new();
    let mut msgs = Vec::new();
    for (i, step) in steps.iter().enumerate() {
        let action = match step.action.as_str() {
            "drop" => "drop",
            "squash" => "squash",
            "fixup" => "fixup",
            // `reword` is realised as pick + exec-amend; anything else is a pick.
            _ => "pick",
        };
        todo.push_str(&format!("{action} {}\n", step.hash));
        if matches!(step.action.as_str(), "reword" | "squash") {
            if let Some(message) = &step.message {
                let path = format!("{msg_prefix}{i}");
                todo.push_str(&format!("exec git commit --amend --file=\"{path}\"\n"));
                msgs.push((path, message.clone()));
            }
        }
    }
    (todo, msgs)
}

/// Standard base64 (with `=` padding) — to embed image bytes in a `data:` URL.
/// Dependency-free so the careful dep policy stays intact.
fn base64_encode(input: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(input.len().div_ceil(3) * 4);
    for chunk in input.chunks(3) {
        let b1 = chunk.get(1).copied().unwrap_or(0);
        let b2 = chunk.get(2).copied().unwrap_or(0);
        let n = ((chunk[0] as u32) << 16) | ((b1 as u32) << 8) | b2 as u32;
        out.push(T[((n >> 18) & 63) as usize] as char);
        out.push(T[((n >> 12) & 63) as usize] as char);
        out.push(if chunk.len() > 1 {
            T[((n >> 6) & 63) as usize] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            T[(n & 63) as usize] as char
        } else {
            '='
        });
    }
    out
}

/// Map a file extension to an image MIME type, or `None` for non-images.
fn image_mime(file: &str) -> Option<&'static str> {
    match file
        .rsplit('.')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "avif" => Some("image/avif"),
        "bmp" => Some("image/bmp"),
        "ico" => Some("image/x-icon"),
        "svg" => Some("image/svg+xml"),
        _ => None,
    }
}

/// Aggregate `git log` author/date lines (`name US email US date`) into the total
/// commit count, contributors (by commit count, desc) and per-day activity (by
/// date, asc). Pure so it is unit-testable; map order is non-deterministic but the
/// outputs are sorted.
fn aggregate_stats(raw: &str) -> (u32, Vec<Contributor>, Vec<ActivityPoint>) {
    use std::collections::HashMap;
    let mut total = 0u32;
    let mut authors: HashMap<(String, String), u32> = HashMap::new();
    let mut days: HashMap<String, u32> = HashMap::new();
    for line in raw.lines() {
        let mut f = line.split(US);
        let (Some(name), Some(email), Some(date)) = (f.next(), f.next(), f.next()) else {
            continue;
        };
        total += 1;
        *authors
            .entry((name.to_string(), email.to_string()))
            .or_default() += 1;
        *days.entry(date.to_string()).or_default() += 1;
    }
    let mut contributors: Vec<Contributor> = authors
        .into_iter()
        .map(|((name, email), commits)| Contributor {
            name,
            email,
            commits,
        })
        .collect();
    contributors.sort_by(|a, b| b.commits.cmp(&a.commits).then(a.name.cmp(&b.name)));
    let mut activity: Vec<ActivityPoint> = days
        .into_iter()
        .map(|(date, count)| ActivityPoint { date, count })
        .collect();
    activity.sort_by(|a, b| a.date.cmp(&b.date));
    (total, contributors, activity)
}

/// Count file occurrences across `git log --name-only` output, returning the
/// `top` most-changed paths (desc). Pure / unit-testable.
fn aggregate_churn(raw: &str, top: usize) -> Vec<FileChurn> {
    use std::collections::HashMap;
    let mut counts: HashMap<&str, u32> = HashMap::new();
    for line in raw.lines() {
        let path = line.trim();
        if !path.is_empty() {
            *counts.entry(path).or_default() += 1;
        }
    }
    let mut churn: Vec<FileChurn> = counts
        .into_iter()
        .map(|(path, changes)| FileChurn {
            path: path.to_string(),
            changes,
        })
        .collect();
    churn.sort_by(|a, b| b.changes.cmp(&a.changes).then(a.path.cmp(&b.path)));
    churn.truncate(top);
    churn
}

/// Derive the directory `git clone` creates from a remote URL — git's "humanish"
/// name: the last path segment with a trailing `.git` removed.
/// `https://host/u/repo.git` and `git@host:u/repo.git` both yield `repo`.
fn clone_dir_name(url: &str) -> &str {
    let trimmed = url.trim_end_matches('/');
    let last = trimmed.rsplit(['/', ':']).next().unwrap_or(trimmed);
    last.strip_suffix(".git").unwrap_or(last)
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Commit {
    pub hash: String,
    pub subject: String,
    pub author: String,
    pub date: String,
    pub refs: Vec<String>,
    pub parents: Vec<String>,
    pub lane: u32,
    /// GPG/SSH signature verification status from `%G?`: `G` good, `U` good but
    /// of unknown validity, `B` bad, `X`/`Y`/`R` expired/revoked, `E` cannot
    /// check, `N` unsigned (empty when git reports nothing).
    pub signature_status: String,
    /// Signer name (`%GS`) when the commit is signed, else empty.
    pub signer_name: String,
    /// Signing key / fingerprint (`%GK`) when available, else empty.
    pub signer_key: String,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Branch {
    pub name: String,
    /// Commits ahead of / behind the configured upstream (0 if none).
    pub ahead: u32,
    pub behind: u32,
    /// True when the branch has a live upstream (it exists on a remote). False
    /// for a purely local branch — never pushed, or its remote ref is `gone`.
    pub published: bool,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct StashEntry {
    /// Stash ref, e.g. `stash@{0}` — used for pop/apply/drop.
    pub reference: String,
    pub message: String,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct RepoInfo {
    pub toplevel: String,
    pub current_branch: String,
    pub branches: Vec<Branch>,
    pub remote_branches: Vec<String>,
    pub remotes: Vec<String>,
    pub tags: Vec<String>,
    pub stashes: Vec<StashEntry>,
    /// True when a rebase is paused (e.g. on a conflict) awaiting
    /// continue / skip / abort.
    pub rebase_in_progress: bool,
    /// True when a `git bisect` session is active.
    pub bisect_in_progress: bool,
    pub flavor: String,
    pub distro: Option<String>,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct DiffData {
    pub file_name: String,
    pub old_content: String,
    pub new_content: String,
    pub hunks: Vec<String>,
    /// The file is tracked by Git LFS: the hunks show the small text *pointer*
    /// (version / oid / size), not the real binary. The viewer frames it as an
    /// LFS object instead of rendering it as source, and `old_content` /
    /// `new_content` are left empty so the smudged binary is never shipped.
    pub is_lfs: bool,
}

/// The two sides of an image file's change, each a `data:` URL (or null when the
/// file is added / deleted), so the viewer can render them visually.
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ImageDiff {
    pub mime: String,
    /// The committed (HEAD) image; null when the file is newly added.
    pub old: Option<String>,
    /// The working-tree image; null when the file was deleted.
    pub new: Option<String>,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct CommitFile {
    pub path: String,
    /// Single-letter change status: M, A, D, R, C.
    pub status: String,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Contributor {
    pub name: String,
    pub email: String,
    pub commits: u32,
}

/// Commits authored on a given `YYYY-MM-DD` day.
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ActivityPoint {
    pub date: String,
    pub count: u32,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct FileChurn {
    pub path: String,
    pub changes: u32,
}

/// Repository insights derived from `git log` (read-only, no heavy deps).
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct RepoStats {
    pub total_commits: u32,
    /// Authors by commit count, descending.
    pub contributors: Vec<Contributor>,
    /// Commits per day, ascending by date.
    pub activity: Vec<ActivityPoint>,
    /// Most-changed files, descending (top 20).
    pub churn: Vec<FileChurn>,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct BlameLine {
    pub line: u32,
    /// Abbreviated commit hash that last touched this line.
    pub hash: String,
    pub author: String,
    pub date: String,
    pub content: String,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct StatusEntry {
    pub path: String,
    /// Index (staged) status char, e.g. "M", "A", "D", "?".
    pub x: String,
    /// Worktree (unstaged) status char.
    pub y: String,
    pub staged: bool,
    pub unstaged: bool,
    pub untracked: bool,
    /// Unmerged (merge-conflict) entry — shown in its own section.
    pub conflicted: bool,
    /// Path is managed by Git LFS (its `filter` attribute is `lfs`) — surfaced
    /// as a badge so a pointer change isn't mistaken for a tiny text edit.
    pub is_lfs: bool,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ReflogEntry {
    /// Reflog selector, e.g. `HEAD@{0}`.
    pub selector: String,
    /// Abbreviated commit hash the entry points at.
    pub hash: String,
    /// Reflog subject, e.g. `reset: moving to HEAD~1`.
    pub subject: String,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Worktree {
    pub path: String,
    /// Short branch name, or empty when detached/bare.
    pub branch: String,
    /// Abbreviated HEAD hash (empty for a bare worktree).
    pub head: String,
    pub bare: bool,
    pub detached: bool,
    pub locked: bool,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Submodule {
    pub path: String,
    /// Abbreviated checked-out commit.
    pub sha: String,
    /// `git submodule status` prefix: " " in sync, "+" needs update,
    /// "-" uninitialised, "U" merge conflicts.
    pub state: String,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct SparseStatus {
    /// Whether sparse-checkout is active for this worktree.
    pub enabled: bool,
    /// The included path patterns (cone-mode directories), empty when disabled.
    pub patterns: Vec<String>,
}

/// One line of an interactive-rebase plan sent from the frontend, in apply order
/// (oldest first). `action` is `pick` | `reword` | `squash` | `fixup` | `drop`;
/// `message` carries the new message for a `reword` (and an overridden combined
/// message for a `squash`), applied without opening an editor.
#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct RebaseStep {
    pub action: String,
    pub hash: String,
    pub message: Option<String>,
}

/// How far `git reset` rewinds. Deserialized from the frontend's
/// `'soft' | 'mixed' | 'hard'` union, so an unknown value is rejected at the IPC
/// seam instead of silently falling back to `--mixed`.
#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ResetMode {
    Soft,
    Mixed,
    Hard,
}

/// A repository with its `git` invocation resolved once. All operations run
/// against the same [`GitTarget`], so the platform seam is touched in one place.
pub struct Repo {
    target: GitTarget,
}

impl Repo {
    /// Resolve how to reach `git` for `repo_path` (native, or WSL on Windows).
    pub fn open(repo_path: &str) -> Self {
        Repo {
            target: platform::resolve(repo_path),
        }
    }

    /// Run `git <args>` against this repo, returning stdout or trimmed stderr.
    fn run(&self, args: &[&str]) -> Result<String, String> {
        let output =
            self.target.command(args).output().map_err(|e| {
                format!("failed to run git: {e}\n\n$ {}", self.target.describe(args))
            })?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(format!("{stderr}\n\n$ {}", self.target.describe(args)));
        }
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    }

    /// Like [`run`], but treats exit code 1 as success — `git diff --no-index`
    /// (used to diff an untracked file against /dev/null) exits 1 whenever the
    /// files differ, which for a new file is always.
    fn run_diff(&self, args: &[&str]) -> String {
        match self.target.command(args).output() {
            Ok(out) if out.status.success() || out.status.code() == Some(1) => {
                String::from_utf8_lossy(&out.stdout).to_string()
            }
            _ => String::new(),
        }
    }

    /// Like [`run`], but returns raw stdout bytes — for binary blobs (e.g. an
    /// image's committed contents) that must not go through lossy UTF-8 decoding.
    fn run_bytes(&self, args: &[&str]) -> Result<Vec<u8>, String> {
        let output = self
            .target
            .command(args)
            .output()
            .map_err(|e| format!("failed to run git: {e}"))?;
        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
        }
        Ok(output.stdout)
    }

    /// Run `git <args>` feeding `input` on stdin (used to pipe a patch into
    /// `git apply`). Returns stdout, or trimmed stderr on failure.
    fn run_stdin(&self, args: &[&str], input: &str) -> Result<String, String> {
        let mut child = self
            .target
            .command(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("failed to run git: {e}"))?;
        child
            .stdin
            .as_mut()
            .ok_or("failed to open git stdin")?
            .write_all(input.as_bytes())
            .map_err(|e| e.to_string())?;
        let output = child.wait_with_output().map_err(|e| e.to_string())?;
        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
        }
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    }

    /// Full content of a git object (`git show <spec>`); empty on error (e.g.
    /// the file did not exist on that side of the diff).
    fn content(&self, spec: &str) -> String {
        self.run(&["show", spec]).unwrap_or_default()
    }

    pub fn info(&self) -> Result<RepoInfo, String> {
        // git reports the toplevel in its own environment (a Linux path under
        // WSL). Map it back to a host path so re-opening it routes the same way
        // — otherwise the WSL distro is lost and the next call hits native git.
        let raw_top = self.run(&["rev-parse", "--show-toplevel"])?;
        let toplevel = self.target.host_path(raw_top.trim());
        // `rev-parse --abbrev-ref HEAD` resolves a branch name (or "HEAD" when
        // detached), but fails on a freshly-initialised repo whose branch is
        // still unborn — fall back to the symbolic ref so empty repos open.
        let current_branch = self
            .run(&["rev-parse", "--abbrev-ref", "HEAD"])
            .or_else(|_| self.run(&["symbolic-ref", "--short", "HEAD"]))
            .map(|s| s.trim().to_string())
            .unwrap_or_default();
        // Per-branch ahead/behind comes from %(upstream:track), e.g.
        // "[ahead 2, behind 1]".
        let branch_fmt = format!("--format=%(refname:short){US}%(upstream:track){US}%(upstream)");
        let branches = parse::branches(&self.run(&["for-each-ref", &branch_fmt, "refs/heads"])?);
        // Remote-tracking branches (e.g. `origin/main`), minus the `origin/HEAD`
        // symbolic pointer.
        let remote_branches =
            lines(&self.run(&["for-each-ref", "--format=%(refname:short)", "refs/remotes"])?)
                .filter(|b| !b.ends_with("/HEAD"))
                .map(str::to_string)
                .collect();
        let remotes = lines(&self.run(&["remote"])?).map(str::to_string).collect();
        let tags = lines(&self.run(&["tag", "--sort=-creatordate"])?)
            .take(50)
            .map(str::to_string)
            .collect();
        let stashes = self.stash_list()?;
        // A rebase is paused (e.g. stopped on a conflict) when REBASE_HEAD exists.
        let rebase_in_progress = self
            .target
            .command(&["rev-parse", "--verify", "--quiet", "REBASE_HEAD"])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);
        // `git bisect log` succeeds only while a bisect session is active.
        let bisect_in_progress = self
            .target
            .command(&["bisect", "log"])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);

        Ok(RepoInfo {
            toplevel,
            current_branch,
            branches,
            remote_branches,
            remotes,
            tags,
            stashes,
            rebase_in_progress,
            bisect_in_progress,
            flavor: self.target.flavor.to_string(),
            distro: self.target.distro.clone(),
        })
    }

    pub fn log(&self, limit: u32) -> Result<Vec<Commit>, String> {
        // A freshly-initialised repo has no commits yet; `git log` would fail
        // hard, so short-circuit to an empty history when there are no refs.
        if self.run(&["rev-parse", "--all"])?.trim().is_empty() {
            return Ok(Vec::new());
        }
        // `%G?`/`%GS`/`%GK` carry the signature verification status, signer name
        // and signing key so the graph can badge signed commits. Trailing fields
        // stay optional in the parser, so other callers (file history) that use
        // the shorter format decode fine.
        let fmt =
            format!("--pretty=format:%H{US}%P{US}%an{US}%ad{US}%D{US}%s{US}%G?{US}%GS{US}%GK");
        let n = format!("-n{limit}");
        // `--all` so every branch/remote/tag tip shows as its own parallel lane;
        // `--topo-order` keeps a branch's commits contiguous for a clean graph.
        let out = self.run(&["log", "--all", "--topo-order", "--date=short", &fmt, &n])?;
        Ok(parse::log(&out))
    }

    /// Pickaxe history search: commits that change the number of occurrences of
    /// `query` (`-S`), or — when `regex` — whose diff has a line matching it as a
    /// regex (`-G`). `query` is concatenated onto the flag so it is always the
    /// search value, never a separate option. Capped and newest-first.
    pub fn search_commits(&self, query: &str, regex: bool) -> Result<Vec<Commit>, String> {
        if query.is_empty() {
            return Ok(Vec::new());
        }
        let flag = if regex {
            format!("-G{query}")
        } else {
            format!("-S{query}")
        };
        let fmt =
            format!("--pretty=format:%H{US}%P{US}%an{US}%ad{US}%D{US}%s{US}%G?{US}%GS{US}%GK");
        let out = self.run(&["log", "--all", "--date=short", "-n200", &fmt, &flag])?;
        Ok(parse::log(&out))
    }

    /// Repository insights: total commits, contributors, per-day activity and the
    /// most-changed files. All derived from two `git log` passes (no extra deps).
    pub fn repo_stats(&self) -> Result<RepoStats, String> {
        if self.run(&["rev-parse", "--all"])?.trim().is_empty() {
            return Ok(RepoStats {
                total_commits: 0,
                contributors: Vec::new(),
                activity: Vec::new(),
                churn: Vec::new(),
            });
        }
        let fmt = format!("--format=%an{US}%ae{US}%ad");
        let log = self.run(&["log", "--all", "--date=short", &fmt])?;
        let (total_commits, contributors, activity) = aggregate_stats(&log);
        let names = self
            .run(&["log", "--all", "--format=", "--name-only"])
            .unwrap_or_default();
        let churn = aggregate_churn(&names, 20);
        Ok(RepoStats {
            total_commits,
            contributors,
            activity,
            churn,
        })
    }

    /// Read the HEAD reflog — the recovery trail for resets/rebases/commits.
    pub fn reflog(&self, limit: u32) -> Result<Vec<ReflogEntry>, String> {
        let fmt = format!("--format=%gd{US}%h{US}%gs");
        let n = format!("-n{limit}");
        let raw = self.run(&["reflog", &fmt, &n])?;
        Ok(parse::reflog(&raw))
    }

    /// Which of `files` Git LFS manages — their `filter` attribute resolves to
    /// `lfs`. One `git check-attr` pass over NUL-separated paths on stdin (its
    /// `-z` output is `path\0 filter\0 value\0` triplets). Detection reads
    /// `.gitattributes` only, so it works even without the `git-lfs` binary
    /// installed; it is best-effort and returns empty on any error so a stray
    /// failure never breaks status or diff.
    fn lfs_paths(&self, files: &[String]) -> std::collections::HashSet<String> {
        if files.is_empty() {
            return std::collections::HashSet::new();
        }
        let input = files.join("\u{0}");
        let Ok(out) = self.run_stdin(&["check-attr", "--stdin", "-z", "filter"], &input) else {
            return std::collections::HashSet::new();
        };
        lfs_from_check_attr(&out)
    }

    pub fn status(&self) -> Result<Vec<StatusEntry>, String> {
        let raw = self.run(&["status", "--porcelain=v1", "--untracked-files=all", "-z"])?;
        let mut entries = parse::status(&raw);
        let files: Vec<String> = entries.iter().map(|e| e.path.clone()).collect();
        let lfs = self.lfs_paths(&files);
        for entry in &mut entries {
            entry.is_lfs = lfs.contains(&entry.path);
        }
        Ok(entries)
    }

    /// Diff of a single file, either the staged version or the working-tree
    /// change. Both file contents are included so the viewer has full context.
    pub fn file_diff(
        &self,
        file: &str,
        staged: bool,
        ignore_whitespace: bool,
        whole: bool,
    ) -> Result<Option<DiffData>, String> {
        reject_unsafe_path(file)?;
        // `--no-ext-diff --no-textconv`: never let a malicious repo's configured
        // external-diff / textconv driver run while we inspect it (we render the
        // diff ourselves from the raw content anyway).
        let mut args = vec!["diff", "--no-color", "--no-ext-diff", "--no-textconv"];
        if staged {
            args.push("--staged");
        }
        if ignore_whitespace {
            args.push("-w");
        }
        // Whole-file view: a huge context turns the diff into one hunk spanning
        // the entire file (every line shown, changes still marked).
        if whole {
            args.push("--unified=100000");
        }
        args.push("--");
        args.push(file);
        let mut raw = self.run(&args)?;

        // Untracked files have no diff target; diff against the null device so
        // the whole file shows up as additions. --no-index exits 1 on any
        // difference, so use run_diff which tolerates that.
        if raw.trim().is_empty() && !staged {
            let null = self.target.null_device();
            raw = self.run_diff(&[
                "diff",
                "--no-color",
                "--no-ext-diff",
                "--no-textconv",
                "--no-index",
                "--",
                null,
                file,
            ]);
        }

        let Some(mut diff) = parse::diff(&raw) else {
            return Ok(None);
        };
        // For an LFS file the hunks already hold the small text pointer; flag it
        // and skip loading full contents — the working side is the smudged binary
        // and shipping it would be wasteful and unrenderable.
        if self.lfs_paths(&[file.to_string()]).contains(file) {
            diff.is_lfs = true;
            return Ok(Some(diff));
        }
        if staged {
            diff.old_content = self.content(&format!("HEAD:{file}"));
            diff.new_content = self.content(&format!(":{file}"));
        } else {
            diff.old_content = self.content(&format!(":{file}"));
            diff.new_content = self.target.read_file(file).unwrap_or_default();
        }
        Ok(Some(diff))
    }

    /// Both sides of an image file as `data:` URLs: the committed (HEAD) blob and
    /// the current working-tree file. Either side is null when absent (added or
    /// deleted), so the viewer can show them visually instead of "no text diff".
    pub fn image_diff(&self, file: &str) -> Result<ImageDiff, String> {
        reject_unsafe_path(file)?;
        let mime = image_mime(file).unwrap_or("application/octet-stream");
        let url = |bytes: &[u8]| format!("data:{mime};base64,{}", base64_encode(bytes));
        let old = self
            .run_bytes(&["show", &format!("HEAD:{file}")])
            .ok()
            .filter(|b| !b.is_empty());
        let new = self.target.read_file_bytes(file);
        Ok(ImageDiff {
            mime: mime.to_string(),
            old: old.as_deref().map(url),
            new: new.as_deref().map(url),
        })
    }

    /// Full commit message (subject + body) for the detail panel.
    pub fn commit_body(&self, hash: &str) -> Result<String, String> {
        reject_option(hash)?;
        Ok(self
            .run(&["show", "-s", "--format=%B", hash])?
            .trim()
            .to_string())
    }

    /// List of files changed by a commit (path + single-letter status).
    pub fn commit_files(&self, hash: &str) -> Result<Vec<CommitFile>, String> {
        reject_option(hash)?;
        let raw = self.run(&["show", "--name-status", "--format=", hash])?;
        Ok(parse::commit_files(&raw))
    }

    /// Diff of a single file as introduced by a commit, with both contents.
    pub fn commit_file_diff(
        &self,
        hash: &str,
        file: &str,
        ignore_whitespace: bool,
        whole: bool,
    ) -> Result<Option<DiffData>, String> {
        reject_option(hash)?;
        reject_unsafe_path(file)?;
        let mut args = vec![
            "show",
            "--no-color",
            "--no-ext-diff",
            "--no-textconv",
            "--format=",
        ];
        if ignore_whitespace {
            args.push("-w");
        }
        if whole {
            args.push("--unified=100000");
        }
        args.extend([hash, "--", file]);
        let raw = self.run(&args)?;
        let Some(mut diff) = parse::diff(&raw) else {
            return Ok(None);
        };
        diff.old_content = self.content(&format!("{hash}^:{file}"));
        diff.new_content = self.content(&format!("{hash}:{file}"));
        Ok(Some(diff))
    }

    pub fn stage(&self, file: &str) -> Result<(), String> {
        reject_unsafe_path(file)?;
        self.run(&["add", "--", file]).map(|_| ())
    }

    pub fn unstage(&self, file: &str) -> Result<(), String> {
        reject_unsafe_path(file)?;
        self.run(&["restore", "--staged", "--", file]).map(|_| ())
    }

    /// Stage (or, with `reverse`, unstage) a single hunk by piping a minimal
    /// one-file patch into `git apply --cached`. `--recount` lets git fix the
    /// `@@` line counts, so the rendered hunk text doesn't need to be exact.
    /// Files changed between two refs (branch/tag/commit) — for the compare view.
    pub fn compare_files(&self, from: &str, to: &str) -> Result<Vec<CommitFile>, String> {
        reject_option(from)?;
        reject_option(to)?;
        let raw = self.run(&["diff", "--name-status", from, to])?;
        Ok(parse::commit_files(&raw))
    }

    /// Per-file diff between two refs (compare view).
    pub fn compare_file_diff(
        &self,
        from: &str,
        to: &str,
        file: &str,
        ignore_whitespace: bool,
        whole: bool,
    ) -> Result<Option<DiffData>, String> {
        reject_option(from)?;
        reject_option(to)?;
        reject_unsafe_path(file)?;
        let mut args = vec!["diff", "--no-color", "--no-ext-diff", "--no-textconv"];
        if ignore_whitespace {
            args.push("-w");
        }
        if whole {
            args.push("--unified=100000");
        }
        args.push(from);
        args.push(to);
        args.push("--");
        args.push(file);
        let raw = self.run(&args)?;
        let Some(mut diff) = parse::diff(&raw) else {
            return Ok(None);
        };
        diff.old_content = self.content(&format!("{from}:{file}"));
        diff.new_content = self.content(&format!("{to}:{file}"));
        Ok(Some(diff))
    }

    pub fn apply_hunk(&self, file: &str, hunk: &str, reverse: bool) -> Result<(), String> {
        // Reject CR/LF/`..`/absolute in the file path: it is interpolated raw
        // into the patch headers below, so a newline could inject extra
        // `+++ b/…` headers and redirect the write outside the intended file.
        reject_unsafe_path(file)?;
        // And reject a hunk body that smuggles a second file section, which would
        // otherwise stage content into a different in-repo path.
        reject_unsafe_hunk(hunk)?;
        let patch = format!("diff --git a/{file} b/{file}\n--- a/{file}\n+++ b/{file}\n{hunk}\n");
        let mut args = vec!["apply", "--cached", "--recount", "--whitespace=nowarn"];
        if reverse {
            args.push("--reverse");
        }
        self.run_stdin(&args, &patch).map(|_| ())
    }

    /// Discard a single hunk from the working tree by reverse-applying it — the
    /// worktree counterpart of unstaging a hunk (`apply_hunk` targets the index).
    pub fn discard_hunk(&self, file: &str, hunk: &str) -> Result<(), String> {
        reject_unsafe_path(file)?;
        reject_unsafe_hunk(hunk)?;
        let patch = format!("diff --git a/{file} b/{file}\n--- a/{file}\n+++ b/{file}\n{hunk}\n");
        self.run_stdin(
            &["apply", "--reverse", "--recount", "--whitespace=nowarn"],
            &patch,
        )
        .map(|_| ())
    }

    /// Stage or unstage only the user-selected lines within a single hunk
    /// (line-level / sub-hunk staging). `lines` are 0-based indices into the
    /// hunk body; the reduced hunk is built by [`build_partial_hunk`] and applied
    /// to the index exactly like [`apply_hunk`] (`--reverse` unstages).
    pub fn apply_lines(
        &self,
        file: &str,
        hunk: &str,
        lines: &[u32],
        reverse: bool,
    ) -> Result<(), String> {
        reject_unsafe_path(file)?;
        reject_unsafe_hunk(hunk)?;
        if lines.is_empty() {
            return Err("no lines selected".to_string());
        }
        let partial = build_partial_hunk(hunk, lines, reverse);
        let patch = format!("diff --git a/{file} b/{file}\n--- a/{file}\n+++ b/{file}\n{partial}");
        let mut args = vec!["apply", "--cached", "--recount", "--whitespace=nowarn"];
        if reverse {
            args.push("--reverse");
        }
        self.run_stdin(&args, &patch).map(|_| ())
    }

    /// Commits that touched a file, following renames (`git log --follow`).
    pub fn file_history(&self, file: &str) -> Result<Vec<Commit>, String> {
        reject_unsafe_path(file)?;
        let fmt = format!("--pretty=format:%H{US}%P{US}%an{US}%ad{US}%D{US}%s");
        let out = self.run(&["log", "--follow", "--date=short", &fmt, "--", file])?;
        Ok(parse::log(&out))
    }

    /// Per-line authorship for a file (`git blame --porcelain`).
    pub fn blame(&self, file: &str) -> Result<Vec<BlameLine>, String> {
        reject_unsafe_path(file)?;
        let raw = self.run(&["blame", "--porcelain", "--", file])?;
        Ok(parse::blame(&raw))
    }

    /// Create a commit, or rewrite the previous one (`--amend`) keeping its
    /// author. Amend lets the user fix the last message/contents before pushing.
    pub fn commit(&self, message: &str, amend: bool) -> Result<String, String> {
        let mut args = vec!["commit", "-m", message];
        if amend {
            args.push("--amend");
        }
        self.run(&args)
    }

    /// Subject + body of the most recent commit, to prefill an amend.
    pub fn head_message(&self) -> Result<String, String> {
        Ok(self
            .run(&["show", "-s", "--format=%B", "HEAD"])?
            .trim()
            .to_string())
    }

    /// Discard a file's working-tree changes. Untracked files are deleted
    /// (`clean`); tracked files are reverted to HEAD (`restore`).
    pub fn discard(&self, file: &str, untracked: bool) -> Result<(), String> {
        reject_unsafe_path(file)?;
        if untracked {
            self.run(&["clean", "-f", "--", file]).map(|_| ())
        } else {
            self.run(&["restore", "--", file]).map(|_| ())
        }
    }

    pub fn checkout_branch(&self, branch: &str) -> Result<(), String> {
        reject_option(branch)?;
        self.run(&["switch", "--", branch]).map(|_| ())
    }

    /// Merge `branch` into the current branch (no editor). Conflicts surface in
    /// the status as unmerged entries, handled by the conflicts UI.
    pub fn merge(&self, branch: &str) -> Result<String, String> {
        reject_option(branch)?;
        // `--no-ff` always records a merge commit, so a merged branch keeps its
        // own lane + merge point in the graph instead of being fast-forwarded
        // into a straight line (which erases the branch topology).
        self.run(&["merge", "--no-ff", "--no-edit", "--", branch])
    }

    /// Rebase the current branch onto `onto` (a branch, tag or commit). A
    /// conflict pauses the rebase for the continue / skip / abort controls.
    pub fn rebase(&self, onto: &str) -> Result<String, String> {
        reject_option(onto)?;
        self.run(&["rebase", onto])
    }

    /// Continue a paused rebase after conflicts are resolved. `core.editor=true`
    /// keeps the original message rather than opening an editor (which would hang
    /// the headless invocation).
    pub fn rebase_continue(&self) -> Result<String, String> {
        self.run(&["-c", "core.editor=true", "rebase", "--continue"])
    }

    /// Skip the current commit in a paused rebase.
    pub fn rebase_skip(&self) -> Result<String, String> {
        self.run(&["-c", "core.editor=true", "rebase", "--skip"])
    }

    /// Abort a paused rebase, restoring the pre-rebase state.
    pub fn rebase_abort(&self) -> Result<(), String> {
        self.run(&["rebase", "--abort"]).map(|_| ())
    }

    /// Run an interactive rebase from a frontend plan (reword / squash / fixup /
    /// drop / reorder) over `base..HEAD`, or the whole history when `base` is
    /// empty (`--root`). `steps` are in apply order.
    ///
    /// Non-interactive without an editor: the todo and any reword/squash messages
    /// are written into the git dir, then `-c sequence.editor='cp <todo>'` feeds
    /// the plan and `exec … --amend --file=…` lines apply the messages. Config is
    /// passed as `-c` flags (not env) so it crosses into WSL git too, and every
    /// path is the absolute path *as git sees it* so it is cwd-independent. A
    /// conflict pauses the rebase exactly like [`rebase`], reusing the existing
    /// continue / skip / abort flow.
    pub fn interactive_rebase(&self, base: &str, steps: &[RebaseStep]) -> Result<String, String> {
        if steps.is_empty() {
            return Err("empty rebase plan".to_string());
        }
        for step in steps {
            reject_option(&step.hash)?;
        }
        if !base.is_empty() {
            reject_option(base)?;
        }
        let git_dir = self
            .run(&["rev-parse", "--absolute-git-dir"])?
            .trim()
            .to_string();
        let todo_view = format!("{git_dir}/glimpse-rebase-todo");
        let msg_prefix = format!("{git_dir}/glimpse-rebase-msg-");
        let (todo, msgs) = build_rebase_todo(steps, &msg_prefix);
        // Write through the host-visible path (the WSL share on Windows); the
        // todo/exec lines reference the git-visible path written above.
        std::fs::write(self.target.host_path(&todo_view), &todo)
            .map_err(|e| format!("failed to write rebase plan: {e}"))?;
        for (path, message) in &msgs {
            std::fs::write(self.target.host_path(path), message)
                .map_err(|e| format!("failed to write rebase message: {e}"))?;
        }
        let editor = format!("sequence.editor=cp \"{todo_view}\"");
        let base_arg = if base.is_empty() { "--root" } else { base };
        self.run(&[
            "-c",
            &editor,
            "-c",
            "core.editor=true",
            "rebase",
            "-i",
            base_arg,
        ])
    }

    /// Commits an interactive rebase from `start` would replay — `start` and its
    /// descendants up to HEAD, oldest first, so the plan dialog can list them in
    /// apply order. Falls back to the whole history when `start` is the root.
    pub fn rebase_commits(&self, start: &str) -> Result<Vec<Commit>, String> {
        reject_option(start)?;
        let parent = format!("{start}^");
        let has_parent = self
            .run(&["rev-parse", "--verify", "--quiet", &parent])
            .is_ok();
        let range = if has_parent {
            format!("{parent}..HEAD")
        } else {
            "HEAD".to_string()
        };
        let fmt =
            format!("--pretty=format:%H{US}%P{US}%an{US}%ad{US}%D{US}%s{US}%G?{US}%GS{US}%GK");
        let out = self.run(&["log", "--reverse", "--date=short", &fmt, &range])?;
        Ok(parse::log(&out))
    }

    /// Start a `git bisect` between a known-bad and known-good ref. Returns git's
    /// output (the next commit to test).
    pub fn bisect_start(&self, bad: &str, good: &str) -> Result<String, String> {
        reject_option(bad)?;
        reject_option(good)?;
        self.run(&["bisect", "start", bad, good])
    }

    /// Mark the current bisect step `good`, `bad` or `skip` and advance. Returns
    /// git's output (the next commit, or the identified first-bad commit).
    pub fn bisect_mark(&self, verdict: &str) -> Result<String, String> {
        let sub = match verdict {
            "good" | "bad" | "skip" => verdict,
            _ => return Err(format!("invalid bisect verdict: {verdict}")),
        };
        self.run(&["bisect", sub])
    }

    /// End the bisect session and return to the original HEAD.
    pub fn bisect_reset(&self) -> Result<(), String> {
        self.run(&["bisect", "reset"]).map(|_| ())
    }

    /// List linked worktrees. Paths are mapped back to host paths so they can be
    /// opened as their own repo tab (round-trips a `\\wsl$` worktree).
    pub fn worktrees(&self) -> Result<Vec<Worktree>, String> {
        let raw = self.run(&["worktree", "list", "--porcelain"])?;
        let mut worktrees = parse::worktrees(&raw);
        for wt in &mut worktrees {
            wt.path = self.target.host_path(&wt.path);
        }
        Ok(worktrees)
    }

    /// Add a worktree at `path`, optionally checking out `reference` (an existing
    /// branch/commit; empty creates one on a new branch named after the path).
    /// `path` is a filesystem location the user picked, so a leading-dash guard —
    /// not the repo-relative path guard — is the right check.
    pub fn worktree_add(&self, path: &str, reference: &str) -> Result<(), String> {
        reject_option(path)?;
        let mut args = vec!["worktree", "add", path];
        if !reference.is_empty() {
            reject_option(reference)?;
            args.push(reference);
        }
        self.run(&args).map(|_| ())
    }

    /// Remove a linked worktree.
    pub fn worktree_remove(&self, path: &str) -> Result<(), String> {
        reject_option(path)?;
        self.run(&["worktree", "remove", path]).map(|_| ())
    }

    /// List submodules and their status. Pointer changes already render in the
    /// diff viewer as git's "Subproject commit" lines, so no extra diff plumbing.
    pub fn submodules(&self) -> Result<Vec<Submodule>, String> {
        Ok(parse::submodules(&self.run(&["submodule", "status"])?))
    }

    /// Initialise + update all submodules to their recorded commits.
    pub fn submodule_update(&self) -> Result<String, String> {
        self.run(&["submodule", "update", "--init", "--recursive"])
    }

    /// Sync submodule remote URLs from `.gitmodules`.
    pub fn submodule_sync(&self) -> Result<(), String> {
        self.run(&["submodule", "sync", "--recursive"]).map(|_| ())
    }

    /// Sparse-checkout state: `git sparse-checkout list` succeeds only when it's
    /// active, listing the included patterns.
    pub fn sparse_status(&self) -> Result<SparseStatus, String> {
        let out = self
            .target
            .command(&["sparse-checkout", "list"])
            .output()
            .map_err(|e| e.to_string())?;
        if out.status.success() {
            let raw = String::from_utf8_lossy(&out.stdout);
            Ok(SparseStatus {
                enabled: true,
                patterns: lines(&raw).map(str::to_string).collect(),
            })
        } else {
            Ok(SparseStatus {
                enabled: false,
                patterns: Vec::new(),
            })
        }
    }

    /// Enable (cone-mode) sparse-checkout limited to `patterns` (directories).
    pub fn sparse_set(&self, patterns: &[String]) -> Result<(), String> {
        if patterns.is_empty() {
            return Err("no paths to include".to_string());
        }
        let mut args = vec!["sparse-checkout", "set", "--"];
        for p in patterns {
            reject_option(p)?;
            args.push(p.as_str());
        }
        self.run(&args).map(|_| ())
    }

    /// Disable sparse-checkout, restoring the full working tree.
    pub fn sparse_disable(&self) -> Result<(), String> {
        self.run(&["sparse-checkout", "disable"]).map(|_| ())
    }

    /// Discard every working-tree change: restore tracked files to HEAD and
    /// remove untracked files/dirs.
    pub fn discard_all(&self) -> Result<(), String> {
        self.run(&["restore", "--staged", "--worktree", "--", "."])?;
        self.run(&["clean", "-fd"]).map(|_| ())
    }

    /// Check out a commit directly, leaving HEAD detached so the user can
    /// inspect or branch off it.
    pub fn checkout_commit(&self, hash: &str) -> Result<(), String> {
        // `git checkout` reads a value after `--` as a pathspec, so a `--`
        // separator can't guard a commit-ish here — reject a leading-dash value.
        reject_option(hash)?;
        self.run(&["checkout", hash]).map(|_| ())
    }

    pub fn create_branch(&self, name: &str) -> Result<(), String> {
        reject_option(name)?;
        self.run(&["switch", "-c", name]).map(|_| ())
    }

    /// Create a branch at a specific commit and switch to it ("branch here").
    pub fn create_branch_at(&self, name: &str, hash: &str) -> Result<(), String> {
        reject_option(name)?;
        reject_option(hash)?;
        self.run(&["switch", "-c", name, hash]).map(|_| ())
    }

    pub fn delete_branch(&self, name: &str) -> Result<(), String> {
        reject_option(name)?;
        self.run(&["branch", "-d", "--", name]).map(|_| ())
    }

    /// Revert a commit (creates a new inverse commit, no editor).
    /// Revert one or more commits (no editor). `mainline` (1-based) selects the
    /// parent to revert against — required when reverting a merge commit.
    pub fn revert(&self, hashes: &[String], mainline: Option<u32>) -> Result<(), String> {
        if hashes.is_empty() {
            return Err("no commits to revert".to_string());
        }
        let mut args = vec!["revert".to_string(), "--no-edit".to_string()];
        if let Some(m) = mainline {
            args.push("-m".to_string());
            args.push(m.to_string());
        }
        args.push("--".to_string());
        for h in hashes {
            reject_option(h)?;
            args.push(h.clone());
        }
        let argv: Vec<&str> = args.iter().map(String::as_str).collect();
        self.run(&argv).map(|_| ())
    }

    /// Cherry-pick a commit onto the current branch.
    /// Cherry-pick one or more commits, applied in the given order (oldest
    /// first). A mid-operation conflict leaves the standard cherry-pick state for
    /// the existing conflict UI to resolve.
    pub fn cherry_pick(&self, hashes: &[String]) -> Result<(), String> {
        if hashes.is_empty() {
            return Err("no commits to cherry-pick".to_string());
        }
        let mut args = vec!["cherry-pick", "--"];
        for h in hashes {
            reject_option(h)?;
            args.push(h.as_str());
        }
        self.run(&args).map(|_| ())
    }

    /// Move the current branch to `hash`. A hard reset discards working-tree
    /// changes — the UI confirms first.
    pub fn reset(&self, hash: &str, mode: ResetMode) -> Result<(), String> {
        // `git reset` treats anything after `--` as a pathspec ("Cannot do soft
        // reset with paths"), so guard the commit-ish by rejecting a leading `-`.
        reject_option(hash)?;
        let flag = match mode {
            ResetMode::Soft => "--soft",
            ResetMode::Mixed => "--mixed",
            ResetMode::Hard => "--hard",
        };
        self.run(&["reset", flag, hash]).map(|_| ())
    }

    pub fn rename_branch(&self, old: &str, new: &str) -> Result<(), String> {
        reject_option(old)?;
        reject_option(new)?;
        self.run(&["branch", "-m", "--", old, new]).map(|_| ())
    }

    /// Set a branch's upstream to `<remote>/<branch>` (so pull/push track it).
    pub fn set_upstream(&self, remote: &str, branch: &str) -> Result<(), String> {
        reject_option(remote)?;
        reject_option(branch)?;
        let target = format!("--set-upstream-to={remote}/{branch}");
        self.run(&["branch", &target, "--", branch]).map(|_| ())
    }

    /// Create a lightweight tag at `hash` (or HEAD when `hash` is empty).
    /// Create a tag. With no message it stays lightweight (a bare ref); a message
    /// makes it annotated (`-a`), and `sign` produces a signed annotated tag
    /// (`-s`, using the configured `user.signingkey` / `gpg.format`). The message
    /// is passed as the value of `-m`, so it is never treated as an option.
    pub fn create_tag(
        &self,
        name: &str,
        hash: &str,
        message: &str,
        sign: bool,
    ) -> Result<(), String> {
        reject_option(name)?;
        let mut args = vec!["tag"];
        if sign {
            args.extend(["-s", "-m", message]);
        } else if !message.is_empty() {
            args.extend(["-a", "-m", message]);
        }
        args.push("--");
        args.push(name);
        if !hash.is_empty() {
            reject_option(hash)?;
            args.push(hash);
        }
        self.run(&args).map(|_| ())
    }

    pub fn delete_tag(&self, name: &str) -> Result<(), String> {
        reject_option(name)?;
        self.run(&["tag", "-d", "--", name]).map(|_| ())
    }

    /// Push all local tags to the default remote.
    pub fn push_tags(&self) -> Result<String, String> {
        self.run(&["push", "--tags"])
    }

    pub fn add_remote(&self, name: &str, url: &str) -> Result<(), String> {
        reject_option(name)?;
        // The URL is positional after the name; a leading `-` would be parsed as
        // an option. (Dangerous transports like `ext::` are blocked by git's own
        // protocol policy on fetch, but reject the option-injection vector here.)
        reject_option(url)?;
        self.run(&["remote", "add", name, url]).map(|_| ())
    }

    pub fn remove_remote(&self, name: &str) -> Result<(), String> {
        reject_option(name)?;
        self.run(&["remote", "remove", name]).map(|_| ())
    }

    pub fn rename_remote(&self, old: &str, new: &str) -> Result<(), String> {
        reject_option(old)?;
        reject_option(new)?;
        self.run(&["remote", "rename", old, new]).map(|_| ())
    }

    /// List stash entries as (ref, message) pairs.
    pub fn stash_list(&self) -> Result<Vec<StashEntry>, String> {
        let fmt = format!("--format=%gd{US}%s");
        let raw = self.run(&["stash", "list", &fmt])?;
        Ok(lines(&raw)
            .filter_map(|l| {
                let mut p = l.splitn(2, US);
                let reference = p.next()?.to_string();
                let message = p.next().unwrap_or("").to_string();
                Some(StashEntry { reference, message })
            })
            .collect())
    }

    /// Stash the working tree. Optionally include untracked files and/or limit to
    /// specific paths (an empty `paths` stashes everything).
    pub fn stash_save(
        &self,
        message: &str,
        include_untracked: bool,
        paths: &[String],
    ) -> Result<(), String> {
        let mut args = vec!["stash", "push"];
        if include_untracked {
            args.push("--include-untracked");
        }
        if !message.is_empty() {
            args.push("-m");
            args.push(message);
        }
        if !paths.is_empty() {
            for p in paths {
                reject_unsafe_path(p)?;
            }
            args.push("--");
            args.extend(paths.iter().map(String::as_str));
        }
        self.run(&args).map(|_| ())
    }

    pub fn stash_pop(&self, reference: &str) -> Result<(), String> {
        reject_option(reference)?;
        self.run(&["stash", "pop", reference]).map(|_| ())
    }

    pub fn stash_apply(&self, reference: &str) -> Result<(), String> {
        reject_option(reference)?;
        self.run(&["stash", "apply", reference]).map(|_| ())
    }

    pub fn stash_drop(&self, reference: &str) -> Result<(), String> {
        reject_option(reference)?;
        self.run(&["stash", "drop", reference]).map(|_| ())
    }

    /// Files changed by a stash — for previewing its contents before pop/apply.
    pub fn stash_files(&self, reference: &str) -> Result<Vec<CommitFile>, String> {
        reject_option(reference)?;
        let raw = self.run(&["stash", "show", "--name-status", reference])?;
        Ok(parse::commit_files(&raw))
    }

    /// Per-file diff of a stash for the preview. A stash is a merge commit, so
    /// `git show` yields an unusable combined diff; diffing against the stash's
    /// first parent (the commit it was made on) gives a normal, parseable diff.
    pub fn stash_file_diff(
        &self,
        reference: &str,
        file: &str,
        ignore_whitespace: bool,
        whole: bool,
    ) -> Result<Option<DiffData>, String> {
        reject_option(reference)?;
        reject_unsafe_path(file)?;
        let base = format!("{reference}^");
        let mut args = vec!["diff", "--no-color", "--no-ext-diff", "--no-textconv"];
        if ignore_whitespace {
            args.push("-w");
        }
        if whole {
            args.push("--unified=100000");
        }
        args.push(&base);
        args.push(reference);
        args.push("--");
        args.push(file);
        let raw = self.run(&args)?;
        let Some(mut diff) = parse::diff(&raw) else {
            return Ok(None);
        };
        diff.old_content = self.content(&format!("{reference}^:{file}"));
        diff.new_content = self.content(&format!("{reference}:{file}"));
        Ok(Some(diff))
    }

    pub fn fetch(&self) -> Result<String, String> {
        self.run(&["fetch", "--all", "--prune"])
    }

    /// Pull with an explicit reconcile strategy so git never aborts with "Need
    /// to specify how to reconcile divergent branches" (which it does for a bare
    /// `git pull` on diverged branches when the user has no pull.rebase/pull.ff
    /// config): `merge` → `--no-rebase`, `rebase` → `--rebase`, `ff-only` →
    /// `--ff-only`. An unknown value falls back to merge.
    pub fn pull(&self, strategy: &str) -> Result<String, String> {
        let flag = match strategy {
            "rebase" => "--rebase",
            "ff-only" => "--ff-only",
            _ => "--no-rebase",
        };
        self.run(&["pull", flag])
    }

    /// Resolve a conflicted file: take `ours`/`theirs` then stage it, or just
    /// stage a manually-resolved file (`mark`).
    pub fn resolve_conflict(&self, file: &str, side: &str) -> Result<(), String> {
        reject_unsafe_path(file)?;
        match side {
            "ours" => {
                self.run(&["checkout", "--ours", "--", file])?;
            }
            "theirs" => {
                self.run(&["checkout", "--theirs", "--", file])?;
            }
            _ => {}
        }
        self.run(&["add", "--", file]).map(|_| ())
    }

    /// Push the current branch. `set_upstream` publishes a new branch and
    /// records its upstream (`-u origin HEAD`); `force` uses the safe
    /// `--force-with-lease` (never the unconditional `--force`).
    pub fn push(&self, set_upstream: bool, force: bool) -> Result<String, String> {
        let mut args = vec!["push"];
        if force {
            args.push("--force-with-lease");
        }
        if set_upstream {
            args.extend(["--set-upstream", "origin", "HEAD"]);
        }
        self.run(&args)
    }

    /// Read a git config value (`git config [--global] --get <key>`). git reports
    /// an unset key with exit code 1; map that to an empty string so "not
    /// configured" is a normal result rather than an error.
    pub fn config_get(&self, key: &str, global: bool) -> Result<String, String> {
        reject_option(key)?;
        let mut args = vec!["config"];
        if global {
            args.push("--global");
        }
        args.push("--get");
        args.push(key);
        let output = self.target.command(&args).output().map_err(|e| {
            format!(
                "failed to run git: {e}\n\n$ {}",
                self.target.describe(&args)
            )
        })?;
        match output.status.code() {
            Some(0) => Ok(String::from_utf8_lossy(&output.stdout).trim().to_string()),
            Some(1) => Ok(String::new()),
            _ => Err(format!(
                "{}\n\n$ {}",
                String::from_utf8_lossy(&output.stderr).trim(),
                self.target.describe(&args)
            )),
        }
    }

    /// Write a git config value (`git config [--global] <key> <value>`). `value`
    /// runs through the same option-injection guard as a ref (no leading `-`, no
    /// control characters) while still allowing the spaces and `@`/`.` a name or
    /// email needs.
    pub fn config_set(&self, key: &str, value: &str, global: bool) -> Result<(), String> {
        reject_option(key)?;
        reject_option(value)?;
        let mut args = vec!["config"];
        if global {
            args.push("--global");
        }
        args.push(key);
        args.push(value);
        self.run(&args).map(|_| ())
    }

    /// Clone `url` into `parent` (an existing directory), returning the host path
    /// of the freshly created repo so the caller can open it. Routed through
    /// `parent`, so a `\\wsl$` parent clones inside the distro.
    pub fn clone_repo(&self, url: &str, parent: &str) -> Result<String, String> {
        reject_option(url)?;
        self.run(&["clone", "--", url])?;
        let name = clone_dir_name(url);
        let name = if name.is_empty() { "repo" } else { name };
        // `parse_wsl_path` normalises separators, so a `/` join round-trips for
        // both native and `\\wsl$` parents.
        Ok(format!("{}/{}", parent.trim_end_matches(['/', '\\']), name))
    }

    /// Initialise a new repository in this directory (which must exist), with an
    /// optional initial branch name. Returns the canonical toplevel host path.
    pub fn init_repo(&self, branch: Option<&str>) -> Result<String, String> {
        let mut args = vec!["init"];
        if let Some(b) = branch {
            reject_option(b)?;
            args.push("-b");
            args.push(b);
        }
        self.run(&args)?;
        let top = self.run(&["rev-parse", "--show-toplevel"])?;
        Ok(self.target.host_path(top.trim()))
    }
}

/// Generates `app/types/bindings.ts` from the serde structs above so the
/// frontend imports one source-of-truth contract instead of re-declaring it.
/// Regenerate with `pnpm bindings` (runs this test, then formats the output).
#[cfg(test)]
#[test]
#[ignore = "writes app/types/bindings.ts; regenerate via `pnpm bindings`"]
fn export_bindings() {
    let decls = [
        Commit::decl(),
        Branch::decl(),
        ReflogEntry::decl(),
        Worktree::decl(),
        Submodule::decl(),
        SparseStatus::decl(),
        StashEntry::decl(),
        RepoInfo::decl(),
        DiffData::decl(),
        CommitFile::decl(),
        BlameLine::decl(),
        StatusEntry::decl(),
        RebaseStep::decl(),
        ImageDiff::decl(),
        Contributor::decl(),
        ActivityPoint::decl(),
        FileChurn::decl(),
        RepoStats::decl(),
    ];
    let body: String = decls.iter().map(|d| format!("export {d}\n\n")).collect();
    let file = format!(
        "// GENERATED from src-tauri/src/git.rs by `cargo test` (ts-rs).\n\
         // Do not edit — change the Rust structs and re-run.\n\n{body}"
    );
    std::fs::create_dir_all("../app/types").expect("create app/types");
    std::fs::write("../app/types/bindings.ts", file).expect("write bindings.ts");
}

#[cfg(test)]
mod validate_tests {
    use super::{build_partial_hunk, reject_option, reject_unsafe_hunk, reject_unsafe_path};

    // A hunk body indexed 0..=3: context, removal, addition, addition.
    const HUNK: &str = "@@ -1,3 +1,4 @@\n ctx\n-removed\n+added1\n+added2";

    #[test]
    fn build_partial_hunk_stages_only_selected_addition() {
        // Stage just `+added1` (body index 2): the unselected removal becomes
        // context (it stays in the index) and the unselected addition is dropped.
        let got = build_partial_hunk(HUNK, &[2], false);
        assert_eq!(got, "@@ -1,3 +1,4 @@\n ctx\n removed\n+added1\n");
        // The reduced hunk is still a structurally valid patch body.
        assert!(reject_unsafe_hunk(got.trim_end()).is_ok());
    }

    #[test]
    fn build_partial_hunk_stages_only_selected_removal() {
        // Stage just the removal (index 1): both additions are dropped.
        let got = build_partial_hunk(HUNK, &[1], false);
        assert_eq!(got, "@@ -1,3 +1,4 @@\n ctx\n-removed\n");
    }

    #[test]
    fn build_partial_hunk_unstage_flips_the_roles() {
        // Unstaging `+added1` (reverse): the unselected addition is demoted to
        // context (stays staged) and the unselected removal is dropped.
        let got = build_partial_hunk(HUNK, &[2], true);
        assert_eq!(got, "@@ -1,3 +1,4 @@\n ctx\n+added1\n added2\n");
    }

    #[test]
    fn build_partial_hunk_keeps_no_newline_marker() {
        let hunk = "@@ -1 +1 @@\n-old\n+new\n\\ No newline at end of file";
        // Stage the addition (index 1); the no-newline marker is preserved.
        let got = build_partial_hunk(hunk, &[1], false);
        assert_eq!(
            got,
            "@@ -1 +1 @@\n old\n+new\n\\ No newline at end of file\n"
        );
    }

    #[test]
    fn build_partial_hunk_empty_selection_drops_all_changes() {
        // Nothing selected → only context survives (caller rejects this upfront).
        let got = build_partial_hunk(HUNK, &[], false);
        assert_eq!(got, "@@ -1,3 +1,4 @@\n ctx\n removed\n");
    }

    #[test]
    fn aggregate_stats_counts_and_sorts() {
        use super::aggregate_stats;
        let us = '\u{1f}';
        let raw = format!(
            "Ann{us}a@x{us}2024-01-02\n\
             Bob{us}b@x{us}2024-01-02\n\
             Ann{us}a@x{us}2024-01-01\n\
             Ann{us}a@x{us}2024-01-02\n"
        );
        let (total, contributors, activity) = aggregate_stats(&raw);
        assert_eq!(total, 4);
        assert_eq!(contributors[0].name, "Ann");
        assert_eq!(contributors[0].commits, 3);
        assert_eq!(contributors[1].commits, 1);
        // activity is ascending by date, counted per day
        assert_eq!(activity[0].date, "2024-01-01");
        assert_eq!(activity[1].date, "2024-01-02");
        assert_eq!(activity[1].count, 3);
    }

    #[test]
    fn aggregate_churn_ranks_top_files() {
        use super::aggregate_churn;
        let raw = "a.rs\nb.rs\n\na.rs\n\na.rs\nb.rs\n";
        let churn = aggregate_churn(raw, 1);
        assert_eq!(churn.len(), 1);
        assert_eq!(churn[0].path, "a.rs");
        assert_eq!(churn[0].changes, 3);
    }

    #[test]
    fn base64_encode_matches_known_vectors() {
        use super::base64_encode;
        assert_eq!(base64_encode(b""), "");
        assert_eq!(base64_encode(b"f"), "Zg==");
        assert_eq!(base64_encode(b"fo"), "Zm8=");
        assert_eq!(base64_encode(b"foo"), "Zm9v");
        assert_eq!(base64_encode(b"foob"), "Zm9vYg==");
        assert_eq!(base64_encode(b"foobar"), "Zm9vYmFy");
    }

    #[test]
    fn lfs_from_check_attr_collects_only_lfs_filtered_paths() {
        use super::lfs_from_check_attr;
        // Triplets: big.bin is LFS, notes.txt is filtered but not lfs, and
        // plain.rs has no filter — only the first should be collected.
        let out = "big.bin\u{0}filter\u{0}lfs\u{0}\
                   notes.txt\u{0}filter\u{0}clean\u{0}\
                   plain.rs\u{0}filter\u{0}unspecified\u{0}";
        let set = lfs_from_check_attr(out);
        assert_eq!(set.len(), 1);
        assert!(set.contains("big.bin"));
        assert!(lfs_from_check_attr("").is_empty());
    }

    #[test]
    fn build_rebase_todo_maps_actions_and_amend_execs() {
        use super::{build_rebase_todo, RebaseStep};
        let step = |action: &str, hash: &str, message: Option<&str>| RebaseStep {
            action: action.to_string(),
            hash: hash.to_string(),
            message: message.map(str::to_string),
        };
        let steps = [
            step("pick", "aaa", None),
            step("reword", "bbb", Some("new subject")),
            step("squash", "ccc", Some("merged")),
            step("fixup", "ddd", None),
            step("drop", "eee", None),
        ];
        let (todo, msgs) = build_rebase_todo(&steps, "/g/.git/m-");
        assert_eq!(
            todo,
            "pick aaa\n\
             pick bbb\n\
             exec git commit --amend --file=\"/g/.git/m-1\"\n\
             squash ccc\n\
             exec git commit --amend --file=\"/g/.git/m-2\"\n\
             fixup ddd\n\
             drop eee\n"
        );
        assert_eq!(
            msgs,
            vec![
                ("/g/.git/m-1".to_string(), "new subject".to_string()),
                ("/g/.git/m-2".to_string(), "merged".to_string()),
            ]
        );
    }

    #[test]
    fn reject_unsafe_hunk_blocks_smuggled_file_section() {
        // A normal hunk (header + context/add/remove/no-newline lines) is fine.
        let ok = "@@ -1,2 +1,2 @@\n context\n-old\n+new\n\\ No newline at end of file";
        assert!(reject_unsafe_hunk(ok).is_ok());
        // Removed/added lines that merely *look* like diff headers stay valid
        // (they carry the -/+ prefix, so git treats them as content).
        let tricky = "@@ -1 +1 @@\n--- a/keep\n+++ b/keep";
        assert!(reject_unsafe_hunk(tricky).is_ok());
        // A smuggled second file section (bare `diff --git`, `index`, `new file`)
        // is rejected — those lines lack a hunk prefix.
        for bad in [
            "@@ -1 +1 @@\n-old\n+new\ndiff --git a/other b/other\n--- a/other\n+++ b/other\n@@ -1 +1 @@\n-x\n+PWNED",
            "@@ -1 +1 @@\n+x\nindex 0000..1111 100644",
            "@@ -1 +1 @@\n+x\nnew file mode 100644",
        ] {
            assert!(reject_unsafe_hunk(bad).is_err(), "should reject {bad:?}");
        }
    }

    #[test]
    fn reject_option_blocks_leading_dash_and_control() {
        // Option-injection vectors and empties are rejected.
        for bad in ["-D", "--upload-pack=x", "-", "", "a\nb", "x\u{1b}y"] {
            assert!(reject_option(bad).is_err(), "should reject {bad:?}");
        }
        // Ordinary refs/hashes/remote names pass — including ones with `/`, `~`,
        // `@`, `{}` that are valid in real ref/rev syntax.
        for ok in [
            "main",
            "origin/main",
            "feature/x",
            "HEAD~3",
            "stash@{0}",
            "v1.2.3",
            "0a1b2c3d",
        ] {
            assert!(reject_option(ok).is_ok(), "should allow {ok:?}");
        }
    }

    #[test]
    fn reject_unsafe_path_blocks_traversal_and_injection() {
        for bad in [
            "/etc/passwd",
            "C:\\Windows\\win.ini",
            "../secret",
            "a/../../b",
            "x\n+++ b/evil",
            "x\rrest",
            "",
        ] {
            assert!(reject_unsafe_path(bad).is_err(), "should reject {bad:?}");
        }
        // Normal repo-relative paths pass.
        for ok in [
            "src/main.rs",
            "a/b/c.txt",
            "file with spaces.md",
            "-leading-dash.txt",
        ] {
            assert!(reject_unsafe_path(ok).is_ok(), "should allow {ok:?}");
        }
    }
}
