//! End-to-end cover for the headless command line's **write** commands.
//!
//! Held to a higher bar than the read suite, because every case here mutates a
//! real repository. Each command is asserted three ways: it does what it says
//! (checked with `git` itself, not with the code under test), it refuses what
//! it should refuse, and it reports either outcome under `--json` as well as to
//! a human.

mod common;

use common::{git, git_out, json_of, run, scratch_repo};

#[test]
fn stage_moves_named_files_into_the_index() {
    let dir = scratch_repo("stage");
    let path = dir.to_str().unwrap();

    let (code, out, err) = run(&["stage", "-C", path, "a.txt"]);
    assert_eq!(code, 0, "stderr: {err}");
    assert!(out.contains("a.txt"), "the staged file is named: {out:?}");

    // Asserted with git, not with `glimpse status`: the test must be able to
    // disagree with the engine it is checking.
    let staged = git_out(&dir, &["diff", "--cached", "--name-only"]);
    assert!(
        staged.contains("a.txt"),
        "a.txt is in the index: {staged:?}"
    );
    assert!(
        !staged.contains("b.txt"),
        "only what was named is staged: {staged:?}"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn stage_refuses_an_empty_subject_rather_than_staging_everything() {
    let dir = scratch_repo("stage-empty");
    let path = dir.to_str().unwrap();

    let (code, out, err) = run(&["stage", "-C", path]);
    assert_eq!(code, 1, "stdout: {out}");
    assert!(err.contains("at least one path"), "{err:?}");

    // The refusal is a refusal: nothing was staged behind it.
    let staged = git_out(&dir, &["diff", "--cached", "--name-only"]);
    assert!(staged.trim().is_empty(), "index untouched: {staged:?}");

    // And under --json the failure is JSON too, with no exception.
    let (code, _out, err) = run(&["stage", "-C", path, "--json"]);
    assert_eq!(code, 1);
    let e = json_of(&err);
    assert!(
        e["error"].as_str().is_some_and(|m| m.contains("path")),
        "{e}"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn unstage_takes_named_files_back_out_of_the_index() {
    let dir = scratch_repo("unstage");
    let path = dir.to_str().unwrap();

    git(&dir, &["add", "-A"]);
    let staged = git_out(&dir, &["diff", "--cached", "--name-only"]);
    assert!(
        staged.contains("a.txt") && staged.contains("b.txt"),
        "setup"
    );

    let (code, out, err) = run(&["unstage", "-C", path, "a.txt", "--json"]);
    assert_eq!(code, 0, "stderr: {err}");
    let r = json_of(&out);
    assert_eq!(r["action"], "unstage");
    assert_eq!(r["paths"][0], "a.txt");

    let staged = git_out(&dir, &["diff", "--cached", "--name-only"]);
    assert!(!staged.contains("a.txt"), "a.txt is out: {staged:?}");
    assert!(
        staged.contains("b.txt"),
        "only what was named moved: {staged:?}"
    );

    // The change itself survives being unstaged — it is not a discard.
    let content = std::fs::read_to_string(dir.join("a.txt")).unwrap();
    assert_eq!(content, "a2\n", "the working-tree change is untouched");

    let _ = std::fs::remove_dir_all(&dir);
}

// --- commit / amend ------------------------------------------------------

#[test]
fn commit_records_the_index_and_reports_the_new_hash() {
    let dir = scratch_repo("commit");
    let path = dir.to_str().unwrap();

    git(&dir, &["add", "a.txt"]);

    let (code, out, err) = run(&["commit", "-C", path, "-m", "feat: a change", "--json"]);
    assert_eq!(code, 0, "stderr: {err}");
    let r = json_of(&out);
    assert_eq!(r["action"], "commit");
    let hash = r["commit"].as_str().expect("the new commit's hash");
    assert_eq!(
        hash.len(),
        40,
        "a full hash a caller can quote back: {hash}"
    );

    // Checked with git: the hash is real, and it is HEAD.
    let head = git_out(&dir, &["rev-parse", "HEAD"]);
    assert_eq!(head.trim(), hash);
    let subject = git_out(&dir, &["log", "-1", "--format=%s"]);
    assert_eq!(subject.trim(), "feat: a change");

    // b.txt was never staged, so it is still untracked afterwards.
    let untracked = git_out(&dir, &["ls-files", "--others", "--exclude-standard"]);
    assert!(untracked.contains("b.txt"), "{untracked:?}");

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn commit_refuses_an_empty_commit_and_a_missing_message() {
    let dir = scratch_repo("commit-refuse");
    let path = dir.to_str().unwrap();

    let before = git_out(&dir, &["rev-parse", "HEAD"]);

    // Nothing staged. The working tree is dirty, which is exactly the case
    // where "commit" could plausibly be read as "commit everything".
    let (code, _out, err) = run(&["commit", "-C", path, "-m", "nope"]);
    assert_eq!(code, 1);
    assert!(err.contains("nothing staged"), "{err:?}");

    // A message is not optional: there is no editor to fall back to headlessly.
    git(&dir, &["add", "a.txt"]);
    let (code, _out, err) = run(&["commit", "-C", path]);
    assert_eq!(code, 1);
    assert!(err.contains("-m"), "{err:?}");

    let after = git_out(&dir, &["rev-parse", "HEAD"]);
    assert_eq!(before, after, "neither refusal moved HEAD");

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn amend_rewrites_head_keeping_its_message_by_default() {
    let dir = scratch_repo("amend");
    let path = dir.to_str().unwrap();

    let original = git_out(&dir, &["rev-parse", "HEAD"]).trim().to_string();
    git(&dir, &["add", "a.txt"]);

    // No -m: the point of a bare amend is "fold this into the last commit",
    // and inventing a message — or opening an editor — would be wrong.
    let (code, out, err) = run(&["amend", "-C", path]);
    assert_eq!(code, 0, "stderr: {err}");
    assert!(out.contains("amend"), "{out:?}");

    let head = git_out(&dir, &["rev-parse", "HEAD"]).trim().to_string();
    assert_ne!(head, original, "HEAD was rewritten");
    let subject = git_out(&dir, &["log", "-1", "--format=%s"]);
    assert_eq!(
        subject.trim(),
        "initial commit",
        "the message was kept, not replaced"
    );
    let count = git_out(&dir, &["rev-list", "--count", "HEAD"]);
    assert_eq!(count.trim(), "1", "amended, not added");

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn amend_replaces_the_message_when_one_is_given() {
    let dir = scratch_repo("amend-msg");
    let path = dir.to_str().unwrap();

    let (code, _out, err) = run(&["amend", "-C", path, "-m", "docs: reworded"]);
    assert_eq!(code, 0, "stderr: {err}");

    let subject = git_out(&dir, &["log", "-1", "--format=%s"]);
    assert_eq!(subject.trim(), "docs: reworded");
    // A reword with nothing staged is legitimate — unlike an empty `commit`.
    let count = git_out(&dir, &["rev-list", "--count", "HEAD"]);
    assert_eq!(count.trim(), "1");

    let _ = std::fs::remove_dir_all(&dir);
}

// --- discard -------------------------------------------------------------
//
// `discard` destroys uncommitted work, and nothing else in this CLI does. Its
// cases are therefore about what it *refuses*, and about a caller being able to
// tell — from the report alone — whether a file was reverted or deleted.

#[test]
fn discard_reverts_a_tracked_file_and_says_so() {
    let dir = scratch_repo("discard-tracked");
    let path = dir.to_str().unwrap();

    let (code, out, err) = run(&["discard", "-C", path, "a.txt"]);
    assert_eq!(code, 0, "stderr: {err}");
    assert!(out.contains("a.txt"), "{out:?}");
    assert!(
        out.contains("restored"),
        "a tracked file is reverted, not deleted — and the wording says which: {out:?}"
    );

    assert_eq!(
        std::fs::read_to_string(dir.join("a.txt")).unwrap(),
        "a1\n",
        "reverted to the committed content"
    );
    // The untracked file was not named, so it is still there.
    assert!(
        dir.join("b.txt").exists(),
        "only what was named was touched"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn discard_deletes_an_untracked_file_and_says_that_instead() {
    let dir = scratch_repo("discard-untracked");
    let path = dir.to_str().unwrap();

    let (code, out, err) = run(&["discard", "-C", path, "b.txt", "--json"]);
    assert_eq!(code, 0, "stderr: {err}");
    let r = json_of(&out);
    assert_eq!(r["action"], "discard");
    assert_eq!(r["paths"][0], "b.txt");
    assert!(
        r["detail"].as_str().is_some_and(|d| d.contains("deleted")),
        "an untracked file is gone from disk, and hiding that behind \
         \"discarded\" would understate it: {r}"
    );

    assert!(!dir.join("b.txt").exists(), "the untracked file is gone");
    assert!(dir.join("a.txt").exists(), "the tracked one is untouched");

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn discard_refuses_a_path_that_has_nothing_to_discard() {
    let dir = scratch_repo("discard-nomatch");
    let path = dir.to_str().unwrap();

    // A typo must not report success. Worse than doing nothing would be
    // *saying* it discarded something it never found.
    let (code, _out, err) = run(&["discard", "-C", path, "nope.txt"]);
    assert_eq!(code, 1);
    assert!(err.contains("nope.txt"), "the path is named: {err:?}");

    // A batch is all-or-nothing: one bad path refuses the whole command, so a
    // caller never has to work out how far it got before it stopped.
    let (code, _out, err) = run(&["discard", "-C", path, "a.txt", "nope.txt"]);
    assert_eq!(code, 1, "{err}");
    assert_eq!(
        std::fs::read_to_string(dir.join("a.txt")).unwrap(),
        "a2\n",
        "the good path in the batch was NOT discarded"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn discard_needs_an_explicit_subject_and_a_flag_to_take_the_whole_tree() {
    let dir = scratch_repo("discard-all");
    let path = dir.to_str().unwrap();

    // No path at all: refused, and the refusal points at the only way to mean
    // "everything" rather than guessing that is what was meant.
    let (code, _out, err) = run(&["discard", "-C", path]);
    assert_eq!(code, 1);
    assert!(err.contains("--all"), "{err:?}");

    // `--all` names nothing, so it carries its own confirmation.
    let (code, _out, err) = run(&["discard", "-C", path, "--all"]);
    assert_eq!(code, 1);
    assert!(err.contains("--force"), "{err:?}");
    assert_eq!(
        std::fs::read_to_string(dir.join("a.txt")).unwrap(),
        "a2\n",
        "nothing was destroyed by the refused --all"
    );

    let (code, out, err) = run(&["discard", "-C", path, "--all", "--force"]);
    assert_eq!(code, 0, "stderr: {err}");
    assert!(out.contains("every"), "{out:?}");
    assert_eq!(
        std::fs::read_to_string(dir.join("a.txt")).unwrap(),
        "a1\n",
        "tracked changes reverted"
    );
    assert!(!dir.join("b.txt").exists(), "untracked files removed");

    let _ = std::fs::remove_dir_all(&dir);
}

/// The receipt a successful write leaves for a running GUI, if any.
fn receipt(dir: &std::path::Path) -> Option<serde_json::Value> {
    let path = dir.join(".git").join("glimpse").join("last-write.json");
    let text = std::fs::read_to_string(path).ok()?;
    Some(json_of(&text))
}

#[test]
fn a_successful_write_leaves_a_receipt_for_a_running_gui() {
    let dir = scratch_repo("receipt");
    let path = dir.to_str().unwrap();

    assert!(receipt(&dir).is_none(), "no receipt before the first write");

    let (code, _out, err) = run(&["stage", "-C", path, "a.txt"]);
    assert_eq!(code, 0, "stderr: {err}");

    let r = receipt(&dir).expect("a receipt after a successful write");
    assert_eq!(r["action"], "stage");
    assert_eq!(r["paths"][0], "a.txt");
    assert!(
        r["at"].as_u64().is_some_and(|t| t > 0),
        "a timestamp the GUI can order and expire: {r}"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_refused_write_leaves_no_receipt() {
    let dir = scratch_repo("receipt-refused");
    let path = dir.to_str().unwrap();

    // Nothing changed, so nothing should tell the GUI that something did.
    let (code, _out, err) = run(&["stage", "-C", path]);
    assert_eq!(code, 1, "stderr: {err}");
    assert!(receipt(&dir).is_none(), "no receipt for a refusal");

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_receipt_that_cannot_be_written_does_not_fail_the_write() {
    let dir = scratch_repo("receipt-unwritable");
    let path = dir.to_str().unwrap();

    // A *file* where the receipt's directory belongs: creating the directory
    // now fails on every platform, without depending on file permissions (and
    // so still fails when the suite runs as root, as CI containers do).
    std::fs::write(dir.join(".git").join("glimpse"), "not a directory").unwrap();

    let (code, out, err) = run(&["stage", "-C", path, "a.txt"]);
    assert_eq!(
        code, 0,
        "a failed notification must not fail the write: {err}"
    );
    assert!(out.contains("a.txt"), "{out:?}");

    // And the write itself really happened.
    let staged = git_out(&dir, &["diff", "--cached", "--name-only"]);
    assert!(staged.contains("a.txt"), "{staged:?}");

    let _ = std::fs::remove_dir_all(&dir);
}
