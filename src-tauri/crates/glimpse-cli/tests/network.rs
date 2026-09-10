//! The network commands — `fetch`, `pull`, `push` — driven end to end against a
//! real bare remote on disk.
//!
//! These are the first commands whose subject is **not** in the repository, and
//! that is what every test here is really about: what the command reports has to
//! be read back from the ref store *after* git has spoken to the remote, because
//! the remote is the one participant that can decline. A push that git exits 0
//! on may still have moved nothing; a pull that exits non-zero may have moved
//! HEAD already. Asking afterwards is the only honest answer.

mod common;

use common::{
    commit_and_push, commit_local, git, git_out, json_of, receipt, repo_with_remote, run,
};

/// The subject a network command reports on, read with git rather than with the
/// code under test.
fn head(dir: &std::path::Path) -> String {
    git_out(dir, &["rev-parse", "HEAD"]).trim().to_string()
}

fn tracking(dir: &std::path::Path, reference: &str) -> String {
    git_out(dir, &["rev-parse", reference]).trim().to_string()
}

// ---------------------------------------------------------------- fetch

#[test]
fn fetch_names_the_remote_refs_that_actually_moved() {
    let r = repo_with_remote("fetch-moved");
    commit_and_push(&r.other, "b.txt", "b1\n", "from elsewhere");

    let dir = r.dir.to_string_lossy().to_string();
    let (code, out, err) = run(&["fetch", "-C", &dir]);
    assert_eq!(code, 0, "stderr: {err}");
    assert!(out.contains("origin/main"), "{out:?}");

    // The claim is checked against the ref store, not against the sentence.
    assert_eq!(
        tracking(&r.dir, "refs/remotes/origin/main"),
        head(&r.other),
        "the remote-tracking ref really did move"
    );
    // …and a fetch is not a checkout: the branch itself stays where it was.
    assert_ne!(head(&r.dir), head(&r.other));

    let json = receipt(&r.dir).expect("a successful fetch tells a running window");
    assert_eq!(json["action"], "fetch");
}

#[test]
fn fetch_says_nothing_moved_rather_than_implying_something_did() {
    let r = repo_with_remote("fetch-quiet");
    let dir = r.dir.to_string_lossy().to_string();

    let (code, out, err) = run(&["fetch", "-C", &dir, "--json"]);
    assert_eq!(code, 0, "stderr: {err}");
    let json = json_of(&out);
    assert_eq!(json["action"], "fetch");
    // No refs moved, so none are reported — the field is absent rather than an
    // empty list a caller has to tell apart from "not answered".
    assert!(json.get("paths").is_none(), "{json}");
    assert!(
        json["detail"].as_str().unwrap().contains("up to date"),
        "{json}"
    );
}

#[test]
fn fetch_refuses_a_repository_with_no_remote_instead_of_succeeding_at_nothing() {
    // `git fetch --all` in a repository with no remotes exits 0 having done
    // nothing at all, which reads to a script as "fetched, you are current".
    let dir = common::clean_repo("fetch-no-remote");
    let dir = dir.to_string_lossy().to_string();

    let (code, out, err) = run(&["fetch", "-C", &dir]);
    assert_eq!(code, 1, "stdout: {out}");
    assert!(err.contains("remote"), "{err:?}");
    assert!(err.contains("glimpse remote add"), "it says how: {err:?}");
}

// ----------------------------------------------------------------- pull

#[test]
fn pull_brings_the_commits_down_and_reports_the_ones_it_got() {
    let r = repo_with_remote("pull-gets");
    commit_and_push(&r.other, "b.txt", "b1\n", "from elsewhere");
    let expected = head(&r.other);

    let dir = r.dir.to_string_lossy().to_string();
    let (code, out, err) = run(&["pull", "-C", &dir, "--json"]);
    assert_eq!(code, 0, "stderr: {err}");
    let json = json_of(&out);
    assert_eq!(json["action"], "pull");
    assert_eq!(json["commit"], expected, "reports where HEAD actually is");
    assert_eq!(head(&r.dir), expected);
    assert_eq!(json["paths"].as_array().unwrap().len(), 1);
    assert_eq!(receipt(&r.dir).expect("receipt")["action"], "pull");
}

#[test]
fn pull_with_nothing_to_get_reports_that_and_leaves_head_alone() {
    let r = repo_with_remote("pull-current");
    let before = head(&r.dir);
    let dir = r.dir.to_string_lossy().to_string();

    let (code, out, err) = run(&["pull", "-C", &dir]);
    assert_eq!(code, 0, "stderr: {err}");
    assert!(out.contains("up to date"), "{out:?}");
    assert_eq!(head(&r.dir), before);
}

#[test]
fn pull_rebase_replays_local_work_on_top_rather_than_merging_it() {
    let r = repo_with_remote("pull-rebase");
    commit_and_push(&r.other, "b.txt", "b1\n", "from elsewhere");
    commit_local(&r.dir, "c.txt", "c1\n", "mine");

    let dir = r.dir.to_string_lossy().to_string();
    let (code, out, err) = run(&["pull", "-C", &dir, "--rebase"]);
    assert_eq!(code, 0, "stderr: {err}");
    assert!(out.contains("rebase"), "the strategy is reported: {out:?}");

    // Linear: the merge strategy would have written a commit with two parents.
    let parents = git_out(&r.dir, &["rev-list", "--parents", "-n", "1", "HEAD"]);
    assert_eq!(
        parents.split_whitespace().count(),
        2,
        "one commit, one parent: {parents:?}"
    );
    // Both sides are present, so the replay kept the local work.
    assert!(r.dir.join("b.txt").exists() && r.dir.join("c.txt").exists());
}

#[test]
fn pull_refuses_a_branch_with_no_upstream_and_says_how_to_give_it_one() {
    let r = repo_with_remote("pull-no-upstream");
    git(&r.dir, &["switch", "-q", "-c", "solo"]);

    let dir = r.dir.to_string_lossy().to_string();
    let (code, out, err) = run(&["pull", "-C", &dir]);
    assert_eq!(code, 1, "stdout: {out}");
    assert!(err.contains("solo"), "it names the branch: {err:?}");
    assert!(err.contains("glimpse push -u"), "{err:?}");
    assert!(receipt(&r.dir).is_none(), "a refusal writes no receipt");
}

#[test]
fn pull_refuses_while_another_operation_is_still_open() {
    // A pull is a merge, and starting one on top of an unfinished merge is
    // exactly the half-act the refs commands already refuse.
    let dir = common::merged_with_conflict("pull-mid-merge");
    let dir = dir.to_string_lossy().to_string();

    let (code, out, err) = run(&["pull", "-C", &dir]);
    assert_eq!(code, 1, "stdout: {out}");
    assert!(err.contains("merge is still in progress"), "{err:?}");
    assert!(err.contains("a.txt"), "it names the conflict: {err:?}");
}

#[test]
fn a_pull_that_stops_on_a_conflict_reports_it_and_names_the_way_out() {
    let r = repo_with_remote("pull-conflict");
    commit_and_push(&r.other, "a.txt", "theirs\n", "theirs");
    commit_local(&r.dir, "a.txt", "ours\n", "ours");

    let dir = r.dir.to_string_lossy().to_string();
    let (code, out, err) = run(&["pull", "-C", &dir]);
    assert_eq!(code, 1, "stdout: {out}");
    assert!(err.contains("a.txt"), "it names the path: {err:?}");
    // `git pull --abort` is not a command; the way out is named by the strategy
    // that actually ran.
    assert!(err.contains("git merge --abort"), "{err:?}");
    assert!(!err.contains("git pull --abort"), "{err:?}");
    // The tree moved even though the command failed, so a window is told.
    assert_eq!(receipt(&r.dir).expect("receipt")["action"], "pull");
}

#[test]
fn a_rebasing_pull_that_stops_names_the_rebase_as_the_way_out() {
    let r = repo_with_remote("pull-rebase-conflict");
    commit_and_push(&r.other, "a.txt", "theirs\n", "theirs");
    commit_local(&r.dir, "a.txt", "ours\n", "ours");

    let dir = r.dir.to_string_lossy().to_string();
    let (code, _out, err) = run(&["pull", "-C", &dir, "--rebase"]);
    assert_eq!(code, 1);
    assert!(err.contains("git rebase --abort"), "{err:?}");
}

#[test]
fn pull_refuses_a_strategy_it_does_not_have_rather_than_quietly_merging() {
    // The engine falls back to merge for an unknown strategy string. That is
    // right for a caller that has already validated it, and wrong here: a
    // misspelled `--reabse` would silently do the other thing.
    let r = repo_with_remote("pull-bad-strategy");
    let dir = r.dir.to_string_lossy().to_string();

    let (code, _out, err) = run(&["pull", "-C", &dir, "--reabse"]);
    assert_eq!(code, 1);
    assert!(err.contains("--reabse"), "{err:?}");
}

// ----------------------------------------------------------------- push

#[test]
fn push_publishes_the_branch_and_reports_what_the_remote_now_holds() {
    let r = repo_with_remote("push-lands");
    commit_local(&r.dir, "c.txt", "c1\n", "mine");
    let expected = head(&r.dir);

    let dir = r.dir.to_string_lossy().to_string();
    let (code, out, err) = run(&["push", "-C", &dir, "--json"]);
    assert_eq!(code, 0, "stderr: {err}");
    let json = json_of(&out);
    assert_eq!(json["action"], "push");
    assert_eq!(json["commit"], expected);

    // Asked of the remote itself, which is the only place that can confirm it.
    assert_eq!(tracking(&r.origin, "refs/heads/main"), expected);
    assert_eq!(receipt(&r.dir).expect("receipt")["action"], "push");
}

#[test]
fn push_with_nothing_ahead_says_so_rather_than_claiming_a_push() {
    let r = repo_with_remote("push-current");
    let dir = r.dir.to_string_lossy().to_string();

    let (code, out, err) = run(&["push", "-C", &dir]);
    assert_eq!(code, 0, "stderr: {err}");
    assert!(out.contains("up to date"), "{out:?}");
}

#[test]
fn push_refuses_an_unpublished_branch_until_it_is_asked_to_publish_it() {
    let r = repo_with_remote("push-upstream");
    git(&r.dir, &["switch", "-q", "-c", "feat"]);
    commit_local(&r.dir, "c.txt", "c1\n", "mine");

    let dir = r.dir.to_string_lossy().to_string();
    let (code, out, err) = run(&["push", "-C", &dir]);
    assert_eq!(code, 1, "stdout: {out}");
    assert!(err.contains("feat"), "{err:?}");
    assert!(err.contains("glimpse push -u"), "it says how: {err:?}");
    assert!(
        git_out(&r.origin, &["branch", "--list", "feat"])
            .trim()
            .is_empty(),
        "the refusal published nothing"
    );

    // And with the flag it publishes, and records the upstream so the next push
    // needs no flag.
    let (code, out, err) = run(&["push", "-C", &dir, "-u"]);
    assert_eq!(code, 0, "stderr: {err}");
    assert!(out.contains("feat"), "{out:?}");
    assert_eq!(tracking(&r.origin, "refs/heads/feat"), head(&r.dir));
    assert_eq!(
        git_out(
            &r.dir,
            &[
                "rev-parse",
                "--abbrev-ref",
                "--symbolic-full-name",
                "@{upstream}"
            ]
        )
        .trim(),
        "origin/feat"
    );
}

#[test]
fn push_refuses_a_detached_head_because_there_is_no_branch_to_publish() {
    let r = repo_with_remote("push-detached");
    git(&r.dir, &["checkout", "-q", "--detach", "HEAD"]);

    let dir = r.dir.to_string_lossy().to_string();
    let (code, _out, err) = run(&["push", "-C", &dir]);
    assert_eq!(code, 1);
    assert!(err.contains("detached"), "{err:?}");
}

#[test]
fn a_rejected_push_is_a_failure_and_says_what_would_have_answered_it() {
    let r = repo_with_remote("push-rejected");
    commit_and_push(&r.other, "b.txt", "b1\n", "from elsewhere");
    commit_local(&r.dir, "c.txt", "c1\n", "mine");
    let remote_before = tracking(&r.origin, "refs/heads/main");

    let dir = r.dir.to_string_lossy().to_string();
    let (code, out, err) = run(&["push", "-C", &dir]);
    assert_eq!(code, 1, "stdout: {out}");
    assert!(err.contains("glimpse pull"), "{err:?}");
    assert_eq!(
        tracking(&r.origin, "refs/heads/main"),
        remote_before,
        "a rejected push moved nothing"
    );
    assert!(receipt(&r.dir).is_none(), "and told no window it had");
}

#[test]
fn force_is_a_lease_it_still_refuses_to_overwrite_what_it_has_not_seen() {
    // `--force` here is `--force-with-lease`, never the unconditional one. The
    // difference is only visible in this shape: the remote has moved and this
    // repository has not fetched, so even a forced push has to decline.
    let r = repo_with_remote("push-lease");
    commit_and_push(&r.other, "b.txt", "b1\n", "from elsewhere");
    let theirs = head(&r.other);
    commit_local(&r.dir, "c.txt", "c1\n", "mine");

    let dir = r.dir.to_string_lossy().to_string();
    let (code, _out, err) = run(&["push", "-C", &dir, "--force"]);
    assert_eq!(code, 1, "the lease held: {err}");
    assert_eq!(
        tracking(&r.origin, "refs/heads/main"),
        theirs,
        "their commit survived a --force"
    );

    // Once this repository has actually seen their work, the lease is satisfied
    // and the same command overwrites it — which is what the flag is for.
    let (code, _out, err) = run(&["fetch", "-C", &dir]);
    assert_eq!(code, 0, "stderr: {err}");
    let (code, _out, err) = run(&["push", "-C", &dir, "--force"]);
    assert_eq!(code, 0, "stderr: {err}");
    assert_eq!(tracking(&r.origin, "refs/heads/main"), head(&r.dir));
}

// ------------------------------------------------------- shared contract

#[test]
fn every_network_command_answers_a_failure_as_json_when_asked_to() {
    // The `--json` error contract, on the commands that talk to a remote: a
    // caller parsing stdout never meets a second shape for a failure.
    let dir = common::clean_repo("network-json-errors");
    let dir = dir.to_string_lossy().to_string();

    for cmd in ["fetch", "pull", "push"] {
        let (code, out, err) = run(&[cmd, "-C", &dir, "--json"]);
        assert_eq!(code, 1, "`{cmd}` has no remote here: {out}");
        assert!(out.is_empty(), "`{cmd}` wrote to stdout: {out:?}");
        let json = json_of(&err);
        assert!(json.get("error").is_some(), "`{cmd}`: {json}");
    }
}

#[test]
fn a_network_command_takes_its_globals_before_the_word_as_well_as_after_it() {
    let r = repo_with_remote("network-globals");
    let dir = r.dir.to_string_lossy().to_string();

    let (code, out, err) = run(&["--json", "-C", &dir, "fetch"]);
    assert_eq!(code, 0, "stderr: {err}");
    assert_eq!(json_of(&out)["action"], "fetch");
}
