//! End-to-end cover for the headless command line's **refs and metadata**
//! commands — branches, tags, remotes, stashes, and the three commit-moving
//! verbs (`cherry-pick`, `revert`, `reset`).
//!
//! Same bar as the working-tree write suite: every case runs against a real
//! repository, asserts the outcome with `git` itself rather than through the
//! code under test, and pins the refusal as hard as the success. What this
//! group adds is that its subjects are **refs**, so "what actually happened" is
//! read back from the ref store after the fact rather than assumed from an exit
//! code.

mod common;

use common::{clean_repo, git, git_out, json_of, merged_with_conflict, receipt, run, scratch_repo};

#[test]
fn branch_create_makes_the_branch_and_switches_to_it() {
    let dir = clean_repo("branch-create");
    let path = dir.to_str().unwrap();

    let (code, out, err) = run(&["branch", "-C", path, "create", "feature"]);
    assert_eq!(code, 0, "stderr: {err}");
    assert!(out.contains("feature"), "the branch is named: {out:?}");

    // Asserted with git, not with `glimpse branches`.
    let head = git_out(&dir, &["rev-parse", "--abbrev-ref", "HEAD"]);
    assert_eq!(head.trim(), "feature", "switched to the new branch");

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn branch_create_can_start_from_a_named_commit() {
    let dir = clean_repo("branch-create-at");
    let path = dir.to_str().unwrap();
    let first = git_out(&dir, &["rev-parse", "HEAD~1"]).trim().to_string();

    let (code, out, err) = run(&["branch", "-C", path, "create", "older", "HEAD~1", "--json"]);
    assert_eq!(code, 0, "stderr: {err}");
    let r = json_of(&out);
    assert_eq!(r["action"], "branch create");
    assert_eq!(r["paths"][0], "older");

    let tip = git_out(&dir, &["rev-parse", "older"]).trim().to_string();
    assert_eq!(tip, first, "the branch starts where it was told to");

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn branch_switch_moves_head_and_refuses_a_branch_that_is_not_there() {
    let dir = clean_repo("branch-switch");
    let path = dir.to_str().unwrap();
    git(&dir, &["branch", "feature"]);

    let (code, out, err) = run(&["branch", "-C", path, "switch", "feature"]);
    assert_eq!(code, 0, "stderr: {err}");
    assert!(out.contains("feature"), "{out:?}");
    let head = git_out(&dir, &["rev-parse", "--abbrev-ref", "HEAD"]);
    assert_eq!(head.trim(), "feature");

    // A branch that does not exist is a refusal, not a silent stay-put.
    let (code, _out, err) = run(&["branch", "-C", path, "switch", "nope"]);
    assert_eq!(code, 1, "{err:?}");
    let head = git_out(&dir, &["rev-parse", "--abbrev-ref", "HEAD"]);
    assert_eq!(
        head.trim(),
        "feature",
        "HEAD did not move behind the refusal"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn branch_rename_renames_and_the_old_name_is_gone() {
    let dir = clean_repo("branch-rename");
    let path = dir.to_str().unwrap();
    git(&dir, &["branch", "old"]);

    let (code, out, err) = run(&["branch", "-C", path, "rename", "old", "new"]);
    assert_eq!(code, 0, "stderr: {err}");
    assert!(out.contains("old") && out.contains("new"), "{out:?}");

    let names = git_out(
        &dir,
        &["for-each-ref", "--format=%(refname:short)", "refs/heads"],
    );
    assert!(names.contains("new"), "{names:?}");
    assert!(
        !names.lines().any(|l| l == "old"),
        "the old name is gone: {names:?}"
    );

    // And the window is told, naming the branch that actually changed.
    let receipt = receipt(&dir).expect("a successful write leaves a receipt");
    assert_eq!(receipt["action"], "branch rename");

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn branch_delete_removes_a_merged_branch_and_says_where_it_pointed() {
    let dir = clean_repo("branch-delete");
    let path = dir.to_str().unwrap();
    git(&dir, &["branch", "spent"]);
    let tip = git_out(&dir, &["rev-parse", "spent"]).trim().to_string();

    let (code, out, err) = run(&["branch", "-C", path, "delete", "spent"]);
    assert_eq!(code, 0, "stderr: {err}");
    // The hash is the whole point of the sentence: the ref is gone, and this is
    // what puts it back.
    assert!(
        out.contains(&tip[..8]),
        "the commit it pointed at is named: {out:?}"
    );

    let names = git_out(
        &dir,
        &["for-each-ref", "--format=%(refname:short)", "refs/heads"],
    );
    assert!(!names.lines().any(|l| l == "spent"), "{names:?}");

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn branch_delete_refuses_unmerged_work_until_force_names_what_is_lost() {
    let dir = clean_repo("branch-delete-unmerged");
    let path = dir.to_str().unwrap();

    git(&dir, &["switch", "-q", "-c", "wip"]);
    std::fs::write(dir.join("w.txt"), "w1\n").unwrap();
    git(&dir, &["add", "-A"]);
    git(&dir, &["commit", "-q", "-m", "work nobody else has"]);
    let tip = git_out(&dir, &["rev-parse", "wip"]).trim().to_string();
    git(&dir, &["switch", "-q", "main"]);

    // Naming the branch confirms removing the *ref*. It does not confirm losing
    // commits no other ref holds — that is a second thing, and it needs its own
    // consent.
    let (code, _out, err) = run(&["branch", "-C", path, "delete", "wip"]);
    assert_eq!(code, 1, "{err:?}");
    assert!(err.contains("--force"), "it says how to mean it: {err:?}");
    assert!(
        err.contains(&tip[..8]),
        "and what would be lost, by hash: {err:?}"
    );
    let names = git_out(
        &dir,
        &["for-each-ref", "--format=%(refname:short)", "refs/heads"],
    );
    assert!(names.contains("wip"), "nothing happened behind the refusal");
    // A refusal changed nothing, so the window is not told anything did.
    assert!(receipt(&dir).is_none(), "no receipt for a refusal");

    let (code, out, err) = run(&["branch", "-C", path, "delete", "wip", "--force"]);
    assert_eq!(code, 0, "stderr: {err}");
    assert!(out.contains(&tip[..8]), "recoverable, by hash: {out:?}");
    let names = git_out(
        &dir,
        &["for-each-ref", "--format=%(refname:short)", "refs/heads"],
    );
    assert!(!names.lines().any(|l| l == "wip"), "{names:?}");
    // The commit itself survives — the report's hash is not a lie.
    let kind = git_out(&dir, &["cat-file", "-t", &tip]);
    assert_eq!(kind.trim(), "commit");

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn branch_merge_records_a_merge_commit_and_names_the_new_hash() {
    let dir = clean_repo("branch-merge");
    let path = dir.to_str().unwrap();

    git(&dir, &["switch", "-q", "-c", "side"]);
    std::fs::write(dir.join("s.txt"), "s1\n").unwrap();
    git(&dir, &["add", "-A"]);
    git(&dir, &["commit", "-q", "-m", "side work"]);
    git(&dir, &["switch", "-q", "main"]);

    let (code, out, err) = run(&["branch", "-C", path, "merge", "side", "--json"]);
    assert_eq!(code, 0, "stderr: {err}");
    let r = json_of(&out);
    assert_eq!(r["action"], "branch merge");
    let hash = r["commit"].as_str().expect("the merge commit is reported");

    // Two parents is what "merged" means; a fast-forward would have one.
    let parents = git_out(&dir, &["rev-list", "--parents", "-n", "1", hash]);
    assert_eq!(
        parents.split_whitespace().count(),
        3,
        "a real merge commit: {parents:?}"
    );
    assert_eq!(
        git_out(&dir, &["rev-parse", "HEAD"]).trim(),
        hash,
        "and it is what HEAD points at"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn branch_merge_that_conflicts_says_so_and_tells_the_window_the_tree_moved() {
    let dir = clean_repo("branch-merge-conflict");
    let path = dir.to_str().unwrap();

    git(&dir, &["switch", "-q", "-c", "side"]);
    std::fs::write(dir.join("a.txt"), "theirs\n").unwrap();
    git(&dir, &["commit", "-q", "-am", "theirs"]);
    git(&dir, &["switch", "-q", "main"]);
    std::fs::write(dir.join("a.txt"), "ours\n").unwrap();
    git(&dir, &["commit", "-q", "-am", "ours"]);

    let (code, _out, err) = run(&["branch", "-C", path, "merge", "side"]);
    assert_eq!(code, 1, "a stopped merge is not a success: {err:?}");
    assert!(
        err.contains("a.txt"),
        "the conflicted path is named: {err:?}"
    );
    // git writes CONFLICT to *stdout*, so the engine — which returns stderr on
    // failure — hands this an empty reason, and the message used to open with a
    // blank line followed by the git command line. A failure has to say what
    // failed in its first sentence.
    let first = err.lines().next().unwrap_or_default();
    assert!(
        first.contains("merge") && !first.trim_end().ends_with("glimpse:"),
        "the first line says what happened: {err:?}"
    );

    // The merge really is open, and the working tree really did change — so
    // unlike a refusal, this failure DOES owe the window a receipt.
    assert!(
        !git_out(&dir, &["rev-parse", "--verify", "--quiet", "MERGE_HEAD"])
            .trim()
            .is_empty(),
        "MERGE_HEAD is set"
    );
    let receipt = receipt(&dir).expect("the tree changed, so the window is told");
    assert_eq!(receipt["action"], "branch merge");

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_verb_that_starts_an_operation_refuses_while_one_is_already_open() {
    // Mid-merge, `git merge` fails with its own wording and `git cherry-pick`
    // with another; both are the same mistake, and neither says what to do. The
    // refusal is ours, it comes before anything is touched, and it names the
    // state the repository is actually in.
    let dir = merged_with_conflict("refs-in-progress");
    let path = dir.to_str().unwrap();
    let before = git_out(&dir, &["status", "--porcelain"]);

    for argv in [
        vec!["branch", "-C", path, "merge", "other"],
        vec!["cherry-pick", "-C", path, "HEAD"],
        vec!["revert", "-C", path, "HEAD"],
    ] {
        let (code, _out, err) = run(&argv);
        assert_eq!(code, 1, "{argv:?} should refuse: {err:?}");
        assert!(
            err.contains("merge") && err.contains("a.txt"),
            "{argv:?} names the open state and its conflict: {err:?}"
        );
    }

    assert_eq!(
        git_out(&dir, &["status", "--porcelain"]),
        before,
        "nothing moved behind the refusals"
    );
    assert!(receipt(&dir).is_none(), "no receipt for a refusal");

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn cherry_pick_replays_the_named_commits_in_the_order_given() {
    let dir = clean_repo("cherry-pick");
    let path = dir.to_str().unwrap();

    git(&dir, &["switch", "-q", "-c", "side"]);
    std::fs::write(dir.join("p.txt"), "p1\n").unwrap();
    git(&dir, &["add", "-A"]);
    git(&dir, &["commit", "-q", "-m", "first pick"]);
    let one = git_out(&dir, &["rev-parse", "HEAD"]).trim().to_string();
    std::fs::write(dir.join("q.txt"), "q1\n").unwrap();
    git(&dir, &["add", "-A"]);
    git(&dir, &["commit", "-q", "-m", "second pick"]);
    let two = git_out(&dir, &["rev-parse", "HEAD"]).trim().to_string();
    git(&dir, &["switch", "-q", "main"]);
    // main moves on, so the replayed commits get new parents and therefore new
    // hashes. Without this they would land on the very parent they were made on
    // and come out byte-identical — which would let an implementation that
    // merely echoed its arguments pass.
    std::fs::write(dir.join("m.txt"), "m1\n").unwrap();
    git(&dir, &["add", "-A"]);
    git(&dir, &["commit", "-q", "-m", "main moves on"]);

    let (code, out, err) = run(&["cherry-pick", "-C", path, &one, &two, "--json"]);
    assert_eq!(code, 0, "stderr: {err}");
    let r = json_of(&out);
    assert_eq!(r["action"], "cherry-pick");
    // The hashes reported are the NEW commits, read back from git — a
    // cherry-pick rewrites them, so echoing the arguments would be a fiction.
    let reported: Vec<&str> = r["paths"]
        .as_array()
        .expect("paths")
        .iter()
        .map(|v| v.as_str().unwrap())
        .collect();
    assert_eq!(reported.len(), 2, "{r}");
    assert!(!reported.contains(&one.as_str()), "not the old hashes: {r}");

    let subjects = git_out(&dir, &["log", "-2", "--format=%s"]);
    assert!(
        subjects.contains("first pick") && subjects.contains("second pick"),
        "both landed: {subjects:?}"
    );
    assert!(
        dir.join("p.txt").exists() && dir.join("q.txt").exists(),
        "and their content came with them"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn cherry_pick_that_conflicts_says_the_repository_is_left_mid_operation() {
    let dir = clean_repo("cherry-pick-conflict");
    let path = dir.to_str().unwrap();

    git(&dir, &["switch", "-q", "-c", "side"]);
    std::fs::write(dir.join("a.txt"), "theirs\n").unwrap();
    git(&dir, &["commit", "-q", "-am", "theirs"]);
    let theirs = git_out(&dir, &["rev-parse", "HEAD"]).trim().to_string();
    git(&dir, &["switch", "-q", "main"]);
    std::fs::write(dir.join("a.txt"), "ours\n").unwrap();
    git(&dir, &["commit", "-q", "-am", "ours"]);

    let (code, _out, err) = run(&["cherry-pick", "-C", path, &theirs]);
    assert_eq!(code, 1, "{err:?}");
    assert!(err.contains("a.txt"), "the conflict is named: {err:?}");
    assert!(err.contains("abort"), "and the way out: {err:?}");

    assert!(
        !git_out(
            &dir,
            &["rev-parse", "--verify", "--quiet", "CHERRY_PICK_HEAD"]
        )
        .trim()
        .is_empty(),
        "CHERRY_PICK_HEAD is set — the operation really is open"
    );
    let receipt = receipt(&dir).expect("the tree changed, so the window is told");
    assert_eq!(receipt["action"], "cherry-pick");

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn revert_records_the_inverse_commit_rather_than_rewriting_history() {
    let dir = clean_repo("revert");
    let path = dir.to_str().unwrap();
    let target = git_out(&dir, &["rev-parse", "HEAD"]).trim().to_string();
    let before_count = git_out(&dir, &["rev-list", "--count", "HEAD"])
        .trim()
        .to_string();

    let (code, out, err) = run(&["revert", "-C", path, &target]);
    assert_eq!(code, 0, "stderr: {err}");
    assert!(out.contains("revert") || out.contains("Revert"), "{out:?}");

    // a.txt goes back to its first-commit content, and history GREW.
    assert_eq!(std::fs::read_to_string(dir.join("a.txt")).unwrap(), "a1\n");
    let after_count = git_out(&dir, &["rev-list", "--count", "HEAD"])
        .trim()
        .to_string();
    assert_ne!(before_count, after_count, "a revert adds a commit");
    assert!(
        git_out(&dir, &["cat-file", "-t", &target]).trim() == "commit",
        "and the reverted commit is still there"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn revert_of_a_merge_takes_the_mainline_it_is_given() {
    let dir = clean_repo("revert-merge");
    let path = dir.to_str().unwrap();

    git(&dir, &["switch", "-q", "-c", "side"]);
    std::fs::write(dir.join("s.txt"), "s1\n").unwrap();
    git(&dir, &["add", "-A"]);
    git(&dir, &["commit", "-q", "-m", "side work"]);
    git(&dir, &["switch", "-q", "main"]);
    git(&dir, &["merge", "-q", "--no-ff", "--no-edit", "side"]);
    let merge = git_out(&dir, &["rev-parse", "HEAD"]).trim().to_string();

    // Without a mainline git cannot know which side to keep, and says so.
    let (code, _out, err) = run(&["revert", "-C", path, &merge]);
    assert_eq!(code, 1, "{err:?}");
    assert!(err.contains("-m"), "the way to say it is named: {err:?}");

    let (code, _out, err) = run(&["revert", "-C", path, "-m", "1", &merge]);
    assert_eq!(code, 0, "stderr: {err}");
    assert!(!dir.join("s.txt").exists(), "the side's work is undone");

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_subject_that_is_not_there_is_named_rather_than_git_s_read_back_probe() {
    // These commands read the subject's commit or URL *before* destroying it, so
    // that the report can say what was lost. When the subject does not exist it
    // was that read-back that failed first, and the user was shown
    // `fatal: Needed a single revision` plus a `git rev-parse` command line —
    // an accurate answer to a question they never asked.
    let dir = clean_repo("missing-subject");
    let path = dir.to_str().unwrap();

    for (argv, subject) in [
        (vec!["branch", "-C", path, "delete", "nope"], "nope"),
        (vec!["tag", "-C", path, "delete", "v9"], "v9"),
        (
            vec!["remote", "-C", path, "remove", "elsewhere"],
            "elsewhere",
        ),
    ] {
        let (code, _out, err) = run(&argv);
        assert_eq!(code, 1, "{argv:?}");
        assert!(err.contains(subject), "{argv:?} names it: {err:?}");
        assert!(
            !err.contains("rev-parse") && !err.contains("get-url"),
            "{argv:?} does not report the probe instead: {err:?}"
        );
    }

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn branch_delete_only_offers_force_where_force_would_actually_help() {
    // `--force` answers exactly one refusal: commits no other ref holds. git
    // refuses a *checked-out* branch too, and `-D` refuses it just as hard — so
    // offering the flag there is advice that cannot work.
    let dir = clean_repo("branch-delete-current");
    let path = dir.to_str().unwrap();

    let (code, _out, err) = run(&["branch", "-C", path, "delete", "main"]);
    assert_eq!(code, 1, "{err:?}");
    assert!(err.contains("main"), "{err:?}");
    assert!(
        !err.contains("--force"),
        "--force would not help here, so it is not offered: {err:?}"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn revert_without_a_mainline_is_a_refusal_not_a_half_finished_operation() {
    let dir = clean_repo("revert-no-mainline");
    let path = dir.to_str().unwrap();

    git(&dir, &["switch", "-q", "-c", "side"]);
    std::fs::write(dir.join("s.txt"), "s1\n").unwrap();
    git(&dir, &["add", "-A"]);
    git(&dir, &["commit", "-q", "-m", "side work"]);
    git(&dir, &["switch", "-q", "main"]);
    git(&dir, &["merge", "-q", "--no-ff", "--no-edit", "side"]);
    let merge = git_out(&dir, &["rev-parse", "HEAD"]).trim().to_string();

    let (code, _out, err) = run(&["revert", "-C", path, &merge]);
    assert_eq!(code, 1, "{err:?}");
    // The hint keyed on the word "mainline"; git says "is a merge but no -m
    // option was given", so it never fired — and the test that only looked for
    // "-m" passed on git's own wording.
    assert!(
        err.contains("glimpse revert -m 1"),
        "the way to say it, in this CLI's own spelling: {err:?}"
    );
    // git refused before touching anything, so claiming otherwise is a lie
    // about the repository — the one thing this group must not do.
    assert!(
        !err.contains("mid-operation"),
        "nothing was started: {err:?}"
    );
    assert!(
        git_out(&dir, &["rev-parse", "--verify", "--quiet", "REVERT_HEAD"])
            .trim()
            .is_empty(),
        "and REVERT_HEAD really is absent"
    );
    assert!(receipt(&dir).is_none(), "no receipt: nothing happened");

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn reset_moves_head_and_defaults_to_mixed_like_git() {
    let dir = clean_repo("reset-mixed");
    let path = dir.to_str().unwrap();
    let was = git_out(&dir, &["rev-parse", "HEAD"]).trim().to_string();
    let target = git_out(&dir, &["rev-parse", "HEAD~1"]).trim().to_string();

    let (code, out, err) = run(&["reset", "-C", path, "HEAD~1"]);
    assert_eq!(code, 0, "stderr: {err}");
    // Where HEAD *was* is the sentence that makes this undoable.
    assert!(out.contains(&was[..8]), "{out:?}");

    assert_eq!(git_out(&dir, &["rev-parse", "HEAD"]).trim(), target);
    // Mixed: the change is back in the working tree, not in the index.
    assert_eq!(std::fs::read_to_string(dir.join("a.txt")).unwrap(), "a2\n");
    assert!(
        git_out(&dir, &["diff", "--cached", "--name-only"])
            .trim()
            .is_empty(),
        "mixed leaves the index alone"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn reset_soft_keeps_the_change_staged() {
    let dir = clean_repo("reset-soft");
    let path = dir.to_str().unwrap();

    let (code, _out, err) = run(&["reset", "-C", path, "--soft", "HEAD~1", "--json"]);
    assert_eq!(code, 0, "stderr: {err}");
    let staged = git_out(&dir, &["diff", "--cached", "--name-only"]);
    assert!(staged.contains("a.txt"), "soft stages it: {staged:?}");

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn reset_hard_refuses_uncommitted_work_it_was_never_told_about() {
    let dir = clean_repo("reset-hard-dirty");
    let path = dir.to_str().unwrap();
    let was = git_out(&dir, &["rev-parse", "HEAD"]).trim().to_string();
    std::fs::write(dir.join("a.txt"), "work in progress\n").unwrap();

    // The commit is named; the uncommitted work is not, and it is the only part
    // that no reflog can bring back.
    let (code, _out, err) = run(&["reset", "-C", path, "--hard", "HEAD~1"]);
    assert_eq!(code, 1, "{err:?}");
    assert!(err.contains("a.txt"), "it names what is at stake: {err:?}");
    assert!(err.contains("--force"), "and how to mean it: {err:?}");
    assert_eq!(
        git_out(&dir, &["rev-parse", "HEAD"]).trim(),
        was,
        "HEAD did not move behind the refusal"
    );
    assert_eq!(
        std::fs::read_to_string(dir.join("a.txt")).unwrap(),
        "work in progress\n",
        "and the work is still there"
    );
    assert!(receipt(&dir).is_none(), "no receipt for a refusal");

    let (code, out, err) = run(&["reset", "-C", path, "--hard", "HEAD~1", "--force"]);
    assert_eq!(code, 0, "stderr: {err}");
    assert!(out.contains(&was[..8]), "where HEAD was: {out:?}");
    assert_eq!(std::fs::read_to_string(dir.join("a.txt")).unwrap(), "a1\n");

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn reset_hard_needs_no_force_when_there_is_nothing_uncommitted_to_lose() {
    // --force is consent to lose the working tree. A clean tree has nothing to
    // consent to, and demanding the flag anyway would teach the habit of
    // passing it without reading it.
    let dir = clean_repo("reset-hard-clean");
    let path = dir.to_str().unwrap();
    let target = git_out(&dir, &["rev-parse", "HEAD~1"]).trim().to_string();

    let (code, _out, err) = run(&["reset", "-C", path, "--hard", "HEAD~1"]);
    assert_eq!(code, 0, "stderr: {err}");
    assert_eq!(git_out(&dir, &["rev-parse", "HEAD"]).trim(), target);

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn reset_hard_is_the_way_out_of_a_stopped_merge_rather_than_a_refusal() {
    // `discard --all --force` refuses mid-merge because it would settle every
    // conflict on *ours* and leave MERGE_HEAD behind a clean-looking status.
    // `reset --hard` clears MERGE_HEAD, so it leaves no such lie — and refusing
    // it would leave a caller with no glimpse route out of a stopped merge.
    // Asserted, not assumed.
    let dir = merged_with_conflict("reset-hard-merge");
    let path = dir.to_str().unwrap();

    let (code, _out, err) = run(&["reset", "-C", path, "--hard", "HEAD", "--force"]);
    assert_eq!(code, 0, "stderr: {err}");
    assert!(
        git_out(&dir, &["rev-parse", "--verify", "--quiet", "MERGE_HEAD"])
            .trim()
            .is_empty(),
        "the merge is concluded, not left half-open"
    );
    assert!(
        git_out(&dir, &["status", "--porcelain"]).trim().is_empty(),
        "and the tree is clean"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn tag_create_makes_a_lightweight_tag_and_a_message_makes_it_annotated() {
    let dir = clean_repo("tag-create");
    let path = dir.to_str().unwrap();
    let head = git_out(&dir, &["rev-parse", "HEAD"]).trim().to_string();

    let (code, out, err) = run(&["tag", "-C", path, "create", "v1"]);
    assert_eq!(code, 0, "stderr: {err}");
    assert!(out.contains("v1") && out.contains(&head[..8]), "{out:?}");
    assert_eq!(
        git_out(&dir, &["cat-file", "-t", "v1"]).trim(),
        "commit",
        "no message means a bare ref"
    );

    let (code, _out, err) = run(&["tag", "-C", path, "create", "v2", "HEAD~1", "-m", "second"]);
    assert_eq!(code, 0, "stderr: {err}");
    assert_eq!(
        git_out(&dir, &["cat-file", "-t", "v2"]).trim(),
        "tag",
        "a message makes it annotated"
    );
    assert_eq!(
        git_out(&dir, &["rev-parse", "v2^{commit}"]).trim(),
        git_out(&dir, &["rev-parse", "HEAD~1"]).trim(),
        "and it is where it was told to be"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn tag_delete_removes_it_and_says_where_it_pointed() {
    let dir = clean_repo("tag-delete");
    let path = dir.to_str().unwrap();
    git(&dir, &["tag", "v1"]);
    let at = git_out(&dir, &["rev-parse", "v1^{commit}"])
        .trim()
        .to_string();

    let (code, out, err) = run(&["tag", "-C", path, "delete", "v1"]);
    assert_eq!(code, 0, "stderr: {err}");
    assert!(out.contains(&at[..8]), "recoverable, by hash: {out:?}");
    assert!(
        git_out(&dir, &["tag", "--list"]).trim().is_empty(),
        "the tag is gone"
    );

    // A tag that was never there is a refusal, not a cheerful no-op.
    let (code, _out, err) = run(&["tag", "-C", path, "delete", "v1"]);
    assert_eq!(code, 1, "{err:?}");

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn tag_push_reports_the_tags_that_actually_reached_the_remote() {
    let dir = clean_repo("tag-push");
    let path = dir.to_str().unwrap();

    // A remote is required, and its absence is said plainly rather than left to
    // git's "No configured push destination".
    git(&dir, &["tag", "v1"]);
    let (code, _out, err) = run(&["tag", "-C", path, "push"]);
    assert_eq!(code, 1, "{err:?}");
    assert!(err.contains("remote"), "{err:?}");

    let remote = dir.parent().unwrap().join(format!(
        "glimpse-cli-tag-push-remote-{}.git",
        std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&remote);
    let status = std::process::Command::new("git")
        .args(["init", "-q", "--bare"])
        .arg(&remote)
        .status()
        .expect("run git");
    assert!(status.success());
    git(&dir, &["remote", "add", "origin", remote.to_str().unwrap()]);

    let (code, out, err) = run(&["tag", "-C", path, "push", "--json"]);
    assert_eq!(code, 0, "stderr: {err}");
    let r = json_of(&out);
    assert_eq!(r["action"], "tag push");
    assert_eq!(r["paths"][0], "v1", "the tag that landed is named: {r}");

    // Asserted on the remote itself, which is the only place that can confirm it.
    let there = git_out(&remote, &["tag", "--list"]);
    assert!(there.contains("v1"), "{there:?}");

    // Pushing again moves nothing, and says so rather than claiming a push.
    let (code, out, err) = run(&["tag", "-C", path, "push"]);
    assert_eq!(code, 0, "stderr: {err}");
    assert!(
        out.contains("already") || out.contains("nothing") || out.contains("up to date"),
        "an unchanged remote is reported as unchanged: {out:?}"
    );

    let _ = std::fs::remove_dir_all(&dir);
    let _ = std::fs::remove_dir_all(&remote);
}

#[test]
fn remote_add_rename_and_remove_are_each_read_back_from_git() {
    let dir = clean_repo("remote");
    let path = dir.to_str().unwrap();

    let (code, out, err) = run(&[
        "remote",
        "-C",
        path,
        "add",
        "origin",
        "https://x.test/r.git",
    ]);
    assert_eq!(code, 0, "stderr: {err}");
    assert!(out.contains("https://x.test/r.git"), "{out:?}");
    assert_eq!(
        git_out(&dir, &["remote", "get-url", "origin"]).trim(),
        "https://x.test/r.git"
    );

    let (code, _out, err) = run(&["remote", "-C", path, "rename", "origin", "upstream"]);
    assert_eq!(code, 0, "stderr: {err}");
    let names = git_out(&dir, &["remote"]);
    assert!(
        names.contains("upstream") && !names.contains("origin"),
        "{names:?}"
    );

    // The URL is named on the way out, because nothing else remembers it.
    let (code, out, err) = run(&["remote", "-C", path, "remove", "upstream"]);
    assert_eq!(code, 0, "stderr: {err}");
    assert!(out.contains("https://x.test/r.git"), "{out:?}");
    assert!(git_out(&dir, &["remote"]).trim().is_empty(), "it is gone");

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_bare_group_still_lists_and_an_unknown_verb_names_the_ones_there_are() {
    let dir = clean_repo("group-listing");
    let path = dir.to_str().unwrap();
    git(&dir, &["tag", "v1"]);
    git(&dir, &["remote", "add", "origin", "https://x.test/r.git"]);

    // `glimpse branch` and `glimpse stash` listed before these groups had verbs,
    // and still do; `tag` and `remote` join them.
    for (argv, expected) in [
        (vec!["branch", "-C", path], "main"),
        (vec!["tag", "-C", path], "v1"),
        (vec!["remote", "-C", path], "origin"),
        (vec!["stash", "-C", path], "no stashes"),
    ] {
        let (code, out, err) = run(&argv);
        assert_eq!(code, 0, "{argv:?} stderr: {err}");
        assert!(out.contains(expected), "{argv:?} listed: {out:?}");

        // …and `ls` is the same listing, spelled out.
        let mut with_ls = argv.clone();
        with_ls.push("ls");
        let (code, out, _err) = run(&with_ls);
        assert_eq!(code, 0);
        assert!(out.contains(expected), "{with_ls:?} listed: {out:?}");
    }

    let (code, _out, err) = run(&["branch", "-C", path, "delet", "main"]);
    assert_eq!(code, 1);
    assert!(
        err.contains("delete") && err.contains("rename"),
        "a near miss is told what the verbs are: {err:?}"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn stash_save_puts_the_tracked_change_away_and_leaves_the_tree_clean() {
    // `scratch_repo` is dirty by construction: a.txt modified, b.txt untracked.
    let dir = scratch_repo("stash-save");
    let path = dir.to_str().unwrap();

    let (code, out, err) = run(&["stash", "-C", path, "save", "-m", "wip"]);
    assert_eq!(code, 0, "stderr: {err}");
    assert!(out.contains("stash@{0}"), "the entry is named: {out:?}");

    assert_eq!(
        std::fs::read_to_string(dir.join("a.txt")).unwrap(),
        "a1\n",
        "the tracked change went away"
    );
    assert!(
        dir.join("b.txt").exists(),
        "and the untracked file stayed, because -u was not given"
    );
    let list = git_out(&dir, &["stash", "list"]);
    assert!(
        list.contains("wip"),
        "the message is on the entry: {list:?}"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn stash_save_refuses_the_silent_no_op_git_would_have_made() {
    let dir = clean_repo("stash-save-clean");
    let path = dir.to_str().unwrap();

    // `git stash push` on a clean tree prints "No local changes to save" and
    // exits 0 — which a script reads as "stashed". It is a refusal here.
    let (code, _out, err) = run(&["stash", "-C", path, "save"]);
    assert_eq!(code, 1, "{err:?}");
    assert!(err.contains("nothing"), "{err:?}");
    assert!(
        git_out(&dir, &["stash", "list"]).trim().is_empty(),
        "and no entry was made"
    );
    assert!(receipt(&dir).is_none(), "no receipt for a refusal");

    // Untracked-only is the same trap with a different cause, and it names the
    // flag that would have worked.
    std::fs::write(dir.join("new.txt"), "n1\n").unwrap();
    let (code, _out, err) = run(&["stash", "-C", path, "save"]);
    assert_eq!(code, 1, "{err:?}");
    assert!(err.contains("-u"), "it names the flag: {err:?}");

    let (code, _out, err) = run(&["stash", "-C", path, "save", "-u"]);
    assert_eq!(code, 0, "stderr: {err}");
    assert!(!dir.join("new.txt").exists(), "-u took it");

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn stash_pop_restores_and_removes_the_entry_while_apply_keeps_it() {
    let dir = scratch_repo("stash-pop");
    let path = dir.to_str().unwrap();

    git(&dir, &["stash", "push", "-q", "-m", "one"]);
    assert_eq!(std::fs::read_to_string(dir.join("a.txt")).unwrap(), "a1\n");

    // `apply` keeps the entry — that is the whole difference between the two.
    let (code, _out, err) = run(&["stash", "-C", path, "apply"]);
    assert_eq!(code, 0, "stderr: {err}");
    assert_eq!(std::fs::read_to_string(dir.join("a.txt")).unwrap(), "a2\n");
    assert_eq!(
        git_out(&dir, &["stash", "list"]).lines().count(),
        1,
        "apply keeps the entry"
    );

    // Bring the tree back so `pop` has somewhere to land.
    git(&dir, &["checkout", "--", "a.txt"]);
    let (code, out, err) = run(&["stash", "-C", path, "pop", "--json"]);
    assert_eq!(code, 0, "stderr: {err}");
    assert_eq!(json_of(&out)["action"], "stash pop");
    assert_eq!(std::fs::read_to_string(dir.join("a.txt")).unwrap(), "a2\n");
    assert!(
        git_out(&dir, &["stash", "list"]).trim().is_empty(),
        "pop removes the entry"
    );

    // With nothing left, both refuse rather than reporting a restore.
    let (code, _out, err) = run(&["stash", "-C", path, "pop"]);
    assert_eq!(code, 1, "{err:?}");

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn stash_drop_needs_the_entry_named_because_naming_it_is_the_confirmation() {
    let dir = scratch_repo("stash-drop");
    let path = dir.to_str().unwrap();
    git(&dir, &["stash", "push", "-q", "-m", "older"]);
    std::fs::write(dir.join("a.txt"), "a3\n").unwrap();
    git(&dir, &["stash", "push", "-q", "-m", "newer"]);

    // `git stash drop` with no argument silently means stash@{0}. A command that
    // destroys work does not get to pick its own subject.
    let (code, _out, err) = run(&["stash", "-C", path, "drop"]);
    assert_eq!(code, 1, "{err:?}");
    assert!(err.contains("stash@{0}"), "it shows the spelling: {err:?}");
    assert_eq!(
        git_out(&dir, &["stash", "list"]).lines().count(),
        2,
        "nothing dropped behind the refusal"
    );
    assert!(receipt(&dir).is_none(), "no receipt for a refusal");

    // Named, it goes — and the report carries the message, which is the only
    // description of what was just thrown away.
    let (code, out, err) = run(&["stash", "-C", path, "drop", "stash@{0}"]);
    assert_eq!(code, 0, "stderr: {err}");
    assert!(out.contains("newer"), "what was lost is named: {out:?}");
    let list = git_out(&dir, &["stash", "list"]);
    assert_eq!(list.lines().count(), 1, "{list:?}");
    assert!(list.contains("older"), "the right one went: {list:?}");

    let _ = std::fs::remove_dir_all(&dir);
}
