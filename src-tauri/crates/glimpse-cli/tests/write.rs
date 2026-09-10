//! End-to-end cover for the headless command line's **write** commands.
//!
//! Held to a higher bar than the read suite, because every case here mutates a
//! real repository. Each command is asserted three ways: it does what it says
//! (checked with `git` itself, not with the code under test), it refuses what
//! it should refuse, and it reports either outcome under `--json` as well as to
//! a human.

mod common;

use common::{
    git, git_out, json_of, merged_with_conflict, paused_on_break, receipt, run, scratch_repo,
    stopped_mid,
};

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
fn a_commit_message_that_collides_with_a_global_still_commits() {
    // `parse_globals` scanned every word in argv, so `-m help` was read as a
    // request for `--help`: the help text printed, nothing was committed, and
    // the command exited **0** — which a script reads as "the commit landed".
    // A silent no-op is the worst shape a write command can take.
    let dir = scratch_repo("commit-global-word");
    let path = dir.to_str().unwrap();

    git(&dir, &["add", "a.txt"]);

    let (code, out, err) = run(&["commit", "-C", path, "-m", "help"]);
    assert_eq!(code, 0, "stderr: {err}");
    assert!(
        !out.contains("Usage:"),
        "the message was a message, not a request for help: {out:?}"
    );

    let subject = git_out(&dir, &["log", "-1", "--format=%s"]);
    assert_eq!(subject.trim(), "help", "the commit really landed");
    let count = git_out(&dir, &["rev-list", "--count", "HEAD"]);
    assert_eq!(count.trim(), "2");

    // The same for every other word the global scan owns, including one that
    // begins with a dash — git itself takes whatever follows `-m` literally.
    for word in ["-h", "--help", "--json"] {
        std::fs::write(dir.join("a.txt"), format!("{word}\n")).unwrap();
        git(&dir, &["add", "a.txt"]);
        let (code, out, err) = run(&["commit", "-C", path, "-m", word]);
        assert_eq!(code, 0, "`-m {word}`: {err}");
        assert!(!out.contains("Usage:"), "`-m {word}`: {out:?}");
        let subject = git_out(&dir, &["log", "-1", "--format=%s"]);
        assert_eq!(subject.trim(), word, "`-m {word}` committed with it");
    }

    // A dangling `-m` is still a mistake, not an empty message.
    let (code, _out, err) = run(&["commit", "-C", path, "-m"]);
    assert_eq!(code, 1);
    assert!(err.contains("-m"), "{err:?}");

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn commit_refuses_while_a_merge_is_still_conflicted_and_says_which() {
    // The refusal used to read "nothing staged to commit / Stage something
    // first" — advice that, followed, stages the conflict markers.
    let dir = merged_with_conflict("commit-conflicted");
    let path = dir.to_str().unwrap();

    let before = git_out(&dir, &["rev-parse", "HEAD"]);

    let (code, _out, err) = run(&["commit", "-C", path, "-m", "merge"]);
    assert_eq!(code, 1);
    assert!(
        err.contains("conflict"),
        "the real state is named, not 'nothing staged': {err:?}"
    );
    assert!(err.contains("a.txt"), "the file is named: {err:?}");
    assert!(
        !err.contains("nothing staged"),
        "the misdiagnosis is gone: {err:?}"
    );
    assert_eq!(
        git_out(&dir, &["rev-parse", "HEAD"]),
        before,
        "the refusal moved nothing"
    );

    // Resolving it lifts the refusal — the merge still concludes normally.
    std::fs::write(dir.join("a.txt"), "resolved\n").unwrap();
    git(&dir, &["add", "a.txt"]);
    let (code, _out, err) = run(&["commit", "-C", path, "-m", "merge: resolved"]);
    assert_eq!(code, 0, "stderr: {err}");
    let parents = git_out(&dir, &["rev-list", "--parents", "-n", "1", "HEAD"]);
    assert_eq!(
        parents.split_whitespace().count(),
        3,
        "a real merge commit, two parents: {parents:?}"
    );

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
fn discard_takes_a_file_back_to_head_even_when_the_change_is_staged() {
    // `git restore -- <file>` sources the working tree from the INDEX, so a
    // staged change survives a "discard" that reports the file was restored to
    // the last committed state. `discard` means "throw away uncommitted work",
    // and a staged change is uncommitted work.
    let dir = scratch_repo("discard-staged");
    let path = dir.to_str().unwrap();

    // Staged content a2, working-tree content a3 — the two differ, so a restore
    // from the index and a restore from HEAD land on different bytes.
    git(&dir, &["add", "a.txt"]);
    std::fs::write(dir.join("a.txt"), "a3\n").unwrap();

    let (code, out, err) = run(&["discard", "-C", path, "a.txt"]);
    assert_eq!(code, 0, "stderr: {err}");
    assert!(out.contains("restored"), "{out:?}");

    assert_eq!(
        std::fs::read_to_string(dir.join("a.txt")).unwrap(),
        "a1\n",
        "the working tree is at the committed content, not the staged one"
    );
    let staged = git_out(&dir, &["diff", "--cached", "--name-only"]);
    assert!(
        staged.trim().is_empty(),
        "the staged change is gone too — it was uncommitted work: {staged:?}"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn discard_of_a_staged_only_change_is_not_a_no_op_that_claims_success() {
    // The worst shape of the bug above: nothing differs between index and
    // worktree, so `git restore` changes nothing at all — yet the command
    // exited 0, said the file was restored, and left a receipt telling a
    // running window something had happened.
    let dir = scratch_repo("discard-staged-only");
    let path = dir.to_str().unwrap();

    git(&dir, &["add", "a.txt"]);

    let (code, _out, err) = run(&["discard", "-C", path, "a.txt"]);
    assert_eq!(code, 0, "stderr: {err}");

    assert_eq!(
        std::fs::read_to_string(dir.join("a.txt")).unwrap(),
        "a1\n",
        "the report claimed the committed state, so that is what must be there"
    );
    let staged = git_out(&dir, &["diff", "--cached", "--name-only"]);
    assert!(staged.trim().is_empty(), "index restored too: {staged:?}");

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn discard_covers_a_staged_deletion_rather_than_half_destroying_the_batch() {
    // A path `status` lists that the index-sourced `git restore` rejects: a
    // staged deletion answers "pathspec 'c.txt' did not match any file(s) known
    // to git". The batch used to destroy the paths ahead of it and only then
    // fail — the opposite of the all-or-nothing it advertises.
    let dir = scratch_repo("discard-staged-delete");
    let path = dir.to_str().unwrap();

    std::fs::write(dir.join("c.txt"), "c1\n").unwrap();
    git(&dir, &["add", "c.txt"]);
    git(&dir, &["commit", "-q", "-m", "add c"]);
    std::fs::write(dir.join("a.txt"), "a2\n").unwrap();
    git(&dir, &["rm", "-q", "c.txt"]);
    let status = git_out(&dir, &["status", "--porcelain"]);
    assert!(status.contains("D  c.txt"), "setup: {status:?}");

    let (code, _out, err) = run(&["discard", "-C", path, "a.txt", "c.txt"]);
    assert_eq!(code, 0, "stderr: {err}");

    assert_eq!(
        std::fs::read_to_string(dir.join("a.txt")).unwrap(),
        "a1\n",
        "the unstaged edit is gone"
    );
    assert_eq!(
        std::fs::read_to_string(dir.join("c.txt")).unwrap(),
        "c1\n",
        "the staged deletion is undone: the file is back on disk"
    );
    let left = git_out(&dir, &["status", "--porcelain"]);
    assert!(
        !left.contains("a.txt") && !left.contains("c.txt"),
        "neither named path is still pending: {left:?}"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn discard_refuses_a_conflicted_path_before_it_destroys_the_rest_of_the_batch() {
    // Mid-merge, HEAD is *ours*: taking a conflicted file back to it silently
    // throws away the other side. The refusal is deliberate — and it happens in
    // the plan, so the other paths in the batch are still untouched.
    let dir = merged_with_conflict("discard-conflict");
    let path = dir.to_str().unwrap();

    std::fs::write(dir.join("z.txt"), "z2\n").unwrap();

    let (code, _out, err) = run(&["discard", "-C", path, "z.txt", "a.txt"]);
    assert_eq!(code, 1, "{err}");
    assert!(err.contains("conflict"), "the state is named: {err:?}");
    assert!(err.contains("a.txt"), "the path is named: {err:?}");
    assert_eq!(
        std::fs::read_to_string(dir.join("z.txt")).unwrap(),
        "z2\n",
        "the good path in the batch was NOT discarded"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn discard_refuses_a_renamed_path_rather_than_undoing_half_of_it() {
    // A rename is one change across two paths, and `status` names only the new
    // one. Restoring that half alone leaves the old path deleted while the
    // report claims the file is back at its committed state.
    let dir = scratch_repo("discard-rename");
    let path = dir.to_str().unwrap();

    git(&dir, &["mv", "a.txt", "renamed.txt"]);

    let (code, _out, err) = run(&["discard", "-C", path, "renamed.txt"]);
    assert_eq!(code, 1, "{err}");
    assert!(err.contains("rename"), "the state is named: {err:?}");
    assert!(
        dir.join("renamed.txt").exists(),
        "nothing was destroyed by the refusal"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn discard_reports_what_it_could_not_discard_rather_than_claiming_it_all() {
    // `git clean -f` will not remove a nested repository (that needs -ff) and
    // says nothing about it, so the path is still there afterwards. Checking
    // the outcome against `status` — rather than assuming git did as asked — is
    // what keeps the report true whatever git declines to do.
    let dir = scratch_repo("discard-undone");
    let path = dir.to_str().unwrap();

    let nested = dir.join("nested");
    std::fs::create_dir_all(&nested).unwrap();
    git(&nested, &["init", "-q", "-b", "main"]);
    std::fs::write(nested.join("x.txt"), "x\n").unwrap();

    let (code, _out, err) = run(&["discard", "-C", path, "a.txt", "nested/"]);
    assert_eq!(code, 1, "a report that does not match reality is a failure");
    assert!(err.contains("nested/"), "what survived is named: {err:?}");
    assert!(
        err.contains("a.txt"),
        "and so is what was already destroyed: {err:?}"
    );

    // The destruction that DID happen still refreshes a running window.
    let r = receipt(&dir).expect("a receipt for the part that landed");
    assert_eq!(r["action"], "discard");
    assert_eq!(r["paths"][0], "a.txt");

    let _ = std::fs::remove_dir_all(&dir);
}

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
fn discard_says_deleted_for_a_path_the_last_commit_has_no_version_of() {
    // A file staged as new goes back to a HEAD that never had it, so discarding
    // it removes it from disk — the same outcome as an untracked file, and for
    // the same reason. "Restored to the last committed state" would be the
    // wrong sentence for a file that no longer exists anywhere.
    let dir = scratch_repo("discard-added");
    let path = dir.to_str().unwrap();

    git(&dir, &["add", "b.txt"]);
    let status = git_out(&dir, &["status", "--porcelain"]);
    assert!(status.contains("A  b.txt"), "setup: {status:?}");

    let (code, out, err) = run(&["discard", "-C", path, "b.txt", "--json"]);
    assert_eq!(code, 0, "stderr: {err}");
    let r = json_of(&out);
    assert!(
        r["detail"].as_str().is_some_and(|d| d.contains("deleted")),
        "there is no copy of it left, and the wording has to say so: {r}"
    );
    assert!(!dir.join("b.txt").exists(), "gone from disk");
    let staged = git_out(&dir, &["diff", "--cached", "--name-only"]);
    assert!(staged.trim().is_empty(), "and out of the index: {staged:?}");

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

#[test]
fn discard_all_names_what_it_already_destroyed_rather_than_saying_nothing_was() {
    // The twin of `discard_reports_what_it_could_not_discard_rather_than_claiming_it_all`,
    // for the `--all` branch — which read the outcome back but hardcoded an
    // empty already-destroyed list, so the one case it anticipates (`clean`
    // will not remove a nested repository) answered "Nothing was discarded."
    // *after* wiping every tracked change. That is the dangerous direction: a
    // caller believes the tree is intact and never looks for what it lost.
    let dir = scratch_repo("discard-all-undone");
    let path = dir.to_str().unwrap();

    let nested = dir.join("nested");
    std::fs::create_dir_all(&nested).unwrap();
    git(&nested, &["init", "-q", "-b", "main"]);
    std::fs::write(nested.join("x.txt"), "x\n").unwrap();

    let (code, _out, err) = run(&["discard", "-C", path, "--all", "--force"]);
    assert_eq!(code, 1, "a report that does not match reality is a failure");
    assert!(err.contains("nested/"), "what survived is named: {err:?}");
    assert!(
        !err.contains("Nothing was discarded"),
        "a.txt's work is gone, so that sentence is false: {err:?}"
    );
    assert!(
        err.contains("Already discarded:") && err.contains("a.txt"),
        "what it already destroyed is named: {err:?}"
    );

    // …and the destruction it is now honest about really happened.
    assert_eq!(
        std::fs::read_to_string(dir.join("a.txt")).unwrap(),
        "a1\n",
        "the tracked change was discarded"
    );

    // The window hears about the same half the human is told about — not an
    // empty receipt claiming a destruction with no subject.
    let r = receipt(&dir).expect("a receipt for the part that landed");
    assert_eq!(r["action"], "discard");
    let paths: Vec<String> = r["paths"]
        .as_array()
        .expect("the receipt names what was destroyed")
        .iter()
        .map(|v| v.as_str().unwrap().to_string())
        .collect();
    assert!(paths.contains(&"a.txt".to_string()), "{r}");
    assert!(!paths.contains(&"nested/".to_string()), "{r}");

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn discard_all_refuses_while_a_merge_is_still_in_progress() {
    // The per-path form refuses a conflicted path because discarding it would
    // silently resolve the merge to *ours* and drop the other side. `--all`
    // used to do exactly that and report success — and it left MERGE_HEAD
    // behind, so `status` read clean while the merge was still open and the
    // next commit would have recorded it as fully merged. `--force` is consent
    // to lose the working tree, not consent to decide a merge.
    let dir = merged_with_conflict("discard-all-merge");
    let path = dir.to_str().unwrap();

    let (code, out, err) = run(&["discard", "-C", path, "--all", "--force"]);
    assert_eq!(code, 1, "stdout: {out:?}");
    assert!(err.contains("merge"), "the state is named: {err:?}");
    assert!(
        err.contains("a.txt"),
        "the conflicted path is named: {err:?}"
    );
    assert!(err.contains("--abort"), "and the way out is named: {err:?}");

    // Nothing was destroyed and nothing was decided.
    let conflicted = std::fs::read_to_string(dir.join("a.txt")).unwrap();
    assert!(
        conflicted.contains("<<<<<<<") && conflicted.contains("theirs"),
        "the other side is still there: {conflicted:?}"
    );
    assert!(
        dir.join(".git").join("MERGE_HEAD").exists(),
        "the merge is still in progress"
    );
    assert!(receipt(&dir).is_none(), "no receipt for a refusal");

    // The refusal is JSON under --json, like every other failure.
    let (code, _out, err) = run(&["discard", "-C", path, "--all", "--force", "--json"]);
    assert_eq!(code, 1);
    let e = json_of(&err);
    assert!(
        e["error"].as_str().is_some_and(|m| m.contains("merge")),
        "{e}"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn discard_all_refuses_while_a_rebase_is_paused_on_a_break() {
    // The same refusal, in the rebase state that sets no `REBASE_HEAD`. It is
    // the state glimpse's own rebase dialog reaches, and the one where a probe
    // that asked only for that ref let `--force` run straight through: the
    // sequencer would have been left mid-plan, with a `status` reading clean.
    let dir = paused_on_break("discard-all-break");
    let path = dir.to_str().unwrap();
    std::fs::write(dir.join("a.txt"), "edited mid-rebase\n").unwrap();

    let (code, out, err) = run(&["discard", "-C", path, "--all", "--force"]);
    assert_eq!(code, 1, "stdout: {out:?}");
    assert!(err.contains("rebase"), "the state is named: {err:?}");

    // Nothing was destroyed and the rebase is still there for git to see.
    assert_eq!(
        std::fs::read_to_string(dir.join("a.txt")).unwrap(),
        "edited mid-rebase\n",
        "the working tree was left alone"
    );
    assert!(
        !git_out(&dir, &["status"]).is_empty(),
        "git still answers about the repository"
    );
    assert!(
        dir.join(".git").join("rebase-merge").exists(),
        "the rebase is still in progress"
    );
    assert!(receipt(&dir).is_none(), "no receipt for a refusal");

    let _ = std::fs::remove_dir_all(&dir);
}

// --- one path convention, from anywhere in the tree -----------------------
//
// `-C <dir>/sub` is exactly what running the command *in* `sub/` does: both
// reach `open_repo` with a directory below the repository root. Paths are
// repo-root-relative — the spelling `glimpse status` prints and `--json`
// reports back — so a pipeline built from one command's output feeds the next
// whatever directory it is run from.

/// A repository with a subdirectory, one changed file in it and one at the top.
fn repo_with_subdir(tag: &str) -> std::path::PathBuf {
    let dir = scratch_repo(tag);
    std::fs::create_dir_all(dir.join("sub")).unwrap();
    std::fs::write(dir.join("sub").join("s.txt"), "s1\n").unwrap();
    // Only the new file: `a.txt`'s edit and `b.txt` must stay uncommitted, so
    // there is still something above `sub/` for `--all` to reach.
    git(&dir, &["add", "sub/s.txt"]);
    git(&dir, &["commit", "-q", "-m", "add sub"]);
    std::fs::write(dir.join("sub").join("s.txt"), "s2\n").unwrap();
    dir
}

#[test]
fn a_path_means_the_same_thing_from_a_subdirectory() {
    let dir = repo_with_subdir("subdir-paths");
    let sub = dir.join("sub");
    let sub_path = sub.to_str().unwrap();

    // `stage` and `discard` are the two halves of this slice, and they must
    // agree about what a path argument means.
    let (code, _out, err) = run(&["stage", "-C", sub_path, "sub/s.txt"]);
    assert_eq!(code, 0, "stage from a subdirectory: {err}");
    let staged = git_out(&dir, &["diff", "--cached", "--name-only"]);
    assert!(staged.contains("sub/s.txt"), "{staged:?}");

    let (code, out, err) = run(&["discard", "-C", sub_path, "sub/s.txt"]);
    assert_eq!(code, 0, "discard from a subdirectory: {err}");
    assert!(out.contains("sub/s.txt"), "{out:?}");
    assert_eq!(
        std::fs::read_to_string(sub.join("s.txt")).unwrap(),
        "s1\n",
        "the file really went back to the committed content"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn discard_all_from_a_subdirectory_clears_the_whole_working_tree() {
    // It used to run `git restore -- .` in the cwd, so from `sub/` it cleared
    // only `sub/` — while reporting that it had discarded every uncommitted
    // change in the working tree. Less destruction than claimed is still a
    // false sentence, and a caller trusting it believes work is gone.
    let dir = repo_with_subdir("subdir-all");
    let sub = dir.join("sub");

    let (code, out, err) = run(&["discard", "-C", sub.to_str().unwrap(), "--all", "--force"]);
    assert_eq!(code, 0, "stderr: {err}");
    assert!(out.contains("every"), "{out:?}");

    assert_eq!(
        std::fs::read_to_string(sub.join("s.txt")).unwrap(),
        "s1\n",
        "the subdirectory was cleared"
    );
    assert_eq!(
        std::fs::read_to_string(dir.join("a.txt")).unwrap(),
        "a1\n",
        "and so was the change above it, which the report claimed"
    );
    assert!(!dir.join("b.txt").exists(), "untracked files too");

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn discard_all_refuses_mid_cherry_pick_and_mid_revert_for_the_same_reason() {
    // `MERGE_HEAD` was refused first because that was the case a review
    // reproduced. A stopped cherry-pick and a stopped revert are the same shape:
    // the working tree holds one side of a conflict, the operation is not
    // recorded anywhere, and discarding would settle it on *ours* and leave the
    // sequencer's own ref behind a `status` that reads clean.
    for op in ["cherry-pick", "revert"] {
        let dir = stopped_mid(&format!("discard-all-{op}"), op);
        let path = dir.to_str().unwrap();

        let (code, out, err) = run(&["discard", "-C", path, "--all", "--force"]);
        assert_eq!(code, 1, "{op}: stdout {out:?}");
        assert!(err.contains(op), "{op}: the state is named: {err:?}");
        assert!(err.contains("a.txt"), "{op}: and the path: {err:?}");
        assert!(err.contains("--abort"), "{op}: and the way out: {err:?}");

        let conflicted = std::fs::read_to_string(dir.join("a.txt")).unwrap();
        assert!(
            conflicted.contains("<<<<<<<"),
            "{op}: nothing was decided: {conflicted:?}"
        );
        assert!(receipt(&dir).is_none(), "{op}: no receipt for a refusal");

        let _ = std::fs::remove_dir_all(&dir);
    }
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
