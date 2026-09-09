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
fn a_bad_global_option_under_json_is_still_json() {
    // The hole the contract had: `--json` lives in the very options that failed
    // to parse, so the failure used to fall back to a plain line and an agent
    // handling only the JSON shape got something unparseable. Both front doors
    // are checked, because each parses the globals for itself.
    for parts in [
        ["status", "--json", "-C"].as_slice(),
        ["cl", "ls", "--json", "-C"].as_slice(),
    ] {
        let (code, _out, err) = run(parts);
        assert_eq!(code, 1, "{parts:?}");
        let failure = json_of(&err);
        assert!(
            failure["error"]
                .as_str()
                .is_some_and(|m| m.contains("after -C")),
            "an {{error: …}} object naming the dangling -C for {parts:?}: {failure}"
        );
    }
}

#[test]
fn a_bad_global_option_without_json_stays_a_plain_line() {
    // The scan is naive on purpose, and this is the half that says so: no
    // `--json` in argv means the human-readable line, prefix and all.
    let (code, _out, err) = run(&["status", "-C"]);
    assert_eq!(code, 1);
    assert!(
        err.starts_with("glimpse: ") && err.contains("after -C"),
        "{err:?}"
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
fn the_readme_documents_every_subcommand_the_cli_claims() {
    // The other half of done-criterion (b) of #103: a subcommand counts as
    // shipped only if it appears in `glimpse --help` AND in the README. The
    // help half is pinned above; this is the half that would otherwise drift,
    // because nothing about adding a command to the code touches the README.
    let readme = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../README.md")
        .canonicalize()
        .expect("the repository README");
    let text = std::fs::read_to_string(&readme).expect("read the README");

    for name in glimpse_cli::SUBCOMMANDS {
        assert!(
            text.contains(&format!("glimpse {name}")),
            "`glimpse {name}` is missing from {}",
            readme.display()
        );
    }
}

#[test]
fn version_is_reported_without_touching_a_repository() {
    let (code, out, err) = run(&["--version"]);
    assert_eq!(code, 0, "stderr: {err}");
    assert!(out.contains(env!("CARGO_PKG_VERSION")), "{out:?}");
}

#[test]
fn diff_shows_working_tree_changes_by_file() {
    let dir = scratch_repo("diff");
    let path = dir.to_str().unwrap();

    let (code, out, err) = run(&["diff", "-C", path, "a.txt"]);
    assert_eq!(code, 0, "stderr: {err}");
    assert!(out.contains("a.txt"), "the file is headed: {out:?}");
    assert!(out.contains("-a1") && out.contains("+a2"), "{out:?}");

    // With no path it covers everything the working tree changed, untracked
    // files included — the same set `glimpse status` lists.
    let (code, out, err) = run(&["diff", "-C", path]);
    assert_eq!(code, 0, "stderr: {err}");
    assert!(out.contains("a.txt") && out.contains("b.txt"), "{out:?}");

    let (code, out, err) = run(&["diff", "-C", path, "a.txt", "--json"]);
    assert_eq!(code, 0, "stderr: {err}");
    let files = json_of(&out);
    assert_eq!(
        files.as_array().expect("an array of diffs").len(),
        1,
        "one file asked for, one returned: {files}"
    );
    assert_eq!(files[0]["fileName"], "a.txt");
    assert!(
        files[0]["hunks"].as_array().is_some_and(|h| !h.is_empty()),
        "hunks in the GUI's own camelCase shape: {files}"
    );

    // Nothing staged yet, so the staged view is empty rather than the unstaged
    // one — the flag has to actually change which side is read.
    let (code, out, err) = run(&["diff", "-C", path, "a.txt", "--staged"]);
    assert_eq!(code, 0, "stderr: {err}");
    assert!(out.contains("no changes"), "{out:?}");

    git(&dir, &["add", "a.txt"]);
    let (code, out, err) = run(&["diff", "-C", path, "a.txt", "--staged"]);
    assert_eq!(code, 0, "stderr: {err}");
    assert!(out.contains("+a2"), "the staged change: {out:?}");

    // An unknown flag is named rather than silently treated as a path.
    let (code, _out, err) = run(&["diff", "-C", path, "--cached"]);
    assert_eq!(code, 1);
    assert!(err.contains("--cached"), "{err:?}");

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn blame_attributes_every_line_of_a_file() {
    let dir = scratch_repo("blame");
    let path = dir.to_str().unwrap();
    // The scratch repo leaves a.txt modified, and an uncommitted line blames to
    // "Not Committed Yet" — commit it so what is asserted is real authorship.
    git(&dir, &["add", "-A"]);
    git(&dir, &["commit", "-q", "-m", "second commit"]);

    let (code, out, err) = run(&["blame", "-C", path, "a.txt"]);
    assert_eq!(code, 0, "stderr: {err}");
    assert!(out.contains("Test"), "the author: {out:?}");
    assert!(out.contains("a2"), "the committed line content: {out:?}");

    let (code, out, err) = run(&["blame", "-C", path, "a.txt", "--json"]);
    assert_eq!(code, 0, "stderr: {err}");
    let lines = json_of(&out);
    assert_eq!(lines[0]["line"], 1);
    assert_eq!(lines[0]["author"], "Test");
    assert_eq!(lines[0]["content"], "a2");

    let (code, _out, err) = run(&["blame", "-C", path]);
    assert_eq!(code, 1);
    assert!(err.contains("file"), "{err:?}");

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn show_details_one_commit_defaulting_to_head() {
    let dir = scratch_repo("show");
    let path = dir.to_str().unwrap();

    let (code, out, err) = run(&["show", "-C", path]);
    assert_eq!(code, 0, "stderr: {err}");
    assert!(out.contains("initial commit"), "the message: {out:?}");
    assert!(out.contains("a.txt"), "the changed file: {out:?}");

    let (code, out, err) = run(&["show", "-C", path, "HEAD", "--json"]);
    assert_eq!(code, 0, "stderr: {err}");
    let detail = json_of(&out);
    // The ref is resolved, so a caller gets the commit it can quote back later
    // rather than the word it typed.
    let hash = detail["commit"].as_str().expect("a commit hash");
    assert_eq!(hash.len(), 40, "a full hash, got {hash:?}");
    assert!(hash.chars().all(|c| c.is_ascii_hexdigit()), "{hash:?}");
    assert!(
        detail["message"]
            .as_str()
            .is_some_and(|m| m.contains("initial commit")),
        "{detail}"
    );
    assert_eq!(detail["files"][0]["path"], "a.txt");
    assert_eq!(detail["files"][0]["status"], "A");

    // A ref that does not exist is an error, not an empty commit.
    let (code, _out, err) = run(&["show", "-C", path, "no-such-ref", "--json"]);
    assert_eq!(code, 1);
    assert!(json_of(&err)["error"].as_str().is_some(), "{err:?}");

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn reflog_shows_the_recovery_trail_and_honours_a_limit() {
    let dir = scratch_repo("reflog");
    let path = dir.to_str().unwrap();
    git(&dir, &["add", "-A"]);
    git(&dir, &["commit", "-q", "-m", "second commit"]);

    let (code, out, err) = run(&["reflog", "-C", path]);
    assert_eq!(code, 0, "stderr: {err}");
    assert!(out.contains("HEAD@{0}"), "the selector: {out:?}");
    assert!(out.contains("second commit"), "the subject: {out:?}");

    let (code, out, err) = run(&["reflog", "-C", path, "-n", "1", "--json"]);
    assert_eq!(code, 0, "stderr: {err}");
    let entries = json_of(&out);
    assert_eq!(entries.as_array().expect("an array").len(), 1);
    assert_eq!(entries[0]["selector"], "HEAD@{0}");
    assert!(
        entries[0]["hash"].as_str().is_some_and(|h| !h.is_empty()),
        "{entries}"
    );

    // The shared count parser refuses what it cannot honour, here as in `log`.
    let (code, _out, err) = run(&["reflog", "-C", path, "-n", "lots"]);
    assert_eq!(code, 1);
    assert!(err.contains("lots"), "{err:?}");

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn history_follows_one_file() {
    let dir = scratch_repo("history");
    let path = dir.to_str().unwrap();

    let (code, out, err) = run(&["history", "-C", path, "a.txt"]);
    assert_eq!(code, 0, "stderr: {err}");
    assert!(out.contains("initial commit"), "{out:?}");

    let (code, out, err) = run(&["history", "-C", path, "a.txt", "--json"]);
    assert_eq!(code, 0, "stderr: {err}");
    let commits = json_of(&out);
    assert_eq!(commits[0]["subject"], "initial commit");

    // A file is the whole point of the command; without one it must say so
    // rather than quietly reporting the branch's history instead.
    let (code, _out, err) = run(&["history", "-C", path]);
    assert_eq!(code, 1);
    assert!(
        err.contains("file"),
        "the missing argument is named: {err:?}"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn sparse_reports_whether_the_checkout_is_narrowed() {
    let dir = scratch_repo("sparse");
    let path = dir.to_str().unwrap();

    let (code, out, err) = run(&["sparse", "-C", path]);
    assert_eq!(code, 0, "stderr: {err}");
    assert!(out.contains("disabled"), "the off state is named: {out:?}");

    std::fs::create_dir_all(dir.join("keep")).unwrap();
    std::fs::write(dir.join("keep/k.txt"), "k\n").unwrap();
    git(&dir, &["add", "-A"]);
    git(&dir, &["commit", "-q", "-m", "add keep"]);
    git(&dir, &["sparse-checkout", "set", "keep"]);

    let (code, out, err) = run(&["sparse", "-C", path]);
    assert_eq!(code, 0, "stderr: {err}");
    assert!(out.contains("keep"), "the included pattern: {out:?}");

    let (code, out, err) = run(&["sparse", "-C", path, "--json"]);
    assert_eq!(code, 0, "stderr: {err}");
    let state = json_of(&out);
    assert_eq!(state["enabled"], true);
    let patterns: Vec<&str> = state["patterns"]
        .as_array()
        .expect("an array of patterns")
        .iter()
        .map(|p| p.as_str().unwrap_or_default())
        .collect();
    assert!(patterns.iter().any(|p| p.contains("keep")), "{patterns:?}");

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn stats_summarise_the_history() {
    let dir = scratch_repo("stats");
    let path = dir.to_str().unwrap();

    let (code, out, err) = run(&["stats", "-C", path]);
    assert_eq!(code, 0, "stderr: {err}");
    assert!(out.contains("Test"), "the contributor is named: {out:?}");

    let (code, out, err) = run(&["stats", "-C", path, "--json"]);
    assert_eq!(code, 0, "stderr: {err}");
    let stats = json_of(&out);
    assert_eq!(stats["totalCommits"], 1);
    assert_eq!(stats["contributors"][0]["name"], "Test");
    assert_eq!(stats["contributors"][0]["commits"], 1);
    // Churn comes from a second `git log` pass; a.txt is the only file in it.
    assert_eq!(stats["churn"][0]["path"], "a.txt");

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn worktrees_list_the_main_one_and_any_linked_ones() {
    let dir = scratch_repo("worktrees");
    let path = dir.to_str().unwrap();

    let (code, out, err) = run(&["worktrees", "-C", path]);
    assert_eq!(code, 0, "stderr: {err}");
    assert!(out.contains("main"), "the checked-out branch: {out:?}");

    git(&dir, &["worktree", "add", "linked", "-b", "side"]);

    let (code, out, err) = run(&["worktrees", "-C", path, "--json"]);
    assert_eq!(code, 0, "stderr: {err}");
    let entries = json_of(&out);
    let branches: Vec<&str> = entries
        .as_array()
        .expect("an array of worktrees")
        .iter()
        .map(|w| w["branch"].as_str().unwrap_or_default())
        .collect();
    assert!(
        branches.contains(&"main") && branches.contains(&"side"),
        "{branches:?}"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn submodules_list_what_the_repository_embeds() {
    let dir = scratch_repo("submodules");
    let path = dir.to_str().unwrap();

    // A repository with none says so, rather than printing an empty page.
    let (code, out, err) = run(&["submodules", "-C", path]);
    assert_eq!(code, 0, "stderr: {err}");
    assert!(out.contains("no submodules"), "{out:?}");

    let inner = scratch_repo("submodules-inner");
    git(&inner, &["add", "-A"]);
    git(&inner, &["commit", "-q", "-m", "inner"]);
    // `protocol.file.allow` is `user` by default since git 2.38; a local path
    // submodule is exactly what it blocks, and this test has to add one.
    git(
        &dir,
        &[
            "-c",
            "protocol.file.allow=always",
            "submodule",
            "add",
            "-q",
            inner.to_str().unwrap(),
            "sub",
        ],
    );

    let (code, out, err) = run(&["submodules", "-C", path]);
    assert_eq!(code, 0, "stderr: {err}");
    assert!(out.contains("sub"), "the submodule path: {out:?}");

    let (code, out, err) = run(&["submodules", "-C", path, "--json"]);
    assert_eq!(code, 0, "stderr: {err}");
    let entries = json_of(&out);
    assert_eq!(entries[0]["path"], "sub");
    assert!(
        entries[0]["sha"].as_str().is_some_and(|s| !s.is_empty()),
        "the checked-out commit: {entries}"
    );

    let _ = std::fs::remove_dir_all(&dir);
    let _ = std::fs::remove_dir_all(&inner);
}

#[test]
fn stashes_list_the_saved_entries() {
    let dir = scratch_repo("stashes");
    let path = dir.to_str().unwrap();

    // Nothing stashed yet: the command says so rather than printing nothing.
    let (code, out, err) = run(&["stashes", "-C", path]);
    assert_eq!(code, 0, "stderr: {err}");
    assert!(out.contains("no stashes"), "{out:?}");

    git(&dir, &["stash", "push", "-m", "wip a"]);

    let (code, out, err) = run(&["stashes", "-C", path]);
    assert_eq!(code, 0, "stderr: {err}");
    assert!(out.contains("stash@{0}"), "the ref is shown: {out:?}");
    assert!(out.contains("wip a"), "the message is shown: {out:?}");

    let (code, out, err) = run(&["stashes", "-C", path, "--json"]);
    assert_eq!(code, 0, "stderr: {err}");
    let entries = json_of(&out);
    assert_eq!(entries[0]["reference"], "stash@{0}");
    assert!(
        entries[0]["message"]
            .as_str()
            .is_some_and(|m| m.contains("wip a")),
        "{entries}"
    );

    let _ = std::fs::remove_dir_all(&dir);
}
