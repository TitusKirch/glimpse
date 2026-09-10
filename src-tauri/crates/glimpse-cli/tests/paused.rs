//! End-to-end cover for the headless command line's **paused flows** —
//! `rebase`, `bisect` and `resolve`.
//!
//! Same bar as the other write suites: every case runs against a real
//! repository and asserts the outcome with `git` itself rather than through the
//! code under test. What this group adds is that the thing under test is a
//! **state that outlives the process**, so most cases here are two or three
//! invocations in a row — which is the only way to find out whether the first
//! one left the repository in a shape the second can pick up.

mod common;

use common::{
    bisectable, clean_repo, git, git_out, json_of, merged_over_a_deletion, merged_with_conflict,
    paused_on_break, paused_on_failed_exec, rebase_that_conflicts, receipt, run,
};

/// Is a rebase paused, asked of git rather than of the CLI under test?
///
/// The sequencer's state directory rather than `REBASE_HEAD`, because that ref
/// is set only when the rebase stops *on a commit* — a `break` and a failed
/// `exec` are just as paused and set nothing. These fixtures are always local,
/// so the test may read the path directly; the engine may not, and asks git.
fn rebasing(dir: &std::path::Path) -> bool {
    let git_dir = git_out(dir, &["rev-parse", "--absolute-git-dir"]);
    let git_dir = std::path::Path::new(git_dir.trim());
    git_dir.join("rebase-merge").exists() || git_dir.join("rebase-apply").exists()
}

// ---------------------------------------------------------------------------
// rebase
// ---------------------------------------------------------------------------

#[test]
fn rebase_replays_the_branch_and_reports_what_it_moved() {
    let dir = clean_repo("rebase-clean");
    let path = dir.to_str().unwrap();
    // A branch off the first commit that touches a *different* file, so the
    // replay is clean and the only question is what gets reported.
    git(&dir, &["switch", "-q", "-c", "side", "HEAD~1"]);
    std::fs::write(dir.join("b.txt"), "b1\n").unwrap();
    git(&dir, &["add", "-A"]);
    git(&dir, &["commit", "-q", "-m", "side"]);

    let (code, out, err) = run(&["rebase", "-C", path, "main", "--json"]);
    assert_eq!(code, 0, "stderr: {err}");
    let r = json_of(&out);
    assert_eq!(r["action"], "rebase");
    // One commit was replayed — the branch's own, not main's.
    assert_eq!(r["paths"].as_array().unwrap().len(), 1);
    assert!(
        r["detail"].as_str().unwrap().contains("side"),
        "the branch is named: {r}"
    );

    // Asserted with git: `side` now sits on top of `main`.
    let base = git_out(&dir, &["merge-base", "side", "main"]);
    let main = git_out(&dir, &["rev-parse", "main"]);
    assert_eq!(base.trim(), main.trim(), "side was replayed onto main");
    assert!(!rebasing(&dir), "nothing is left paused");

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_rebase_with_nothing_to_replay_says_so_rather_than_claiming_work() {
    let dir = clean_repo("rebase-uptodate");
    let path = dir.to_str().unwrap();
    let before = git_out(&dir, &["rev-parse", "HEAD"]).trim().to_string();

    let (code, out, err) = run(&["rebase", "-C", path, "HEAD"]);
    assert_eq!(code, 0, "stderr: {err}");
    assert!(out.contains("up to date"), "{out:?}");
    assert_eq!(
        git_out(&dir, &["rev-parse", "HEAD"]).trim(),
        before,
        "HEAD did not move"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_conflicting_rebase_pauses_and_names_all_three_ways_out() {
    let dir = rebase_that_conflicts("rebase-conflict");
    let path = dir.to_str().unwrap();

    let (code, _out, err) = run(&["rebase", "-C", path, "main"]);
    assert_eq!(code, 1, "a paused rebase is not a success");
    assert!(rebasing(&dir), "the rebase really is paused");
    assert!(
        err.contains("a.txt"),
        "the conflicted path is named: {err:?}"
    );
    for way_out in ["rebase continue", "rebase skip", "rebase abort"] {
        assert!(err.contains(way_out), "`{way_out}` is offered: {err:?}");
    }
    // And the sides are explained in the state the repository is actually in —
    // mid-rebase, where they are the other way round from a merge.
    assert!(
        err.contains("--ours is the branch you are rebasing onto"),
        "the rebase meaning of --ours is spelled out: {err:?}"
    );

    // A window open on this repository has to hear about it: the tree now holds
    // conflict markers that were not there a moment ago.
    let receipt = receipt(&dir).expect("a paused rebase leaves a receipt");
    assert_eq!(receipt["action"], "rebase");

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn rebase_continue_refuses_while_a_path_is_still_in_conflict() {
    let dir = rebase_that_conflicts("rebase-continue-refuse");
    let path = dir.to_str().unwrap();
    let (_code, _out, _err) = run(&["rebase", "-C", path, "main"]);

    let (code, out, err) = run(&["rebase", "-C", path, "continue"]);
    assert_eq!(code, 1, "stdout: {out:?}");
    assert!(err.contains("a.txt"), "{err:?}");
    assert!(err.contains("glimpse resolve"), "{err:?}");
    assert!(rebasing(&dir), "the refusal changed nothing");

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn resolve_then_continue_carries_the_rebase_to_the_end() {
    // The whole point of the group: three invocations, each picking up a state
    // the previous one left behind.
    let dir = rebase_that_conflicts("rebase-full-flow");
    let path = dir.to_str().unwrap();
    let (_code, _out, _err) = run(&["rebase", "-C", path, "main"]);

    // Mid-rebase `--theirs` is the commit being replayed, i.e. side's own work.
    let (code, out, err) = run(&["resolve", "-C", path, "a.txt", "--theirs"]);
    assert_eq!(code, 0, "stderr: {err}");
    assert!(out.contains("theirs"), "{out:?}");
    assert_eq!(
        std::fs::read_to_string(dir.join("a.txt")).unwrap(),
        "side\n",
        "--theirs took the commit being replayed, which is side's"
    );

    let (code, out, err) = run(&["rebase", "-C", path, "continue", "--json"]);
    assert_eq!(code, 0, "stderr: {err}");
    let r = json_of(&out);
    assert_eq!(r["action"], "rebase continue");
    assert!(
        r["detail"].as_str().unwrap().contains("finished"),
        "it reports the rebase as over, not merely advanced: {r}"
    );

    assert!(!rebasing(&dir), "the rebase really finished");
    // Both of side's commits are on top of main, in order.
    let log = git_out(&dir, &["log", "--format=%s", "main..HEAD"]);
    assert_eq!(
        log.lines().collect::<Vec<_>>(),
        vec!["side touches z", "side touches a"],
        "{log:?}"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn rebase_skip_drops_the_commit_it_stopped_on_and_keeps_the_rest() {
    let dir = rebase_that_conflicts("rebase-skip");
    let path = dir.to_str().unwrap();
    let (_code, _out, _err) = run(&["rebase", "-C", path, "main"]);

    let (code, out, err) = run(&["rebase", "-C", path, "skip"]);
    assert_eq!(code, 0, "stderr: {err}");
    assert!(out.contains("finished"), "{out:?}");
    assert!(!rebasing(&dir));

    let log = git_out(&dir, &["log", "--format=%s", "main..HEAD"]);
    assert_eq!(
        log.lines().collect::<Vec<_>>(),
        vec!["side touches z"],
        "the conflicting commit was dropped, the other kept: {log:?}"
    );
    // And main's version of the file survived, since side's was skipped.
    assert_eq!(
        std::fs::read_to_string(dir.join("a.txt")).unwrap(),
        "main\n"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn rebase_abort_puts_the_branch_back_where_it_started() {
    let dir = rebase_that_conflicts("rebase-abort");
    let path = dir.to_str().unwrap();
    let before = git_out(&dir, &["rev-parse", "side"]).trim().to_string();
    let (_code, _out, _err) = run(&["rebase", "-C", path, "main"]);
    assert!(rebasing(&dir));

    // No --force: the paused rebase IS the named subject, and what this
    // restores is the commit the rebase started from.
    let (code, out, err) = run(&["rebase", "-C", path, "abort"]);
    assert_eq!(code, 0, "stderr: {err}");
    assert!(out.contains("side"), "the branch it returned to: {out:?}");

    assert!(!rebasing(&dir), "the rebase is gone");
    assert_eq!(
        git_out(&dir, &["rev-parse", "side"]).trim(),
        before,
        "the branch is exactly where it was"
    );
    assert_eq!(
        std::fs::read_to_string(dir.join("a.txt")).unwrap(),
        "side\n"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn the_git_flag_spellings_of_the_rebase_verbs_work_too() {
    let dir = rebase_that_conflicts("rebase-flag-spelling");
    let path = dir.to_str().unwrap();
    let (_code, _out, _err) = run(&["rebase", "-C", path, "main"]);

    // `--continue` is thirty years of habit; refusing it would be a refusal
    // over nothing. It has to reach the same verb, refusal included.
    let (code, _out, err) = run(&["rebase", "-C", path, "--continue"]);
    assert_eq!(code, 1, "{err:?}");
    assert!(err.contains("a.txt"), "it reached the verb: {err:?}");

    let (code, out, err) = run(&["rebase", "-C", path, "--abort"]);
    assert_eq!(code, 0, "stderr: {err}");
    assert!(out.contains("aborted"), "{out:?}");
    assert!(!rebasing(&dir));

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn the_rebase_verbs_refuse_when_there_is_no_rebase_to_pick_up() {
    let dir = clean_repo("rebase-none");
    let path = dir.to_str().unwrap();
    for verb in ["continue", "skip", "abort"] {
        let (code, out, err) = run(&["rebase", "-C", path, verb]);
        assert_eq!(code, 1, "`{verb}` with no rebase: stdout {out:?}");
        assert!(err.contains("no rebase in progress"), "{err:?}");
    }
    // And a bare `rebase` names what it needs rather than guessing a branch.
    let (code, _out, err) = run(&["rebase", "-C", path]);
    assert_eq!(code, 1);
    assert!(
        err.contains("continue") && err.contains("branch"),
        "{err:?}"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_rebase_verb_mid_merge_points_at_the_operation_that_is_actually_open() {
    // The trap this closes: "there is no rebase in progress" is true and
    // useless when the reason is that a *merge* is sitting there instead.
    let dir = merged_with_conflict("rebase-during-merge");
    let path = dir.to_str().unwrap();

    let (code, _out, err) = run(&["rebase", "-C", path, "continue"]);
    assert_eq!(code, 1);
    assert!(
        err.contains("merge"),
        "the open operation is named: {err:?}"
    );

    // And starting a rebase on top of the merge is refused outright.
    let (code, _out, err) = run(&["rebase", "-C", path, "other"]);
    assert_eq!(code, 1);
    assert!(err.contains("merge is still in progress"), "{err:?}");

    let _ = std::fs::remove_dir_all(&dir);
}

// ---------------------------------------------------------------------------
// the carried-forward REBASE_HEAD gap
// ---------------------------------------------------------------------------

#[test]
fn discard_all_refuses_mid_rebase_instead_of_settling_it_on_ours() {
    // Carried forward from three review rounds: `discard --all --force` gated
    // on merge / cherry-pick / revert but not on REBASE_HEAD, so mid-rebase it
    // took every conflict to *ours*, threw the other side away and left the
    // rebase open behind a `status` that read clean.
    let dir = rebase_that_conflicts("discard-mid-rebase");
    let path = dir.to_str().unwrap();
    let (_code, _out, _err) = run(&["rebase", "-C", path, "main"]);
    assert!(rebasing(&dir));

    let (code, out, err) = run(&["discard", "-C", path, "--all", "--force"]);
    assert_eq!(code, 1, "stdout: {out:?}");
    assert!(err.contains("rebase"), "the state is named: {err:?}");
    assert!(
        err.contains("glimpse rebase abort"),
        "and the way out is glimpse's own verb, not git's: {err:?}"
    );

    // Nothing was destroyed behind the refusal: the rebase is still paused and
    // the conflict is still there to settle.
    assert!(rebasing(&dir), "the rebase is still open");
    let status = git_out(&dir, &["status", "--porcelain"]);
    assert!(
        status.contains("a.txt"),
        "the conflict survived: {status:?}"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn rebase_abort_ends_a_rebase_paused_on_a_break() {
    // A `break` stop sets no `REBASE_HEAD`, and the probe behind `must_be_paused`
    // used to ask for nothing else — so `glimpse rebase abort` answered "there
    // is no rebase in progress" in a state glimpse's own rebase dialog produces.
    let dir = paused_on_break("rebase-abort-break");
    let path = dir.to_str().unwrap();
    assert!(rebasing(&dir), "the fixture really is paused");
    assert!(
        git_out(&dir, &["rev-parse", "--verify", "--quiet", "REBASE_HEAD"])
            .trim()
            .is_empty(),
        "the premise: a break stop sets no REBASE_HEAD"
    );

    let (code, out, err) = run(&["rebase", "-C", path, "abort", "--json"]);
    assert_eq!(code, 0, "stderr: {err}");
    let r = json_of(&out);
    assert_eq!(r["action"], "rebase abort");
    assert!(!rebasing(&dir), "and the rebase really is over");
    assert_eq!(
        git_out(&dir, &["rev-parse", "--abbrev-ref", "HEAD"]).trim(),
        "main",
        "back on the branch it started from"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn rebase_continue_carries_on_from_a_failed_exec() {
    // The other `REBASE_HEAD`-less stop — and the one glimpse writes itself, as
    // `exec … --amend --file=…` for every reword. `continue` is the documented
    // way past a failed exec, and it was refused here for the same reason.
    let dir = paused_on_failed_exec("rebase-continue-exec");
    let path = dir.to_str().unwrap();
    assert!(rebasing(&dir), "the fixture really is paused");

    let (code, out, err) = run(&["rebase", "-C", path, "continue", "--json"]);
    assert_eq!(code, 0, "stderr: {err}");
    let r = json_of(&out);
    assert_eq!(r["action"], "rebase continue");
    assert!(!rebasing(&dir), "the rebase finished");
    assert_eq!(
        git_out(&dir, &["log", "--oneline"]).lines().count(),
        2,
        "and both commits are still there"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn info_reports_a_rebase_that_stopped_without_setting_rebase_head() {
    // `glimpse info` is where a caller looks to find out what state they are in,
    // and it reads the same probe. Reporting `rebaseInProgress: false` mid-rebase
    // is the answer that sends the next command wrong.
    let dir = paused_on_break("info-break");
    let path = dir.to_str().unwrap();

    let (code, out, err) = run(&["info", "-C", path, "--json"]);
    assert_eq!(code, 0, "stderr: {err}");
    assert_eq!(json_of(&out)["rebaseInProgress"], true);

    let (code, out, err) = run(&["info", "-C", path]);
    assert_eq!(code, 0, "stderr: {err}");
    assert!(
        out.contains("In progress: rebase"),
        "and a human is told too: {out:?}"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

// ---------------------------------------------------------------------------
// bisect
// ---------------------------------------------------------------------------

/// Is a bisect session open, asked of git rather than of the CLI under test?
fn bisecting(dir: &std::path::Path) -> bool {
    std::process::Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(["bisect", "log"])
        .output()
        .expect("run git")
        .status
        .success()
}

#[test]
fn bisect_start_checks_out_a_commit_to_test_and_says_what_to_do_next() {
    let dir = bisectable("bisect-start");
    let path = dir.to_str().unwrap();
    let tip = git_out(&dir, &["rev-parse", "HEAD"]).trim().to_string();
    let root = git_out(&dir, &["rev-parse", "HEAD~4"]).trim().to_string();

    let (code, out, err) = run(&["bisect", "-C", path, "start", &tip, &root, "--json"]);
    assert_eq!(code, 0, "stderr: {err}");
    let r = json_of(&out);
    assert_eq!(r["action"], "bisect start");
    assert!(
        r["detail"].as_str().unwrap().contains("bisect good"),
        "the next step is spelled out: {r}"
    );

    assert!(bisecting(&dir), "a session really is open");
    // The commit reported is the one now checked out, between the two ends.
    let now = git_out(&dir, &["rev-parse", "HEAD"]).trim().to_string();
    assert_eq!(r["commit"], now);
    assert_ne!(now, tip, "it moved off the bad tip to test something");

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_bisect_names_the_first_bad_commit_when_it_finds_it() {
    let dir = bisectable("bisect-find");
    let path = dir.to_str().unwrap();
    let tip = git_out(&dir, &["rev-parse", "HEAD"]).trim().to_string();
    let root = git_out(&dir, &["rev-parse", "HEAD~4"]).trim().to_string();
    // "commit 4" is where it went wrong, so 1-3 are good and 4-5 are bad.
    let culprit = git_out(&dir, &["rev-parse", "HEAD~1"]).trim().to_string();

    run(&["bisect", "-C", path, "start", &tip, &root]);
    let mut answer: Option<String> = None;
    for _ in 0..5 {
        let now = git_out(&dir, &["rev-parse", "HEAD"]).trim().to_string();
        let good = git_out(&dir, &["merge-base", "--is-ancestor", &now, &culprit]).is_empty()
            && std::process::Command::new("git")
                .arg("-C")
                .arg(&dir)
                .args(["merge-base", "--is-ancestor", &culprit, &now])
                .output()
                .expect("run git")
                .status
                .code()
                != Some(0);
        let verdict = if good { "good" } else { "bad" };
        let (code, out, err) = run(&["bisect", "-C", path, verdict, "--json"]);
        assert_eq!(code, 0, "stderr: {err}");
        let r = json_of(&out);
        if r["detail"]
            .as_str()
            .unwrap()
            .contains("is the first bad commit")
        {
            answer = Some(r["commit"].as_str().unwrap().to_string());
            break;
        }
    }
    assert_eq!(
        answer.as_deref(),
        Some(culprit.as_str()),
        "the bisect named the commit that actually broke it"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn bisect_reset_ends_the_session_and_returns_to_the_branch() {
    let dir = bisectable("bisect-reset");
    let path = dir.to_str().unwrap();
    let tip = git_out(&dir, &["rev-parse", "HEAD"]).trim().to_string();
    let root = git_out(&dir, &["rev-parse", "HEAD~4"]).trim().to_string();
    run(&["bisect", "-C", path, "start", &tip, &root]);
    assert!(bisecting(&dir));

    let (code, out, err) = run(&["bisect", "-C", path, "reset"]);
    assert_eq!(code, 0, "stderr: {err}");
    assert!(out.contains("main"), "the branch it returned to: {out:?}");

    assert!(!bisecting(&dir), "the session is closed");
    assert_eq!(
        git_out(&dir, &["rev-parse", "--abbrev-ref", "HEAD"]).trim(),
        "main"
    );
    assert_eq!(git_out(&dir, &["rev-parse", "HEAD"]).trim(), tip);

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_second_bisect_start_is_refused_rather_than_throwing_the_verdicts_away() {
    let dir = bisectable("bisect-restart");
    let path = dir.to_str().unwrap();
    let tip = git_out(&dir, &["rev-parse", "HEAD"]).trim().to_string();
    let root = git_out(&dir, &["rev-parse", "HEAD~4"]).trim().to_string();
    run(&["bisect", "-C", path, "start", &tip, &root]);
    run(&["bisect", "-C", path, "good"]);
    let log_before = git_out(&dir, &["bisect", "log"]);

    let (code, _out, err) = run(&["bisect", "-C", path, "start", &tip, &root]);
    assert_eq!(code, 1);
    assert!(err.contains("already running"), "{err:?}");
    assert!(err.contains("bisect reset"), "the way out: {err:?}");
    assert_eq!(
        git_out(&dir, &["bisect", "log"]),
        log_before,
        "the verdicts already given survived the refusal"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn the_bisect_verbs_refuse_with_no_session_running() {
    let dir = bisectable("bisect-none");
    let path = dir.to_str().unwrap();
    for verb in ["good", "bad", "skip", "reset"] {
        let (code, out, err) = run(&["bisect", "-C", path, verb]);
        assert_eq!(code, 1, "`{verb}` with no session: stdout {out:?}");
        assert!(err.contains("no bisect session"), "{err:?}");
    }
    let (code, _out, err) = run(&["bisect", "-C", path]);
    assert_eq!(code, 1);
    assert!(err.contains("start"), "the verbs are named: {err:?}");

    let (code, _out, err) = run(&["bisect", "-C", path, "frobnicate"]);
    assert_eq!(code, 1);
    assert!(err.contains("unknown bisect verb"), "{err:?}");

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_running_bisect_blocks_starting_a_rebase() {
    // HEAD is on a commit git chose, not one the user did, so a rebase begun
    // here would replay onto something nobody picked.
    let dir = bisectable("bisect-blocks-rebase");
    let path = dir.to_str().unwrap();
    let tip = git_out(&dir, &["rev-parse", "HEAD"]).trim().to_string();
    let root = git_out(&dir, &["rev-parse", "HEAD~4"]).trim().to_string();
    run(&["bisect", "-C", path, "start", &tip, &root]);

    let (code, _out, err) = run(&["rebase", "-C", path, "main"]);
    assert_eq!(code, 1);
    assert!(err.contains("bisect"), "{err:?}");
    assert!(err.contains("glimpse bisect reset"), "the way out: {err:?}");
    assert!(bisecting(&dir), "the refusal changed nothing");

    let _ = std::fs::remove_dir_all(&dir);
}

// ---------------------------------------------------------------------------
// resolve
// ---------------------------------------------------------------------------

#[test]
fn resolve_takes_the_side_it_is_told_and_stages_the_result() {
    let dir = merged_with_conflict("resolve-ours");
    let path = dir.to_str().unwrap();

    let (code, out, err) = run(&["resolve", "-C", path, "a.txt", "--ours", "--json"]);
    assert_eq!(code, 0, "stderr: {err}");
    let r = json_of(&out);
    assert_eq!(r["action"], "resolve");
    assert_eq!(r["paths"][0], "a.txt");

    // In a merge, ours is the branch we are on.
    assert_eq!(
        std::fs::read_to_string(dir.join("a.txt")).unwrap(),
        "ours\n"
    );
    // Asked of the index rather than of `status`: taking *ours* restores exactly
    // what HEAD holds, so the path leaves `status` altogether — which is the
    // resolved-and-staged state, and would read as "nothing happened" if the
    // assertion looked there.
    assert!(
        git_out(&dir, &["ls-files", "-u", "--", "a.txt"]).is_empty(),
        "no unmerged stages are left in the index"
    );
    assert!(
        git_out(&dir, &["diff", "--name-only", "--", "a.txt"]).is_empty(),
        "and nothing is left unstaged in the working tree"
    );

    // And a window open on the repository is told.
    let receipt = receipt(&dir).expect("a successful resolve leaves a receipt");
    assert_eq!(receipt["action"], "resolve");

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn resolve_theirs_takes_the_other_side() {
    let dir = merged_with_conflict("resolve-theirs");
    let path = dir.to_str().unwrap();

    let (code, _out, err) = run(&["resolve", "-C", path, "a.txt", "--theirs"]);
    assert_eq!(code, 0, "stderr: {err}");
    assert_eq!(
        std::fs::read_to_string(dir.join("a.txt")).unwrap(),
        "theirs\n"
    );

    // The whole merge can now be concluded, which is the point of resolving.
    let (code, _out, err) = run(&["commit", "-C", path, "-m", "merged"]);
    assert_eq!(code, 0, "stderr: {err}");

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn resolve_never_picks_a_side_for_you() {
    // Which side of a conflict wins is the one decision this command line will
    // not make on a caller's behalf — the same line `discard --all` draws.
    let dir = merged_with_conflict("resolve-no-side");
    let path = dir.to_str().unwrap();

    let (code, out, err) = run(&["resolve", "-C", path, "a.txt"]);
    assert_eq!(code, 1, "stdout: {out:?}");
    assert!(
        err.contains("--ours") && err.contains("--theirs"),
        "{err:?}"
    );
    // Mid-merge, the sides are explained the merge way round.
    assert!(
        err.contains("--ours is the branch you are on"),
        "the merge meaning of the sides: {err:?}"
    );

    // Nothing was touched.
    let status = git_out(&dir, &["status", "--porcelain", "--", "a.txt"]);
    assert!(status.starts_with("UU"), "still unmerged: {status:?}");

    // Both sides at once is a refusal too, not a last-one-wins.
    let (code, _out, err) = run(&["resolve", "-C", path, "a.txt", "--ours", "--theirs"]);
    assert_eq!(code, 1);
    assert!(err.contains("not both"), "{err:?}");

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn resolve_settles_nothing_when_one_of_its_paths_is_not_in_conflict() {
    // Plan-first, on `discard`'s reasoning: finding out halfway through would
    // leave the earlier paths settled against a command that then failed.
    let dir = merged_with_conflict("resolve-plan-first");
    let path = dir.to_str().unwrap();

    let (code, _out, err) = run(&["resolve", "-C", path, "a.txt", "z.txt", "--ours"]);
    assert_eq!(code, 1);
    assert!(
        err.contains("z.txt"),
        "the offending path is named: {err:?}"
    );

    let status = git_out(&dir, &["status", "--porcelain", "--", "a.txt"]);
    assert!(
        status.starts_with("UU"),
        "a.txt was not settled behind the refusal: {status:?}"
    );

    // A path that is not in the repository at all is refused just as plainly.
    let (code, _out, err) = run(&["resolve", "-C", path, "nope.txt", "--ours"]);
    assert_eq!(code, 1);
    assert!(err.contains("nope.txt"), "{err:?}");

    // And with no path at all it names the usage rather than assuming "all".
    let (code, _out, err) = run(&["resolve", "-C", path, "--ours"]);
    assert_eq!(code, 1);
    assert!(err.contains("usage"), "{err:?}");

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_failure_in_a_paused_flow_is_json_when_json_was_asked_for() {
    // The contract every command owes: a `--json` caller never has to handle a
    // second shape for errors.
    let dir = clean_repo("paused-json-errors");
    let path = dir.to_str().unwrap();

    for args in [
        vec!["rebase", "-C", path, "continue", "--json"],
        vec!["bisect", "-C", path, "good", "--json"],
        vec!["resolve", "-C", path, "a.txt", "--ours", "--json"],
    ] {
        let (code, out, err) = run(&args);
        assert_eq!(code, 1, "{args:?}");
        assert!(out.is_empty(), "nothing on stdout: {out:?}");
        let e = json_of(&err);
        assert!(e["error"].is_string(), "{args:?} -> {err:?}");
    }

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn resolve_theirs_on_a_deleted_side_explains_itself_rather_than_echoing_git() {
    // A modify/delete conflict has no `theirs` content to check out, so git's
    // own `checkout --theirs` fails outright — and that failure used to be
    // returned as it came, command line and all, before the read-back that
    // knows how to say what happened could run. The read-back is the answer
    // here, not a fallback.
    let dir = merged_over_a_deletion("resolve-theirs-deleted");
    let path = dir.to_str().unwrap();

    let (code, out, err) = run(&["resolve", "-C", path, "a.txt", "--theirs"]);
    assert_eq!(code, 1, "stdout: {out:?}");
    assert!(
        err.contains("deleted the file"),
        "the shape of the conflict is named: {err:?}"
    );
    assert!(
        err.contains("glimpse stage") && err.contains("glimpse discard"),
        "and both ways out are offered: {err:?}"
    );
    assert!(
        !err.contains("$ git "),
        "git's own command line is not the answer: {err:?}"
    );

    // Nothing was settled, so the conflict is still there to settle.
    assert!(
        git_out(&dir, &["status", "--porcelain"]).contains("a.txt"),
        "the path is still unresolved"
    );

    let _ = std::fs::remove_dir_all(&dir);
}
