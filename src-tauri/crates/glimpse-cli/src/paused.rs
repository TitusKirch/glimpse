//! The **paused** flows: `rebase`, `bisect` and `resolve`.
//!
//! Every other write command in this CLI is over when it returns. These three
//! are not: they put the repository into a state that outlives the process and
//! that the *next* invocation has to pick up — a rebase stopped on a conflict, a
//! bisect halfway through its bisection, a merge waiting for someone to say
//! which side wins. That is the kind, and it is what this module is separated
//! for, because it changes three things the other groups never have to think
//! about:
//!
//! * **The precondition is a state, not an argument.** `rebase continue` is
//!   meaningless with no rebase paused, and `resolve` is meaningless with no
//!   conflict. Each verb asks the repository what state it is in *first* and
//!   refuses by naming that state, rather than letting git answer a question
//!   the user did not know they were asking.
//! * **Success is not the same as finished.** `git rebase --continue` exits 0
//!   both when the rebase completes and when it advances one commit and stops
//!   on the next conflict. Reporting "rebased" for the second would tell a
//!   script the flow is over while the repository is still mid-flight, so every
//!   verb here reads the state back afterwards and reports *that*.
//! * **Leaving is part of the surface.** A flow that can pause needs a way out
//!   that is as discoverable as the way in, so `rebase abort` and `bisect reset`
//!   are first-class verbs rather than something a reader has to reach for
//!   `git` to do.
//!
//! # `ours` and `theirs` change places in a rebase
//!
//! [`resolve`] takes the side that wins, and the two words do **not** mean the
//! same thing in a rebase as in a merge — git replays your commits *onto* the
//! other branch, so mid-rebase `ours` is the branch being rebased onto and
//! `theirs` is your own commit. That is git's own convention and this command
//! does not invert it (silently redefining the words would be worse than the
//! confusion), but every message that offers the choice says which is which,
//! because getting it backwards throws away the wrong side of the work.

use crate::refs::{conflicted_paths, in_progress, said_what_stopped, short, undo_hint};
use crate::write::{bulleted, listed, Failure, Report};
use glimpse_core::git::Repo;

pub(crate) fn run(cmd: &str, repo: &Repo, rest: &[String]) -> Result<Report, Failure> {
    match cmd {
        "rebase" => rebase(repo, rest),
        "bisect" => bisect(repo, rest),
        "resolve" => resolve(repo, rest),
        // Unreachable: `write::claims` gates this on the same list.
        other => Err(format!("unknown subcommand: {other}").into()),
    }
}

/// Split a paused flow's verb from its arguments, accepting **both** spellings.
///
/// `rebase continue` is this CLI's own shape — every grouped command here is
/// `<group> <verb>`, and that is the spelling `--help` and the README teach.
/// `rebase --continue` is what thirty years of git habit produces, and answering
/// it with `unexpected argument: --continue` would be the same needless refusal
/// that `glimpse -C <dir> status` used to make. So the flag spelling is accepted
/// and maps to the same verb; one is documented, both work.
///
/// Returns `None` when the first word is not a verb at all, which is how
/// [`rebase`] tells `rebase continue` from `rebase <branch>`.
fn verb_of<'a>(rest: &'a [String], verbs: &[&'static str]) -> Option<(&'static str, &'a [String])> {
    let first = rest.first()?.as_str();
    let bare = first.strip_prefix("--").unwrap_or(first);
    let matched = verbs.iter().find(|v| **v == bare)?;
    Some((matched, &rest[1..]))
}

fn no_arguments(args: &[String], usage: &str) -> Result<(), Failure> {
    match args.first() {
        None => Ok(()),
        Some(extra) => Err(format!("glimpse {usage} takes no arguments, got: {extra}").into()),
    }
}

// ---------------------------------------------------------------------------
// rebase
// ---------------------------------------------------------------------------

const REBASE_VERBS: &[&str] = &["continue", "skip", "abort"];

fn rebase(repo: &Repo, rest: &[String]) -> Result<Report, Failure> {
    if let Some((verb, args)) = verb_of(rest, REBASE_VERBS) {
        no_arguments(args, &format!("rebase {verb}"))?;
        return match verb {
            "continue" => rebase_step(repo, "continue"),
            "skip" => rebase_step(repo, "skip"),
            _ => rebase_abort(repo),
        };
    }
    match rest {
        [] => Err(format!(
            "rebase needs a branch to rebase onto, or one of: {}\n\n\
             Run `glimpse --help` for the usage.",
            REBASE_VERBS.join(", ")
        )
        .into()),
        [onto] if !onto.starts_with('-') => rebase_start(repo, onto),
        [other, ..] => Err(format!("unexpected argument: {other}").into()),
    }
}

/// Start a rebase of the current branch onto `onto`.
///
/// The outcome is read back from the repository rather than taken from git's
/// exit code, because "it worked" has three shapes here and only one of them is
/// what the caller asked for: the branch moved, the branch was already there, or
/// the rebase is now paused waiting for a decision.
fn rebase_start(repo: &Repo, onto: &str) -> Result<Report, Failure> {
    refuse_if_paused(repo)?;
    let branch = repo.current_branch().unwrap_or_default();
    let before = repo.resolve_commit("HEAD")?;
    // Resolved before the rebase, because afterwards `onto` may still name the
    // same ref but the range being reported is the one that existed when the
    // command started.
    let base = repo.resolve_commit(onto)?;

    if let Err(e) = repo.rebase(onto) {
        return Err(paused_failure(
            repo,
            "rebase",
            &said_what_stopped("rebase", &e),
        ));
    }
    let now = repo.resolve_commit("HEAD")?;
    if now == before {
        return Ok(Report::new(
            "rebase",
            Vec::new(),
            format!("already up to date with {onto}, nothing to replay"),
        ));
    }
    let replayed = repo.commits_between(&base, "HEAD").unwrap_or_default();
    let detail = format!(
        "rebased {} onto {onto}: {} now at {}",
        if branch.is_empty() { "HEAD" } else { &branch },
        commits(replayed.len()),
        short(&now),
    );
    Ok(Report::new("rebase", replayed, detail).with_commit(now))
}

/// `rebase continue` and `rebase skip` — the two verbs that advance a paused
/// rebase, and which differ only in what they do with the commit it stopped on.
fn rebase_step(repo: &Repo, verb: &str) -> Result<Report, Failure> {
    must_be_paused(repo)?;
    // `continue` with conflicts still unresolved is git's own error, but git
    // answers it by echoing the paths as "needs merge" and then a second error
    // about the index — accurate, and not what a reader needs. The refusal here
    // names the paths and both ways forward, and it happens before the index is
    // touched.
    if verb == "continue" {
        let unresolved = conflicted_paths(repo);
        if !unresolved.is_empty() {
            return Err(format!(
                "the rebase is paused with {} still in conflict:\n{}\n\n\
                 Settle each one — `glimpse resolve <file> --ours|--theirs`, or edit it and \
                 `glimpse stage <file>` — then run `glimpse rebase continue` again. \
                 Mid-rebase, --ours is the branch you are rebasing onto and --theirs is your \
                 own commit.",
                listed(&unresolved),
                bulleted(&unresolved),
            )
            .into());
        }
    }

    let action: &'static str = if verb == "continue" {
        "rebase continue"
    } else {
        "rebase skip"
    };
    let result = if verb == "continue" {
        repo.rebase_continue()
    } else {
        repo.rebase_skip()
    };
    if let Err(e) = result {
        return Err(paused_failure(
            repo,
            action,
            &said_what_stopped("rebase", &e),
        ));
    }

    // Exit 0 does NOT mean the rebase finished: it also means it applied this
    // commit and moved on to the next one, which may itself have stopped. The
    // repository is the only thing that knows which happened.
    let now = repo.resolve_commit("HEAD")?;
    if repo.rebase_in_progress() {
        let stuck = conflicted_paths(repo);
        let where_it_is = match stuck.as_slice() {
            [] => "the rebase advanced and is paused again".to_string(),
            [one] => format!("the rebase advanced and is paused again, on {one}"),
            many => format!(
                "the rebase advanced and is paused again, with unresolved conflicts:\n{}",
                bulleted(many)
            ),
        };
        return Ok(Report::new(
            action,
            stuck,
            format!("{where_it_is} — HEAD is at {}", short(&now)),
        ));
    }
    Ok(Report::new(
        action,
        Vec::new(),
        format!("the rebase finished, HEAD is at {}", short(&now)),
    )
    .with_commit(now))
}

/// Abandon a paused rebase and return to where it started.
///
/// **No `--force`, deliberately**, and it is the one destructive-looking verb in
/// this CLI that does not need one. `--force` is this repo's stand-in for a
/// subject that was never named ([`crate::write`]'s `discard --all`), and there
/// is a subject here: the paused rebase, which is the only thing that exists to
/// abort and which the word `abort` names outright. What it restores is the
/// commit the rebase started from — nothing committed is lost, and git's reflog
/// holds the abandoned attempt either way. The one thing genuinely thrown away
/// is conflict resolution done since the pause, so the report says where it
/// landed rather than answering "done".
fn rebase_abort(repo: &Repo) -> Result<Report, Failure> {
    must_be_paused(repo)?;
    repo.rebase_abort()?;
    // Read back rather than assume: an abort that git accepted but did not
    // complete would otherwise be reported as a clean exit from a state the
    // repository is still in.
    if repo.rebase_in_progress() {
        return Err(
            "git reported no error, but the rebase is still in progress. \
             `glimpse info` shows where it is."
                .into(),
        );
    }
    let branch = repo.current_branch().unwrap_or_default();
    let now = repo.resolve_commit("HEAD")?;
    let detail = if branch.is_empty() || branch == "HEAD" {
        format!("aborted the rebase, back at {}", short(&now))
    } else {
        format!("aborted the rebase, back on {branch} at {}", short(&now))
    };
    Ok(Report::new("rebase abort", Vec::new(), detail).with_commit(now))
}

// ---------------------------------------------------------------------------
// bisect
// ---------------------------------------------------------------------------

const BISECT_VERBS: &[&str] = &["start", "good", "bad", "skip", "reset"];

fn bisect(repo: &Repo, rest: &[String]) -> Result<Report, Failure> {
    let Some((verb, args)) = verb_of(rest, BISECT_VERBS) else {
        return Err(match rest.first() {
            None => format!("bisect needs a verb: {}", BISECT_VERBS.join(", ")).into(),
            Some(other) => format!(
                "unknown bisect verb: {other}\n\nExpected one of: {}",
                BISECT_VERBS.join(", ")
            )
            .into(),
        });
    };
    match verb {
        "start" => bisect_start(repo, args),
        "reset" => {
            no_arguments(args, "bisect reset")?;
            bisect_reset(repo)
        }
        mark => {
            no_arguments(args, &format!("bisect {mark}"))?;
            bisect_mark(repo, mark)
        }
    }
}

fn bisect_start(repo: &Repo, args: &[String]) -> Result<Report, Failure> {
    for a in args {
        if a.starts_with('-') {
            return Err(format!("unexpected argument: {a}").into());
        }
    }
    let [bad, good] = args else {
        return Err("usage: glimpse bisect start <bad> <good>".into());
    };
    // A second `git bisect start` silently restarts the session, throwing away
    // every verdict already given. That is a real loss of work with no way back,
    // and it is exactly the kind of thing this CLI refuses rather than does.
    if repo.bisect_in_progress() {
        return Err("a bisect is already running\n\n\
             Starting another would throw away every verdict given so far. \
             End this one first: glimpse bisect reset."
            .into());
    }
    refuse_if_paused(repo)?;

    let out = repo
        .bisect_start(bad, good)
        .map_err(|e| Failure::from(said_what_stopped("bisect", &e)))?;
    let now = repo.resolve_commit("HEAD")?;
    Ok(Report::new(
        "bisect start",
        vec![now.clone()],
        format!(
            "{} — testing {} now. Say which it is: glimpse bisect good|bad|skip.",
            first_line(&out, "bisect started"),
            short(&now)
        ),
    )
    .with_commit(now))
}

/// Record a verdict on the commit currently checked out and move to the next.
///
/// The interesting outcome is the one that ends the session: git prints
/// `<hash> is the first bad commit`, and that hash — not the commit still
/// checked out — is the answer the caller ran a bisect to get, so it is what
/// the report carries.
fn bisect_mark(repo: &Repo, verdict: &str) -> Result<Report, Failure> {
    must_be_bisecting(repo)?;
    let out = repo
        .bisect_mark(verdict)
        .map_err(|e| Failure::from(said_what_stopped("bisect", &e)))?;

    let action: &'static str = match verdict {
        "good" => "bisect good",
        "bad" => "bisect bad",
        _ => "bisect skip",
    };
    if let Some(culprit) = first_bad_commit(&out) {
        return Ok(Report::new(
            action,
            vec![culprit.clone()],
            format!(
                "{} is the first bad commit. End the session with: glimpse bisect reset.",
                short(&culprit)
            ),
        )
        .with_commit(culprit));
    }
    let now = repo.resolve_commit("HEAD")?;
    Ok(Report::new(
        action,
        vec![now.clone()],
        format!(
            "marked {verdict} — {} now testing {}",
            first_line(&out, "bisecting"),
            short(&now)
        ),
    )
    .with_commit(now))
}

fn bisect_reset(repo: &Repo) -> Result<Report, Failure> {
    must_be_bisecting(repo)?;
    repo.bisect_reset()?;
    if repo.bisect_in_progress() {
        return Err(
            "git reported no error, but the bisect session is still open. \
             `glimpse info` shows where it is."
                .into(),
        );
    }
    let branch = repo.current_branch().unwrap_or_default();
    let now = repo.resolve_commit("HEAD")?;
    let detail = if branch.is_empty() || branch == "HEAD" {
        format!("ended the bisect, back at {}", short(&now))
    } else {
        format!("ended the bisect, back on {branch} at {}", short(&now))
    };
    Ok(Report::new("bisect reset", Vec::new(), detail).with_commit(now))
}

/// `<hash> is the first bad commit`, if that is what git just said.
///
/// Parsed rather than inferred from the exit code because there is no other
/// signal: a verdict that ends the session and one that merely advances it both
/// exit 0, and the difference is the whole point of running a bisect.
fn first_bad_commit(out: &str) -> Option<String> {
    out.lines().find_map(|line| {
        let hash = line.split_whitespace().next()?;
        let rest = line.strip_prefix(hash)?.trim();
        let long_enough = hash.len() >= 7 && hash.chars().all(|c| c.is_ascii_hexdigit());
        (long_enough && rest == "is the first bad commit").then(|| hash.to_string())
    })
}

/// git's own first sentence, used as the human half of a report where it says
/// something this command cannot work out for itself ("Bisecting: 3 revisions
/// left to test after this"). Falls back to `whenever` when git said nothing,
/// so the sentence is never left with a hole in it.
fn first_line(out: &str, whenever: &str) -> String {
    out.lines()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .unwrap_or(whenever)
        .trim_end_matches('.')
        .to_string()
}

// ---------------------------------------------------------------------------
// resolve
// ---------------------------------------------------------------------------

/// Settle conflicted paths by taking one whole side, and stage them.
///
/// **The side is never defaulted.** Which side of a conflict wins is the one
/// decision this CLI will not make on a caller's behalf — it is the same line
/// `discard --all` draws when it refuses mid-merge — so `glimpse resolve a.txt`
/// with no side is a refusal, not a guess.
///
/// The plan is resolved against `status` before anything is written, on
/// `discard`'s reasoning: a path that is not in conflict has no side to take,
/// and finding that out halfway through a list would leave the earlier paths
/// already settled against a command that then failed.
fn resolve(repo: &Repo, rest: &[String]) -> Result<Report, Failure> {
    let mut side: Option<&'static str> = None;
    let mut paths: Vec<String> = Vec::new();
    for a in rest {
        match a.as_str() {
            "--ours" | "--theirs" => {
                let asked = if a == "--ours" { "ours" } else { "theirs" };
                if side.is_some_and(|s| s != asked) {
                    return Err("resolve takes one side: --ours or --theirs, not both.\n\n\
                         To keep parts of each, edit the file and `glimpse stage <file>`."
                        .into());
                }
                side = Some(asked);
            }
            other if other.starts_with('-') => {
                return Err(format!("unexpected argument: {other}").into())
            }
            other => paths.push(other.to_string()),
        }
    }
    if paths.is_empty() {
        return Err("usage: glimpse resolve <file>... --ours|--theirs".into());
    }
    let Some(side) = side else {
        return Err(format!(
            "resolve needs to be told which side wins: --ours or --theirs\n\n\
             {}\n\n\
             To keep parts of each instead, edit the file and `glimpse stage <file>`.",
            sides_mean(repo)
        )
        .into());
    };

    // Plan first: every path has to be in conflict before any of them is
    // settled, so a typo costs nothing at all.
    let status = repo.status()?;
    for p in &paths {
        match status.iter().find(|e| &e.path == p) {
            Some(entry) if entry.conflicted => {}
            Some(_) => {
                return Err(format!(
                    "{p} is not in conflict, so there is no side to take.\n\n\
                     Run `glimpse status` to see which paths are."
                )
                .into())
            }
            None => {
                return Err(format!(
                    "nothing to resolve for {p}\n\nRun `glimpse status` to see what is in conflict."
                )
                .into())
            }
        }
    }

    // A path git refuses outright is *not* returned here. `checkout --theirs` on
    // a modify/delete conflict fails rather than leaving the path unmerged, and
    // propagating that would hand the caller git's raw error, command line and
    // all, before the read-back below — which knows the conflict has no such
    // side and what to do about it — ever ran. So the refusals are held, and the
    // repository gets the last word.
    let mut refused: Vec<String> = Vec::new();
    for p in &paths {
        if let Err(e) = repo.resolve_conflict(p, side) {
            refused.push(e);
        }
    }

    // Read back: `git checkout --ours` can leave a path unmerged in cases it
    // declines to handle (a delete/modify conflict has no `--ours` content),
    // and reporting it settled would send the caller on to `commit` with the
    // conflict still open.
    let left = repo.status()?;
    let still: Vec<String> = paths
        .iter()
        .filter(|p| {
            left.iter()
                .any(|e| &&e.path == p && (e.conflicted || !e.staged))
        })
        .cloned()
        .collect();
    if !still.is_empty() {
        return Err(Failure {
            message: format!(
                "git left {} unresolved, so this command did less than it was asked to:\n{}\n\n\
                 A conflict where one side deleted the file has no `{side}` content to take — \
                 settle it with `glimpse stage <file>` (keep it) or `glimpse discard <file>`.",
                listed(&still),
                bulleted(&still),
            ),
            // Whatever did settle is staged and a running window has to hear
            // about it: reporting nothing would leave it showing conflicts that
            // are gone.
            partial: {
                let done: Vec<String> = paths
                    .iter()
                    .filter(|p| !still.contains(p))
                    .cloned()
                    .collect();
                (!done.is_empty()).then(|| Report::new("resolve", done, String::new()))
            },
        });
    }

    // Every path came out settled and git still complained: not a shape this
    // knows how to explain, so its own words are the honest answer.
    if let Some(first) = refused.first() {
        return Err(first.clone().into());
    }

    let detail = format!(
        "resolved {} to {side} and staged {}",
        listed(&paths),
        if paths.len() == 1 { "it" } else { "them" }
    );
    Ok(Report::new("resolve", paths, detail))
}

/// Which branch `ours` and `theirs` name **in the state the repository is
/// actually in**, since a rebase swaps them round.
///
/// Said rather than assumed, because a caller who reads the merge meaning into
/// a rebase throws away their own commit and keeps the branch they were rebasing
/// onto — a mistake with no undo short of the reflog.
fn sides_mean(repo: &Repo) -> &'static str {
    if repo.rebase_in_progress() {
        "Mid-rebase these are the other way round from a merge: --ours is the branch you are \
         rebasing onto, --theirs is your own commit being replayed."
    } else {
        "--ours is the branch you are on, --theirs is the one being brought in."
    }
}

// ---------------------------------------------------------------------------
// state guards
// ---------------------------------------------------------------------------

/// Refuse to *begin* a paused flow while another operation is still open.
///
/// The sibling of [`crate::refs::refuse_if_open`], kept here because these two
/// commands also have to refuse a bisect — a session that has left HEAD detached
/// halfway through a bisection, where beginning a rebase would record a decision
/// against a commit nobody chose to be on.
fn refuse_if_paused(repo: &Repo) -> Result<(), Failure> {
    if repo.bisect_in_progress() {
        return Err(
            "a bisect session is still open, so HEAD is on a commit git chose, not one you did\n\n\
             End it first: glimpse bisect reset."
                .into(),
        );
    }
    crate::refs::refuse_if_open(repo)
}

fn must_be_paused(repo: &Repo) -> Result<(), Failure> {
    if repo.rebase_in_progress() {
        return Ok(());
    }
    Err(format!(
        "there is no rebase in progress\n\n\
         Start one with `glimpse rebase <branch>`.{}",
        match in_progress(repo) {
            Some(other) => format!(
                " A {other} is open, though — finish it, or undo it with `{}`.",
                undo_hint(other)
            ),
            None => String::new(),
        }
    )
    .into())
}

fn must_be_bisecting(repo: &Repo) -> Result<(), Failure> {
    if repo.bisect_in_progress() {
        return Ok(());
    }
    Err("there is no bisect session running\n\n\
         Start one with `glimpse bisect start <bad> <good>`."
        .into())
}

/// How a paused flow failed — **asked of the repository**, like
/// [`crate::refs`]'s equivalent, because git's exit code says only that it
/// stopped and not what it left behind.
///
/// A rebase that stops on a conflict is not an error the caller should undo; it
/// is the flow working, waiting for a decision. So the message names where it
/// stopped and the three ways on, rather than reading as a failure with no
/// remedy.
fn paused_failure(repo: &Repo, action: &'static str, reason: &str) -> Failure {
    if !repo.rebase_in_progress() {
        return reason.into();
    }
    let stuck = conflicted_paths(repo);
    let where_it_is = match stuck.as_slice() {
        [] => "The rebase is paused.".to_string(),
        [one] => format!("The rebase is paused, with {one} in conflict."),
        many => format!(
            "The rebase is paused, with unresolved conflicts:\n{}",
            bulleted(many)
        ),
    };
    Failure {
        message: format!(
            "{reason}\n\n{where_it_is}\n\n\
             {}\n\n\
             Settle each path (`glimpse resolve <file> --ours|--theirs`, or edit it and \
             `glimpse stage <file>`) then `glimpse rebase continue` — or `glimpse rebase skip` \
             to drop the commit it stopped on, or `glimpse rebase abort` to put everything back.",
            sides_mean(repo)
        ),
        // The rebase has already rewritten part of the history and checked out a
        // tree with conflict markers in it, so a window open on the repository
        // is showing something that is no longer true.
        partial: Some(Report::new(action, stuck, String::new())),
    }
}

fn commits(n: usize) -> String {
    if n == 1 {
        "1 commit".to_string()
    } else {
        format!("{n} commits")
    }
}

#[cfg(test)]
mod tests {
    use super::{first_bad_commit, first_line, verb_of};

    fn argv(parts: &[&str]) -> Vec<String> {
        parts.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn a_verb_is_recognised_in_both_the_glimpse_and_the_git_spelling() {
        let verbs = &["continue", "skip", "abort"];
        for spelling in ["continue", "--continue"] {
            let written = argv(&[spelling]);
            let (verb, rest) = verb_of(&written, verbs).expect(spelling);
            assert_eq!(verb, "continue");
            assert!(rest.is_empty());
        }
        // A branch name is not a verb, which is how `rebase main` stays a start.
        assert!(verb_of(&argv(&["main"]), verbs).is_none());
        assert!(verb_of(&argv(&["--onto"]), verbs).is_none());
        assert!(verb_of(&argv(&[]), verbs).is_none());
    }

    #[test]
    fn the_first_bad_commit_is_read_off_gits_own_sentence() {
        let out = "8b1a9953c4611296a827abf8c47804d7 is the first bad commit\n\
                   commit 8b1a9953c4611296a827abf8c47804d7\n";
        assert_eq!(
            first_bad_commit(out).as_deref(),
            Some("8b1a9953c4611296a827abf8c47804d7")
        );

        // The line that merely advances the bisection must NOT read as an answer.
        assert!(first_bad_commit("Bisecting: 3 revisions left to test after this").is_none());
        // Nor a commit subject that happens to contain the phrase.
        assert!(
            first_bad_commit("commit abc1234 fix: describe which is the first bad commit")
                .is_none(),
            "the hash has to be the whole first word and the rest the whole sentence"
        );
    }

    #[test]
    fn gits_own_sentence_is_used_where_it_has_one_and_replaced_where_it_does_not() {
        assert_eq!(
            first_line(
                "Bisecting: 3 revisions left to test after this.\n[abc] x",
                "fallback"
            ),
            "Bisecting: 3 revisions left to test after this"
        );
        assert_eq!(first_line("   \n\n", "fallback"), "fallback");
    }
}
