//! End-to-end cover for the headless command line, against a real repository.
//!
//! Every case here goes through the same entry point the binary and the GUI
//! both call — [`glimpse_cli::run`] — so what is asserted is the command as a
//! user runs it: argument parsing, `-C`, `--json`, exit code and the text on
//! each stream. The scratch repo is built with the real `git` binary, because
//! the engine under test shells out to it and a fake would only prove the fake.

use std::path::{Path, PathBuf};
use std::process::Command;

/// Run `git -C <dir> <args>` with a hermetic, signing-free identity so the test
/// never depends on (or mutates) the developer's global config.
fn git(dir: &Path, args: &[&str]) {
    let status = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(args)
        .status()
        .expect("run git");
    assert!(status.success(), "git {args:?} failed");
}

/// A per-test scratch repository: one commit, one modified file, one untracked
/// file. Removed before and after so reruns start clean.
fn scratch_repo(tag: &str) -> PathBuf {
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

fn argv(parts: &[&str]) -> Vec<String> {
    parts.iter().map(|s| s.to_string()).collect()
}

/// Run the CLI with both streams captured: `(exit code, stdout, stderr)`.
fn run(parts: &[&str]) -> (i32, String, String) {
    let mut out: Vec<u8> = Vec::new();
    let mut err: Vec<u8> = Vec::new();
    let code = glimpse_cli::run(&argv(parts), &mut out, &mut err);
    (
        code,
        String::from_utf8(out).expect("stdout is utf-8"),
        String::from_utf8(err).expect("stderr is utf-8"),
    )
}

fn json_of(text: &str) -> serde_json::Value {
    serde_json::from_str(text.trim()).unwrap_or_else(|e| panic!("not JSON ({e}): {text:?}"))
}

#[test]
fn status_lists_the_working_tree_in_both_shapes() {
    let dir = scratch_repo("status");
    let path = dir.to_str().unwrap();

    let (code, out, err) = run(&["status", "-C", path]);
    assert_eq!(code, 0, "stderr: {err}");
    assert!(out.contains("a.txt"), "modified file listed: {out:?}");
    assert!(out.contains("b.txt"), "untracked file listed: {out:?}");

    let (code, out, err) = run(&["status", "-C", path, "--json"]);
    assert_eq!(code, 0, "stderr: {err}");
    let entries = json_of(&out);
    let paths: Vec<&str> = entries
        .as_array()
        .expect("an array of entries")
        .iter()
        .map(|e| e["path"].as_str().expect("a path"))
        .collect();
    assert!(
        paths.contains(&"a.txt") && paths.contains(&"b.txt"),
        "{paths:?}"
    );
    // The JSON is the same camelCase contract the GUI receives over IPC.
    assert!(
        entries[0].get("untracked").is_some(),
        "camelCase fields: {entries}"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn log_reports_history_and_honours_a_limit() {
    let dir = scratch_repo("log");
    let path = dir.to_str().unwrap();

    let (code, out, err) = run(&["log", "-C", path]);
    assert_eq!(code, 0, "stderr: {err}");
    assert!(out.contains("initial commit"), "subject shown: {out:?}");

    let (code, out, err) = run(&["log", "-C", path, "-n", "1", "--json"]);
    assert_eq!(code, 0, "stderr: {err}");
    let commits = json_of(&out);
    assert_eq!(commits.as_array().expect("an array").len(), 1);
    assert_eq!(commits[0]["subject"], "initial commit");

    // A limit that is not a number is a usage error, not a panic or an empty log.
    let (code, _out, err) = run(&["log", "-C", path, "-n", "many"]);
    assert_eq!(code, 1);
    assert!(err.contains("many"), "the bad value is named: {err:?}");

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn branches_marks_the_checked_out_one() {
    let dir = scratch_repo("branches");
    let path = dir.to_str().unwrap();
    git(&dir, &["branch", "side"]);

    let (code, out, err) = run(&["branches", "-C", path]);
    assert_eq!(code, 0, "stderr: {err}");
    assert!(out.contains("* main"), "current branch marked: {out:?}");
    assert!(out.contains("side"), "other branches listed: {out:?}");
    // Never pushed anywhere, so both branches are local-only.
    assert!(out.contains("local"), "upstream state shown: {out:?}");

    let (code, out, err) = run(&["branches", "-C", path, "--json"]);
    assert_eq!(code, 0, "stderr: {err}");
    let names: Vec<String> = json_of(&out)
        .as_array()
        .expect("an array of branches")
        .iter()
        .map(|b| b["name"].as_str().expect("a name").to_string())
        .collect();
    assert!(
        names.contains(&"main".to_string()) && names.contains(&"side".to_string()),
        "{names:?}"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn info_summarises_the_repository() {
    let dir = scratch_repo("info");
    let path = dir.to_str().unwrap();

    let (code, out, err) = run(&["info", "-C", path]);
    assert_eq!(code, 0, "stderr: {err}");
    assert!(out.contains("main"), "current branch shown: {out:?}");

    let (code, out, err) = run(&["info", "-C", path, "--json"]);
    assert_eq!(code, 0, "stderr: {err}");
    let info = json_of(&out);
    assert_eq!(info["currentBranch"], "main");
    assert!(
        info["toplevel"].as_str().is_some(),
        "toplevel present: {info}"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn changelists_still_answer_from_the_same_entry_point() {
    // `glimpse cl …` predates the split and must keep working through it —
    // including its exit code and the changelists.json contract under --json.
    let dir = scratch_repo("cl");
    let path = dir.to_str().unwrap();

    let (code, out, err) = run(&["cl", "ls", "-C", path]);
    assert_eq!(code, 0, "stderr: {err}");
    assert!(
        out.contains("Default"),
        "the permanent list is shown: {out:?}"
    );

    let (code, out, err) = run(&["cl", "add", "Refactor", "-C", path, "--json"]);
    assert_eq!(code, 0, "stderr: {err}");
    let state = json_of(&out);
    assert_eq!(
        state["activeId"].as_str().map(|s| s.is_empty()),
        Some(false)
    );
    let names: Vec<&str> = state["lists"]
        .as_array()
        .expect("lists")
        .iter()
        .map(|l| l["name"].as_str().unwrap_or_default())
        .collect();
    assert!(names.contains(&"Refactor"), "{names:?}");

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn an_error_under_json_is_itself_json() {
    // An agent parsing stdout should not have to switch shapes to read failures.
    let (code, _out, err) = run(&["log", "-C", "/definitely/not/a/repo", "--json"]);
    assert_eq!(code, 1);
    let failure = json_of(&err);
    assert!(
        failure["error"].as_str().is_some(),
        "an {{error: …}} object: {failure}"
    );
}

#[test]
fn an_unknown_subcommand_fails_and_points_at_help() {
    let (code, out, err) = run(&["frobnicate"]);
    assert_eq!(code, 1);
    assert!(out.is_empty(), "nothing on stdout: {out:?}");
    assert!(
        err.contains("frobnicate") && err.contains("--help"),
        "{err:?}"
    );
}

#[test]
fn help_lists_every_subcommand_the_cli_claims() {
    // Done-criterion (b) of #103: a subcommand that exists must be discoverable
    // from `glimpse --help`. This is the check that keeps the two in step.
    let (code, out, err) = run(&["--help"]);
    assert_eq!(code, 0, "stderr: {err}");
    for name in glimpse_cli::SUBCOMMANDS {
        assert!(out.contains(name), "`{name}` missing from --help:\n{out}");
    }
    assert!(
        out.contains("--json") && out.contains("-C"),
        "global options documented: {out}"
    );
}

#[test]
fn version_is_reported_without_touching_a_repository() {
    let (code, out, err) = run(&["--version"]);
    assert_eq!(code, 0, "stderr: {err}");
    assert!(out.contains(env!("CARGO_PKG_VERSION")), "{out:?}");
}
