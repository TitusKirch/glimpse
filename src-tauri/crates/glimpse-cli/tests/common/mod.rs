//! Shared fixtures for the CLI's integration tests.
//!
//! Both suites drive the same entry point — [`glimpse_cli::run`] — against a
//! real repository built with the real `git` binary, because the engine under
//! test shells out to it and a fake would only prove the fake.

// Each suite uses a subset of these; unused *there* is not unused.
#![allow(dead_code)]

use std::path::{Path, PathBuf};
use std::process::Command;

/// Run `git -C <dir> <args>` with a hermetic, signing-free identity so the test
/// never depends on (or mutates) the developer's global config.
pub fn git(dir: &Path, args: &[&str]) {
    let status = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(args)
        .status()
        .expect("run git");
    assert!(status.success(), "git {args:?} failed");
}

/// `git -C <dir> <args>`, returning stdout — for asserting on repository state
/// with git itself rather than through the code under test.
pub fn git_out(dir: &Path, args: &[&str]) -> String {
    let out = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(args)
        .output()
        .expect("run git");
    String::from_utf8(out.stdout).expect("git output is utf-8")
}

/// A per-test scratch repository: one commit, one modified file, one untracked
/// file. Removed before and after so reruns start clean.
pub fn scratch_repo(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("glimpse-cli-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("create temp repo");

    git(&dir, &["init", "-q", "-b", "main"]);
    git(&dir, &["config", "user.email", "test@example.com"]);
    git(&dir, &["config", "user.name", "Test"]);
    git(&dir, &["config", "commit.gpgsign", "false"]);

    std::fs::write(dir.join("a.txt"), "a1\n").unwrap();
    git(&dir, &["add", "-A"]);
    git(&dir, &["commit", "-q", "-m", "initial commit"]);

    std::fs::write(dir.join("a.txt"), "a2\n").unwrap();
    std::fs::write(dir.join("b.txt"), "b1\n").unwrap();
    dir
}

/// A scratch repository stopped mid-merge with one unresolved conflict in
/// `a.txt` (`UU`), plus a clean tracked `z.txt` to act as the innocent
/// bystander in a batch. The state a user is in when they reach for `commit`
/// and get told nothing is staged.
pub fn merged_with_conflict(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("glimpse-cli-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("create temp repo");

    git(&dir, &["init", "-q", "-b", "main"]);
    git(&dir, &["config", "user.email", "test@example.com"]);
    git(&dir, &["config", "user.name", "Test"]);
    git(&dir, &["config", "commit.gpgsign", "false"]);

    std::fs::write(dir.join("a.txt"), "base\n").unwrap();
    std::fs::write(dir.join("z.txt"), "z1\n").unwrap();
    git(&dir, &["add", "-A"]);
    git(&dir, &["commit", "-q", "-m", "initial commit"]);

    git(&dir, &["switch", "-q", "-c", "other"]);
    std::fs::write(dir.join("a.txt"), "theirs\n").unwrap();
    git(&dir, &["commit", "-q", "-am", "theirs"]);

    git(&dir, &["switch", "-q", "main"]);
    std::fs::write(dir.join("a.txt"), "ours\n").unwrap();
    git(&dir, &["commit", "-q", "-am", "ours"]);

    // Expected to fail — that failure IS the fixture.
    let _ = Command::new("git")
        .arg("-C")
        .arg(&dir)
        .args(["merge", "other"])
        .output()
        .expect("run git");
    dir
}

pub fn argv(parts: &[&str]) -> Vec<String> {
    parts.iter().map(|s| s.to_string()).collect()
}

/// Run the CLI with both streams captured: `(exit code, stdout, stderr)`.
pub fn run(parts: &[&str]) -> (i32, String, String) {
    let mut out: Vec<u8> = Vec::new();
    let mut err: Vec<u8> = Vec::new();
    let code = glimpse_cli::run(&argv(parts), &mut out, &mut err);
    (
        code,
        String::from_utf8(out).expect("stdout is utf-8"),
        String::from_utf8(err).expect("stderr is utf-8"),
    )
}

/// A scratch repository stopped mid-`cherry-pick` or mid-`revert` on a conflict
/// in `a.txt` — the two in-progress states that are the same shape as a stopped
/// merge, and that leave `CHERRY_PICK_HEAD` / `REVERT_HEAD` behind rather than
/// `MERGE_HEAD`.
pub fn stopped_mid(tag: &str, op: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("glimpse-cli-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("create temp repo");

    git(&dir, &["init", "-q", "-b", "main"]);
    git(&dir, &["config", "user.email", "test@example.com"]);
    git(&dir, &["config", "user.name", "Test"]);
    git(&dir, &["config", "commit.gpgsign", "false"]);

    std::fs::write(dir.join("a.txt"), "base\n").unwrap();
    git(&dir, &["add", "-A"]);
    git(&dir, &["commit", "-q", "-m", "initial commit"]);

    let target = if op == "revert" {
        // Revert a commit whose change has since been overwritten: undoing it
        // no longer applies cleanly.
        std::fs::write(dir.join("a.txt"), "first\n").unwrap();
        git(&dir, &["commit", "-q", "-am", "first"]);
        let hash = Command::new("git")
            .arg("-C")
            .arg(&dir)
            .args(["rev-parse", "HEAD"])
            .output()
            .expect("run git");
        std::fs::write(dir.join("a.txt"), "second\n").unwrap();
        git(&dir, &["commit", "-q", "-am", "second"]);
        String::from_utf8(hash.stdout).unwrap().trim().to_string()
    } else {
        git(&dir, &["switch", "-q", "-c", "side"]);
        std::fs::write(dir.join("a.txt"), "theirs\n").unwrap();
        git(&dir, &["commit", "-q", "-am", "theirs"]);
        git(&dir, &["switch", "-q", "main"]);
        std::fs::write(dir.join("a.txt"), "ours\n").unwrap();
        git(&dir, &["commit", "-q", "-am", "ours"]);
        "side".to_string()
    };

    // Expected to fail — that failure IS the fixture.
    let _ = Command::new("git")
        .arg("-C")
        .arg(&dir)
        .args([op, "--no-edit", &target])
        .output()
        .expect("run git");
    dir
}

/// A per-test scratch repository with a **clean** working tree and two commits,
/// so a ref-level command has history to point at and nothing uncommitted to
/// get in its way. [`scratch_repo`] deliberately leaves the tree dirty, which
/// several of the refs and metadata commands would (rightly) refuse to run in.
pub fn clean_repo(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("glimpse-cli-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("create temp repo");

    git(&dir, &["init", "-q", "-b", "main"]);
    git(&dir, &["config", "user.email", "test@example.com"]);
    git(&dir, &["config", "user.name", "Test"]);
    git(&dir, &["config", "commit.gpgsign", "false"]);

    std::fs::write(dir.join("a.txt"), "a1\n").unwrap();
    git(&dir, &["add", "-A"]);
    git(&dir, &["commit", "-q", "-m", "first"]);
    std::fs::write(dir.join("a.txt"), "a2\n").unwrap();
    git(&dir, &["commit", "-q", "-am", "second"]);
    dir
}

/// A per-test scratch repository holding **one stash entry that cannot be
/// restored cleanly**: `a.txt` was stashed at `mine`, and HEAD has moved on to
/// `other` since, so the three-way merge a `pop` or an `apply` runs collides.
///
/// The state matters because it is the one where the two verbs stop being the
/// same command: git writes `CONFLICT` to **stdout** (so the engine's failure
/// carries no reason at all), the working tree and index have already moved,
/// and the entry is kept — by `apply` always, and by `pop` because it refuses
/// to drop what it could not fully restore.
pub fn stashed_over_a_conflict(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("glimpse-cli-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("create temp repo");

    git(&dir, &["init", "-q", "-b", "main"]);
    git(&dir, &["config", "user.email", "test@example.com"]);
    git(&dir, &["config", "user.name", "Test"]);
    git(&dir, &["config", "commit.gpgsign", "false"]);

    std::fs::write(dir.join("a.txt"), "base\n").unwrap();
    git(&dir, &["add", "-A"]);
    git(&dir, &["commit", "-q", "-m", "initial commit"]);

    std::fs::write(dir.join("a.txt"), "mine\n").unwrap();
    git(&dir, &["stash", "push", "-q", "-m", "mine"]);

    std::fs::write(dir.join("a.txt"), "other\n").unwrap();
    git(&dir, &["commit", "-q", "-am", "other"]);
    dir
}

/// The receipt a successful write leaves for a running window, or `None` when
/// the command wrote none. Read straight off disk, because "was a receipt
/// written?" is a question about the repository, not about the CLI's own view.
pub fn receipt(dir: &Path) -> Option<serde_json::Value> {
    let git_dir = git_out(dir, &["rev-parse", "--git-dir"]);
    let text = std::fs::read_to_string(dir.join(git_dir.trim()).join("glimpse/last-write.json"));
    Some(json_of(&text.ok()?))
}

pub fn json_of(text: &str) -> serde_json::Value {
    serde_json::from_str(text.trim()).unwrap_or_else(|e| panic!("not JSON ({e}): {text:?}"))
}

/// A working repository wired to a **local bare remote**, plus a second clone of
/// that same remote.
///
/// The network commands are the first slice whose subject lives outside the
/// repository, so the fixture has to be able to move the remote *behind the
/// repository's back* — that is the only way `fetch` has anything to find,
/// `pull` anything to bring down, and `--force-with-lease` anything to refuse.
/// [`Remoted::other`] is that second hand: commits pushed from there reach
/// `origin` without the repository under test ever hearing about it.
///
/// A bare repository on disk rather than a real host: the transport is git's
/// own either way, and a test that needs the network is a test that does not
/// run in CI, in a container, or on a train.
pub struct Remoted {
    /// The repository under test, with `origin` set and its branch published.
    pub dir: PathBuf,
    /// The bare repository both clones push to.
    pub origin: PathBuf,
    /// A second clone, for moving `origin` on without touching `dir`.
    pub other: PathBuf,
}

pub fn repo_with_remote(tag: &str) -> Remoted {
    let root = std::env::temp_dir().join(format!("glimpse-cli-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(&root).expect("create temp root");

    let origin = root.join("origin.git");
    let seed = root.join("seed");
    let dir = root.join("work");
    let other = root.join("other");

    let init = Command::new("git")
        .args(["init", "-q", "--bare", "-b", "main"])
        .arg(&origin)
        .status()
        .expect("run git");
    assert!(init.success(), "git init --bare failed");

    // Seeded with `init` + `remote add` rather than by cloning: cloning a bare
    // repository that has no commits yet is legal, but git warns about it on
    // every one, and a suite that prints sixteen warnings it expects trains the
    // reader to skim past the one it does not.
    std::fs::create_dir_all(&seed).expect("create seed");
    git(&seed, &["init", "-q", "-b", "main"]);
    git(&seed, &["config", "user.email", "test@example.com"]);
    git(&seed, &["config", "user.name", "Test"]);
    git(&seed, &["config", "commit.gpgsign", "false"]);
    git(
        &seed,
        &["remote", "add", "origin", &origin.to_string_lossy()],
    );
    std::fs::write(seed.join("a.txt"), "a1\n").unwrap();
    git(&seed, &["add", "-A"]);
    git(&seed, &["commit", "-q", "-m", "first"]);
    git(&seed, &["push", "-q", "--set-upstream", "origin", "main"]);

    clone(&origin, &dir);
    clone(&origin, &other);
    Remoted { dir, origin, other }
}

/// Clone `origin` into `dir` with the same hermetic identity every other
/// fixture uses, so a commit made in a clone never depends on the developer's
/// global config.
fn clone(origin: &Path, dir: &Path) {
    let status = Command::new("git")
        .args(["clone", "-q"])
        .arg(origin)
        .arg(dir)
        .status()
        .expect("run git");
    assert!(status.success(), "git clone failed");
    git(dir, &["config", "user.email", "test@example.com"]);
    git(dir, &["config", "user.name", "Test"]);
    git(dir, &["config", "commit.gpgsign", "false"]);
}

/// Commit `content` to `file` in `dir` and push it to `origin`. The one move the
/// network fixtures are built for: the remote gains a commit the repository
/// under test has never seen.
pub fn commit_and_push(dir: &Path, file: &str, content: &str, message: &str) {
    std::fs::write(dir.join(file), content).unwrap();
    git(dir, &["add", "-A"]);
    git(dir, &["commit", "-q", "-m", message]);
    git(dir, &["push", "-q"]);
}

/// Commit `content` to `file` in `dir` without pushing it.
pub fn commit_local(dir: &Path, file: &str, content: &str, message: &str) {
    std::fs::write(dir.join(file), content).unwrap();
    git(dir, &["add", "-A"]);
    git(dir, &["commit", "-q", "-m", message]);
}

/// A repository whose `side` branch cannot be rebased onto `main` without a
/// conflict: both changed `a.txt` away from the same base, and `side` is checked
/// out with a clean tree.
///
/// `z.txt` rides along untouched so a test can tell "the rebase stopped" from
/// "the rebase mangled the tree", and `side` carries **two** commits so `skip`
/// has something to drop and something to keep.
pub fn rebase_that_conflicts(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("glimpse-cli-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("create temp repo");

    git(&dir, &["init", "-q", "-b", "main"]);
    git(&dir, &["config", "user.email", "test@example.com"]);
    git(&dir, &["config", "user.name", "Test"]);
    git(&dir, &["config", "commit.gpgsign", "false"]);

    std::fs::write(dir.join("a.txt"), "base\n").unwrap();
    std::fs::write(dir.join("z.txt"), "z1\n").unwrap();
    git(&dir, &["add", "-A"]);
    git(&dir, &["commit", "-q", "-m", "initial commit"]);

    git(&dir, &["switch", "-q", "-c", "side"]);
    std::fs::write(dir.join("a.txt"), "side\n").unwrap();
    git(&dir, &["commit", "-q", "-am", "side touches a"]);
    std::fs::write(dir.join("z.txt"), "z2\n").unwrap();
    git(&dir, &["commit", "-q", "-am", "side touches z"]);

    git(&dir, &["switch", "-q", "main"]);
    std::fs::write(dir.join("a.txt"), "main\n").unwrap();
    git(&dir, &["commit", "-q", "-am", "main touches a"]);

    git(&dir, &["switch", "-q", "side"]);
    dir
}

/// A repository with a linear history of five commits on `main`, where `a.txt`
/// gains a line each time — the shape a bisect needs: a known-good root, a
/// known-bad tip and enough in between for the bisection to take a step.
pub fn bisectable(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("glimpse-cli-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("create temp repo");

    git(&dir, &["init", "-q", "-b", "main"]);
    git(&dir, &["config", "user.email", "test@example.com"]);
    git(&dir, &["config", "user.name", "Test"]);
    git(&dir, &["config", "commit.gpgsign", "false"]);

    for n in 1..=5 {
        std::fs::write(dir.join("a.txt"), format!("line {n}\n")).unwrap();
        git(&dir, &["add", "-A"]);
        git(&dir, &["commit", "-q", "-m", &format!("commit {n}")]);
    }
    dir
}

/// A scratch repository whose rebase is paused on a **`break`** — the sequencer
/// stopped between commits rather than *on* one, so git has set no
/// `REBASE_HEAD` at all.
///
/// The plan is fed through `sequence.editor=cp`, the same editor-free route
/// `Repo::interactive_rebase` uses in production, so the fixture reaches the
/// state the GUI's own rebase dialog can reach rather than a contrived one.
pub fn paused_on_break(tag: &str) -> PathBuf {
    let dir = clean_repo(tag);
    let head = git_out(&dir, &["rev-parse", "HEAD"]).trim().to_string();
    // Outside the repository on purpose: an untracked file in the working tree
    // would change what a `discard --all` test is looking at.
    let todo = std::env::temp_dir().join(format!("glimpse-cli-{tag}-todo-{}", std::process::id()));
    std::fs::write(&todo, format!("break\npick {head}\n")).unwrap();
    let editor = format!("sequence.editor=cp {}", todo.display());
    git(
        &dir,
        &[
            "-c",
            "core.editor=true",
            "-c",
            &editor,
            "rebase",
            "-i",
            "HEAD~1",
        ],
    );
    dir
}

/// A scratch repository whose rebase is paused on a **failed `exec`** — the
/// commits replayed cleanly and the command on the `exec` line exited non-zero,
/// which again leaves no `REBASE_HEAD` behind.
///
/// `--exec` needs no editor, and it is the shape `Repo::interactive_rebase`
/// writes for every reword: `exec … --amend --file=…`, a line that fails
/// whenever the amend does.
pub fn paused_on_failed_exec(tag: &str) -> PathBuf {
    let dir = clean_repo(tag);
    // Deliberately not `git()`: this rebase is *meant* to exit non-zero.
    let status = Command::new("git")
        .arg("-C")
        .arg(&dir)
        .args(["rebase", "--exec", "false", "HEAD~1"])
        .status()
        .expect("run git");
    assert!(!status.success(), "the exec was supposed to fail");
    dir
}

/// A scratch repository stopped mid-merge on a **modify/delete** conflict: the
/// other side deleted `a.txt`, this one changed it.
///
/// The conflict shape with no `theirs` content to check out at all, which is
/// what makes it the case `resolve --theirs` has to answer for rather than hand
/// git's own error to.
pub fn merged_over_a_deletion(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("glimpse-cli-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("create temp repo");

    git(&dir, &["init", "-q", "-b", "main"]);
    git(&dir, &["config", "user.email", "test@example.com"]);
    git(&dir, &["config", "user.name", "Test"]);
    git(&dir, &["config", "commit.gpgsign", "false"]);

    std::fs::write(dir.join("a.txt"), "base\n").unwrap();
    git(&dir, &["add", "-A"]);
    git(&dir, &["commit", "-q", "-m", "initial commit"]);

    git(&dir, &["switch", "-q", "-c", "side"]);
    git(&dir, &["rm", "-q", "a.txt"]);
    git(&dir, &["commit", "-q", "-m", "side deletes a"]);

    git(&dir, &["switch", "-q", "main"]);
    std::fs::write(dir.join("a.txt"), "main\n").unwrap();
    git(&dir, &["commit", "-q", "-am", "main edits a"]);

    // Deliberately not `git()`: the merge is meant to stop.
    let status = Command::new("git")
        .arg("-C")
        .arg(&dir)
        .args(["merge", "side"])
        .status()
        .expect("run git");
    assert!(!status.success(), "the merge was supposed to conflict");
    dir
}
