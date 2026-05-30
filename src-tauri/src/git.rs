//! Git engine. A [`Repo`] is a resolved repository: the platform decision
//! (native git vs. WSL git) is made once in [`Repo::open`], then every git
//! operation is a method on the handle. Output is decoded by the pure
//! [`parse`] module into serde structs that mirror the frontend's store shapes.

use crate::platform::{self, GitTarget};
use serde::Serialize;
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
pub struct RepoInfo {
    pub toplevel: String,
    pub current_branch: String,
    pub branches: Vec<String>,
    pub remotes: Vec<String>,
    pub tags: Vec<String>,
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
        let output = self
            .target
            .command(args)
            .output()
            .map_err(|e| format!("failed to run git: {e}"))?;
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
        let toplevel = self
            .run(&["rev-parse", "--show-toplevel"])?
            .trim()
            .to_string();
        let current_branch = self
            .run(&["rev-parse", "--abbrev-ref", "HEAD"])?
            .trim()
            .to_string();
        let branches =
            lines(&self.run(&["for-each-ref", "--format=%(refname:short)", "refs/heads"])?)
                .map(str::to_string)
                .collect();
        let remotes = lines(&self.run(&["remote"])?).map(str::to_string).collect();
        let tags = lines(&self.run(&["tag", "--sort=-creatordate"])?)
            .take(50)
            .map(str::to_string)
            .collect();

        Ok(RepoInfo {
            toplevel,
            current_branch,
            branches,
            remotes,
            tags,
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
    pub fn file_diff(&self, file: &str, staged: bool) -> Result<Option<DiffData>, String> {
        let mut args = vec!["diff", "--no-color"];
        if staged {
            args.push("--staged");
        }
        args.push("--");
        args.push(file);
        let mut raw = self.run(&args)?;

        // Untracked files have no diff target; diff against the null device so
        // the whole file shows up as additions.
        if raw.trim().is_empty() && !staged {
            let null = self.target.null_device();
            raw = self
                .run(&["diff", "--no-color", "--no-index", null, file])
                .unwrap_or_default();
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

    /// List of files changed by a commit (path + single-letter status).
    pub fn commit_files(&self, hash: &str) -> Result<Vec<CommitFile>, String> {
        let raw = self.run(&["show", "--name-status", "--format=", hash])?;
        Ok(parse::commit_files(&raw))
    }

    /// Diff of a single file as introduced by a commit, with both contents.
    pub fn commit_file_diff(&self, hash: &str, file: &str) -> Result<Option<DiffData>, String> {
        let raw = self.run(&["show", "--no-color", "--format=", hash, "--", file])?;
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

    pub fn commit(&self, message: &str) -> Result<String, String> {
        self.run(&["commit", "-m", message])
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

    pub fn create_branch(&self, name: &str) -> Result<(), String> {
        self.run(&["switch", "-c", name]).map(|_| ())
    }

    pub fn delete_branch(&self, name: &str) -> Result<(), String> {
        self.run(&["branch", "-d", name]).map(|_| ())
    }

    pub fn fetch(&self) -> Result<String, String> {
        self.run(&["fetch", "--all", "--prune"])
    }

    pub fn pull(&self) -> Result<String, String> {
        self.run(&["pull"])
    }

    pub fn push(&self) -> Result<String, String> {
        self.run(&["push"])
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
        RepoInfo::decl(),
        DiffData::decl(),
        CommitFile::decl(),
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
