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

pub fn json_of(text: &str) -> serde_json::Value {
    serde_json::from_str(text.trim()).unwrap_or_else(|e| panic!("not JSON ({e}): {text:?}"))
}
