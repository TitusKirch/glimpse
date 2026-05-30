//! Thin wrappers over the system `git` binary. Output is parsed into
//! serde-serializable structs that mirror the frontend's Pinia store shapes.

use crate::platform::{self, GitTarget};
use serde::Serialize;

const US: char = '\u{1f}'; // unit separator, safe field delimiter

fn run(target: &GitTarget, args: &[&str]) -> Result<String, String> {
    let output = target
        .command(args)
        .output()
        .map_err(|e| format!("failed to run git: {e}"))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

fn lines(s: &str) -> impl Iterator<Item = &str> {
    s.lines().filter(|l| !l.trim().is_empty())
}

#[derive(Serialize)]
pub struct Commit {
    pub hash: String,
    pub subject: String,
    pub author: String,
    pub date: String,
    pub refs: Vec<String>,
    pub parents: Vec<String>,
    pub lane: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoInfo {
    pub toplevel: String,
    pub current_branch: String,
    pub branches: Vec<String>,
    pub remotes: Vec<String>,
    pub tags: Vec<String>,
    pub flavor: String,
    pub distro: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffData {
    pub file_name: String,
    pub old_content: String,
    pub new_content: String,
    pub hunks: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitFile {
    pub path: String,
    /// Single-letter change status: M, A, D, R, C.
    pub status: String,
}

#[derive(Serialize)]
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
}

pub fn repo_info(repo_path: &str) -> Result<RepoInfo, String> {
    let t = platform::resolve(repo_path);
    let toplevel = run(&t, &["rev-parse", "--show-toplevel"])?
        .trim()
        .to_string();
    let current_branch = run(&t, &["rev-parse", "--abbrev-ref", "HEAD"])?
        .trim()
        .to_string();
    let branches = lines(&run(
        &t,
        &["for-each-ref", "--format=%(refname:short)", "refs/heads"],
    )?)
    .map(str::to_string)
    .collect();
    let remotes = lines(&run(&t, &["remote"])?).map(str::to_string).collect();
    let tags = lines(&run(&t, &["tag", "--sort=-creatordate"])?)
        .take(50)
        .map(str::to_string)
        .collect();

    Ok(RepoInfo {
        toplevel,
        current_branch,
        branches,
        remotes,
        tags,
        flavor: t.flavor.to_string(),
        distro: t.distro.clone(),
    })
}

pub fn git_log(repo_path: &str, limit: u32) -> Result<Vec<Commit>, String> {
    let t = platform::resolve(repo_path);
    let fmt = format!("--pretty=format:%H{US}%P{US}%an{US}%ad{US}%D{US}%s");
    let n = format!("-n{limit}");
    let out = run(&t, &["log", "--date=short", &fmt, &n])?;

    let mut commits: Vec<Commit> = out
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
    Ok(commits)
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

pub fn git_status(repo_path: &str) -> Result<Vec<StatusEntry>, String> {
    let t = platform::resolve(repo_path);
    let raw = run(
        &t,
        &["status", "--porcelain=v1", "--untracked-files=all", "-z"],
    )?;

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
    Ok(entries)
}

/// Full content of a git object (`git show <spec>`); empty on error (e.g. the
/// file did not exist on that side of the diff).
fn content(t: &GitTarget, spec: &str) -> String {
    run(t, &["show", spec]).unwrap_or_default()
}

/// Diff of a single file, either the staged version or the working-tree change.
/// Both file contents are included so the diff viewer can render full context.
pub fn file_diff(repo_path: &str, file: &str, staged: bool) -> Result<Option<DiffData>, String> {
    let t = platform::resolve(repo_path);
    let mut args = vec!["diff", "--no-color"];
    if staged {
        args.push("--staged");
    }
    args.push("--");
    args.push(file);
    let mut raw = run(&t, &args)?;

    // Untracked files have no diff target; diff against the null device so the
    // whole file shows up as additions.
    if raw.trim().is_empty() && !staged {
        let null = t.null_device();
        raw = run(&t, &["diff", "--no-color", "--no-index", null, file]).unwrap_or_default();
    }

    let Some(mut diff) = parse_first_file(&raw) else {
        return Ok(None);
    };
    if staged {
        diff.old_content = content(&t, &format!("HEAD:{file}"));
        diff.new_content = content(&t, &format!(":{file}"));
    } else {
        diff.old_content = content(&t, &format!(":{file}"));
        diff.new_content = t.read_file(file).unwrap_or_default();
    }
    Ok(Some(diff))
}

/// List of files changed by a commit (path + single-letter status).
pub fn commit_files(repo_path: &str, hash: &str) -> Result<Vec<CommitFile>, String> {
    let t = platform::resolve(repo_path);
    let raw = run(&t, &["show", "--name-status", "--format=", hash])?;
    let files = lines(&raw)
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
        .collect();
    Ok(files)
}

/// Diff of a single file as introduced by a commit, with both file contents.
pub fn commit_file_diff(
    repo_path: &str,
    hash: &str,
    file: &str,
) -> Result<Option<DiffData>, String> {
    let t = platform::resolve(repo_path);
    let raw = run(&t, &["show", "--no-color", "--format=", hash, "--", file])?;
    let Some(mut diff) = parse_first_file(&raw) else {
        return Ok(None);
    };
    diff.old_content = content(&t, &format!("{hash}^:{file}"));
    diff.new_content = content(&t, &format!("{hash}:{file}"));
    Ok(Some(diff))
}

pub fn stage(repo_path: &str, file: &str) -> Result<(), String> {
    let t = platform::resolve(repo_path);
    run(&t, &["add", "--", file]).map(|_| ())
}

pub fn unstage(repo_path: &str, file: &str) -> Result<(), String> {
    let t = platform::resolve(repo_path);
    run(&t, &["restore", "--staged", "--", file]).map(|_| ())
}

pub fn commit(repo_path: &str, message: &str) -> Result<String, String> {
    let t = platform::resolve(repo_path);
    run(&t, &["commit", "-m", message])
}

/// Discard a file's working-tree changes. Untracked files are deleted (`clean`);
/// tracked files are reverted to HEAD (`restore`).
pub fn discard(repo_path: &str, file: &str, untracked: bool) -> Result<(), String> {
    let t = platform::resolve(repo_path);
    if untracked {
        run(&t, &["clean", "-f", "--", file]).map(|_| ())
    } else {
        run(&t, &["restore", "--", file]).map(|_| ())
    }
}

pub fn checkout_branch(repo_path: &str, branch: &str) -> Result<(), String> {
    let t = platform::resolve(repo_path);
    run(&t, &["switch", branch]).map(|_| ())
}

pub fn create_branch(repo_path: &str, name: &str) -> Result<(), String> {
    let t = platform::resolve(repo_path);
    run(&t, &["switch", "-c", name]).map(|_| ())
}

pub fn delete_branch(repo_path: &str, name: &str) -> Result<(), String> {
    let t = platform::resolve(repo_path);
    run(&t, &["branch", "-d", name]).map(|_| ())
}

pub fn fetch(repo_path: &str) -> Result<String, String> {
    let t = platform::resolve(repo_path);
    run(&t, &["fetch", "--all", "--prune"])
}

pub fn pull(repo_path: &str) -> Result<String, String> {
    let t = platform::resolve(repo_path);
    run(&t, &["pull"])
}

pub fn push(repo_path: &str) -> Result<String, String> {
    let t = platform::resolve(repo_path);
    run(&t, &["push"])
}

/// Pull the first file's hunks out of a unified-diff blob.
fn parse_first_file(diff: &str) -> Option<DiffData> {
    let mut file_name: Option<String> = None;
    let mut hunks: Vec<String> = Vec::new();
    let mut cur: Option<String> = None;

    for line in diff.lines() {
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
