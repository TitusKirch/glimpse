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
