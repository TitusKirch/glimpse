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

#[derive(Serialize, TS)]
pub struct Commit {
    pub hash: String,
    pub subject: String,
    pub author: String,
    pub date: String,
    pub refs: Vec<String>,
    pub parents: Vec<String>,
    pub lane: u32,
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
        let current_branch = self
            .run(&["rev-parse", "--abbrev-ref", "HEAD"])?
            .trim()
            .to_string();
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

        Ok(RepoInfo {
            toplevel,
            current_branch,
            branches,
            remote_branches,
            remotes,
            tags,
            stashes,
            flavor: self.target.flavor.to_string(),
            distro: self.target.distro.clone(),
        })
    }

    pub fn log(&self, limit: u32) -> Result<Vec<Commit>, String> {
        let fmt = format!("--pretty=format:%H{US}%P{US}%an{US}%ad{US}%D{US}%s");
        let n = format!("-n{limit}");
        // `--all` so every branch/remote/tag tip shows as its own parallel lane;
        // `--topo-order` keeps a branch's commits contiguous for a clean graph.
        let out = self.run(&["log", "--all", "--topo-order", "--date=short", &fmt, &n])?;
        Ok(parse::log(&out))
    }

    pub fn status(&self) -> Result<Vec<StatusEntry>, String> {
        let raw = self.run(&["status", "--porcelain=v1", "--untracked-files=all", "-z"])?;
        Ok(parse::status(&raw))
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
        let mut args = vec!["diff", "--no-color"];
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
            raw = self.run_diff(&["diff", "--no-color", "--no-index", null, file]);
        }

        let Some(mut diff) = parse::diff(&raw) else {
            return Ok(None);
        };
        if staged {
            diff.old_content = self.content(&format!("HEAD:{file}"));
            diff.new_content = self.content(&format!(":{file}"));
        } else {
            diff.old_content = self.content(&format!(":{file}"));
            diff.new_content = self.target.read_file(file).unwrap_or_default();
        }
        Ok(Some(diff))
    }

    /// Full commit message (subject + body) for the detail panel.
    pub fn commit_body(&self, hash: &str) -> Result<String, String> {
        Ok(self
            .run(&["show", "-s", "--format=%B", hash])?
            .trim()
            .to_string())
    }

    /// List of files changed by a commit (path + single-letter status).
    pub fn commit_files(&self, hash: &str) -> Result<Vec<CommitFile>, String> {
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
        let mut args = vec!["show", "--no-color", "--format="];
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
        self.run(&["add", "--", file]).map(|_| ())
    }

    pub fn unstage(&self, file: &str) -> Result<(), String> {
        self.run(&["restore", "--staged", "--", file]).map(|_| ())
    }

    /// Stage (or, with `reverse`, unstage) a single hunk by piping a minimal
    /// one-file patch into `git apply --cached`. `--recount` lets git fix the
    /// `@@` line counts, so the rendered hunk text doesn't need to be exact.
    pub fn apply_hunk(&self, file: &str, hunk: &str, reverse: bool) -> Result<(), String> {
        let patch = format!("diff --git a/{file} b/{file}\n--- a/{file}\n+++ b/{file}\n{hunk}\n");
        let mut args = vec!["apply", "--cached", "--recount", "--whitespace=nowarn"];
        if reverse {
            args.push("--reverse");
        }
        self.run_stdin(&args, &patch).map(|_| ())
    }

    /// Commits that touched a file, following renames (`git log --follow`).
    pub fn file_history(&self, file: &str) -> Result<Vec<Commit>, String> {
        let fmt = format!("--pretty=format:%H{US}%P{US}%an{US}%ad{US}%D{US}%s");
        let out = self.run(&["log", "--follow", "--date=short", &fmt, "--", file])?;
        Ok(parse::log(&out))
    }

    /// Per-line authorship for a file (`git blame --porcelain`).
    pub fn blame(&self, file: &str) -> Result<Vec<BlameLine>, String> {
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
        if untracked {
            self.run(&["clean", "-f", "--", file]).map(|_| ())
        } else {
            self.run(&["restore", "--", file]).map(|_| ())
        }
    }

    pub fn checkout_branch(&self, branch: &str) -> Result<(), String> {
        self.run(&["switch", branch]).map(|_| ())
    }

    /// Merge `branch` into the current branch (no editor). Conflicts surface in
    /// the status as unmerged entries, handled by the conflicts UI.
    pub fn merge(&self, branch: &str) -> Result<String, String> {
        // `--no-ff` always records a merge commit, so a merged branch keeps its
        // own lane + merge point in the graph instead of being fast-forwarded
        // into a straight line (which erases the branch topology).
        self.run(&["merge", "--no-ff", "--no-edit", branch])
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
        self.run(&["checkout", hash]).map(|_| ())
    }

    pub fn create_branch(&self, name: &str) -> Result<(), String> {
        self.run(&["switch", "-c", name]).map(|_| ())
    }

    /// Create a branch at a specific commit and switch to it ("branch here").
    pub fn create_branch_at(&self, name: &str, hash: &str) -> Result<(), String> {
        self.run(&["switch", "-c", name, hash]).map(|_| ())
    }

    pub fn delete_branch(&self, name: &str) -> Result<(), String> {
        self.run(&["branch", "-d", name]).map(|_| ())
    }

    /// Revert a commit (creates a new inverse commit, no editor).
    pub fn revert(&self, hash: &str) -> Result<(), String> {
        self.run(&["revert", "--no-edit", hash]).map(|_| ())
    }

    /// Cherry-pick a commit onto the current branch.
    pub fn cherry_pick(&self, hash: &str) -> Result<(), String> {
        self.run(&["cherry-pick", hash]).map(|_| ())
    }

    /// Move the current branch to `hash`. A hard reset discards working-tree
    /// changes — the UI confirms first.
    pub fn reset(&self, hash: &str, mode: ResetMode) -> Result<(), String> {
        let flag = match mode {
            ResetMode::Soft => "--soft",
            ResetMode::Mixed => "--mixed",
            ResetMode::Hard => "--hard",
        };
        self.run(&["reset", flag, hash]).map(|_| ())
    }

    pub fn rename_branch(&self, old: &str, new: &str) -> Result<(), String> {
        self.run(&["branch", "-m", old, new]).map(|_| ())
    }

    /// Set a branch's upstream to `<remote>/<branch>` (so pull/push track it).
    pub fn set_upstream(&self, remote: &str, branch: &str) -> Result<(), String> {
        let target = format!("--set-upstream-to={remote}/{branch}");
        self.run(&["branch", &target, branch]).map(|_| ())
    }

    /// Create a lightweight tag at `hash` (or HEAD when `hash` is empty).
    pub fn create_tag(&self, name: &str, hash: &str) -> Result<(), String> {
        if hash.is_empty() {
            self.run(&["tag", name]).map(|_| ())
        } else {
            self.run(&["tag", name, hash]).map(|_| ())
        }
    }

    pub fn delete_tag(&self, name: &str) -> Result<(), String> {
        self.run(&["tag", "-d", name]).map(|_| ())
    }

    /// Push all local tags to the default remote.
    pub fn push_tags(&self) -> Result<String, String> {
        self.run(&["push", "--tags"])
    }

    pub fn add_remote(&self, name: &str, url: &str) -> Result<(), String> {
        self.run(&["remote", "add", name, url]).map(|_| ())
    }

    pub fn remove_remote(&self, name: &str) -> Result<(), String> {
        self.run(&["remote", "remove", name]).map(|_| ())
    }

    pub fn rename_remote(&self, old: &str, new: &str) -> Result<(), String> {
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

    /// Stash the working tree (optionally with a message).
    pub fn stash_save(&self, message: &str) -> Result<(), String> {
        if message.is_empty() {
            self.run(&["stash", "push"]).map(|_| ())
        } else {
            self.run(&["stash", "push", "-m", message]).map(|_| ())
        }
    }

    pub fn stash_pop(&self, reference: &str) -> Result<(), String> {
        self.run(&["stash", "pop", reference]).map(|_| ())
    }

    pub fn stash_apply(&self, reference: &str) -> Result<(), String> {
        self.run(&["stash", "apply", reference]).map(|_| ())
    }

    pub fn stash_drop(&self, reference: &str) -> Result<(), String> {
        self.run(&["stash", "drop", reference]).map(|_| ())
    }

    pub fn fetch(&self) -> Result<String, String> {
        self.run(&["fetch", "--all", "--prune"])
    }

    pub fn pull(&self, rebase: bool) -> Result<String, String> {
        if rebase {
            self.run(&["pull", "--rebase"])
        } else {
            self.run(&["pull"])
        }
    }

    /// Resolve a conflicted file: take `ours`/`theirs` then stage it, or just
    /// stage a manually-resolved file (`mark`).
    pub fn resolve_conflict(&self, file: &str, side: &str) -> Result<(), String> {
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
        StashEntry::decl(),
        RepoInfo::decl(),
        DiffData::decl(),
        CommitFile::decl(),
        BlameLine::decl(),
        StatusEntry::decl(),
    ];
    let body: String = decls.iter().map(|d| format!("export {d}\n\n")).collect();
    let file = format!(
        "// GENERATED from src-tauri/src/git.rs by `cargo test` (ts-rs).\n\
         // Do not edit — change the Rust structs and re-run.\n\n{body}"
    );
    std::fs::create_dir_all("../app/types").expect("create app/types");
    std::fs::write("../app/types/bindings.ts", file).expect("write bindings.ts");
}
