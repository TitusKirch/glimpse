//! The network commands: `fetch`, `pull` and `push`.
//!
//! They share [`write`](crate::write)'s contract — one [`Report`], `--json`,
//! `-C`, a best-effort receipt for a running window — and are kept apart from it
//! and from [`refs`](crate::refs) because their **subject is a remote**, which
//! changes three things:
//!
//! * **The other side can decline, and does so late.** A push is the only write
//!   here whose refusal arrives from a process on another machine, after the
//!   local repository has already been asked. So what these commands report is
//!   read back from the ref store *after* git has spoken: the remote-tracking
//!   refs for `fetch`, `HEAD` for `pull`, the upstream ref for `push`. Never the
//!   arguments, and never git's own progress chatter — that goes to stderr, has
//!   changed shape between git versions and is localised, so parsing it would be
//!   guessing at exactly the moment accuracy matters.
//! * **"Nothing happened" is a success, and has to say so.** `git fetch` with no
//!   remote configured exits 0 having done nothing, which a script reads as "you
//!   are up to date". Every command here either names what moved or says plainly
//!   that nothing did — and refuses outright where there was nothing it *could*
//!   have done.
//! * **A stopped pull is not a stopped pull.** It is a stopped merge or a
//!   stopped rebase, and the way out is named after whichever one ran: there is
//!   no `git pull --abort`, so a message offering one would strand the reader at
//!   the exact moment they need a working instruction.

use crate::refs::{conflicted_paths, in_progress, refuse_if_open, said_what_stopped, short};
use crate::write::{bulleted, Failure, Report};
use glimpse_core::git::Repo;

pub(crate) fn run(cmd: &str, repo: &Repo, rest: &[String]) -> Result<Report, Failure> {
    match cmd {
        "fetch" => fetch(repo, rest),
        "pull" => pull(repo, rest),
        "push" => push(repo, rest),
        // Unreachable: `write::claims` gates this on the same list.
        other => Err(format!("unknown subcommand: {other}").into()),
    }
}

/// Update every remote-tracking ref, and report the ones that actually moved.
fn fetch(repo: &Repo, args: &[String]) -> Result<Report, Failure> {
    if let Some(a) = args.first() {
        return Err(format!("unexpected argument: {a}\n\nglimpse fetch takes none.").into());
    }
    needs_a_remote(repo, "fetch from")?;

    let before = repo.remote_tips()?;
    repo.fetch()?;
    let after = repo.remote_tips()?;

    let moved = moved_refs(&before, &after);
    let pruned = pruned_refs(&before, &after);
    let detail = match (moved.as_slice(), pruned.len()) {
        ([], 0) => "fetched: every remote-tracking branch was already up to date".to_string(),
        ([], n) => format!("fetched: nothing moved, {} gone from the remote", refs(n)),
        (m, 0) => format!("fetched: {} updated", refs(m.len())),
        (m, n) => format!(
            "fetched: {} updated, {} gone from the remote",
            refs(m.len()),
            refs(n)
        ),
    };
    // The names go in the report body as well as in `paths`, because the human
    // form is a single line and "3 refs updated" without them sends the reader
    // to a second command to find out which.
    let detail = match moved.as_slice() {
        [] => detail,
        names => format!("{detail}\n{}", bulleted(names)),
    };
    Ok(Report::new("fetch", moved, detail))
}

/// Bring the upstream's commits down, by whichever strategy was asked for.
fn pull(repo: &Repo, args: &[String]) -> Result<Report, Failure> {
    let mut strategy = "merge";
    for a in args {
        strategy = match a.as_str() {
            "--merge" | "--no-rebase" => "merge",
            "--rebase" => "rebase",
            "--ff-only" => "ff-only",
            // The engine falls back to a merge for a strategy it does not know,
            // which is right for a caller that has already validated the string
            // and wrong for one that has not: a misspelled `--reabse` would
            // silently do the other thing, and the reader would only find out
            // from the shape of the history afterwards.
            other => {
                return Err(format!(
                    "unexpected argument: {other}\n\n\
                     glimpse pull takes one of --merge (the default), --rebase or --ff-only."
                )
                .into())
            }
        };
    }
    refuse_if_open(repo)?;
    let branch = on_a_branch(repo, "pull into")?;
    let upstream = upstream_or_refuse(repo, &branch, "pull from")?;

    let before = repo.resolve_commit("HEAD")?;
    if let Err(e) = repo.pull(strategy) {
        return Err(stopped_pull(repo, strategy, &e, &before));
    }

    // What the *upstream* sent — not what HEAD gained. The two differ exactly
    // where the branch had diverged: a rebase replays the local commits onto the
    // new base as new objects unreachable from `before`, and a merge writes a
    // merge commit here, and neither of those came from the remote. So the
    // read-back is against the upstream ref, which the pull has just moved, and
    // `paths` names commits the remote really did send — it is also the receipt
    // a running window is handed.
    let added = match repo.resolve_commit(&upstream) {
        Ok(tip) => repo.commits_between(&before, &tip)?,
        // No remote-tracking ref to read back against. Nothing else here knows
        // better than "what HEAD gained", so say that rather than nothing.
        Err(_) => repo.commits_since(&before)?,
    };
    let now = repo.resolve_commit("HEAD")?;
    let detail = if added.is_empty() {
        format!("{branch} is already up to date with {upstream}")
    } else {
        format!(
            "pulled {} from {upstream} by {}, HEAD now at {}",
            commits(added.len()),
            strategy_name(strategy),
            short(&now)
        )
    };
    Ok(Report::new("pull", added, detail).with_commit(now))
}

/// Publish the current branch's commits to its upstream.
fn push(repo: &Repo, args: &[String]) -> Result<Report, Failure> {
    let mut set_upstream = false;
    let mut force = false;
    for a in args {
        match a.as_str() {
            "-u" | "--set-upstream" => set_upstream = true,
            // One spelling for the caller, one behaviour underneath: this is
            // always `--force-with-lease`, never git's unconditional `--force`.
            // A force that cannot see what it is overwriting is not a decision
            // anybody made.
            "-f" | "--force" | "--force-with-lease" => force = true,
            other => {
                return Err(format!(
                    "unexpected argument: {other}\n\n\
                     usage: glimpse push [-u] [--force]"
                )
                .into())
            }
        }
    }
    needs_a_remote(repo, "push to")?;
    let branch = on_a_branch(repo, "push")?;
    let upstream = repo.upstream();
    if upstream.is_empty() && !set_upstream {
        // The advice has to be true where it is given: `-u` publishes to the
        // remote the engine resolves, which is `origin` only where `origin` is
        // what the remote is called. Recommending a command that then fails with
        // git's "'origin' does not appear to be a git repository" is worse than
        // no advice at all.
        let how = match repo.push_remote() {
            Some(remote) => {
                format!(
                    "Publish it and record where it went: glimpse push -u — it goes to {remote}."
                )
            }
            None => "Several remotes are configured and none is named origin, so nothing here \
                     can pick one for you: git push -u <remote> HEAD"
                .to_string(),
        };
        return Err(
            format!("{branch} has no upstream, so there is nowhere to push it\n\n{how}").into(),
        );
    }

    // Where the remote stood before, so the report can say what this push added
    // rather than what the branch happens to contain.
    let before = (!upstream.is_empty())
        .then(|| repo.resolve_commit(&upstream).ok())
        .flatten();

    if let Err(e) = repo.push(set_upstream, force) {
        return Err(rejected(&e, force));
    }

    // Asked again afterwards: `-u` may have created the upstream this push was
    // the first to need.
    let upstream = repo.upstream();
    let now = repo.resolve_commit("HEAD")?;
    let detail = match before.as_deref() {
        Some(was) if was == now => format!("{upstream} is already up to date; nothing to push"),
        Some(was) => format!(
            "pushed {} to {upstream}, now at {}",
            commits(repo.commits_since(was).map(|c| c.len()).unwrap_or(0)),
            short(&now)
        ),
        None => format!("published {branch} as {upstream}, at {}", short(&now)),
    };
    let moved = before.as_deref() != Some(now.as_str());
    let touched = if moved {
        vec![upstream.clone()]
    } else {
        Vec::new()
    };
    let report = Report::new("push", touched, detail);
    Ok(if moved {
        report.with_commit(now)
    } else {
        report
    })
}

/// Refuse a command whose whole subject is a remote, in a repository that has
/// none — rather than letting git succeed at doing nothing.
fn needs_a_remote(repo: &Repo, doing: &str) -> Result<(), Failure> {
    if repo.remote_names()?.is_empty() {
        return Err(format!(
            "there is no remote to {doing}\n\n\
             Give this repository one: glimpse remote add <name> <url>"
        )
        .into());
    }
    Ok(())
}

/// The current branch, refusing a detached HEAD by name.
///
/// git's own refusal here is about `HEAD` and the push refspec, which is an
/// accurate answer to a question about ref syntax and not to the one the user
/// asked. There is simply no branch to publish or to pull into.
fn on_a_branch(repo: &Repo, doing: &str) -> Result<String, Failure> {
    let branch = repo.current_branch()?;
    if branch.is_empty() || branch == "HEAD" {
        return Err(format!(
            "HEAD is detached, so there is no branch to {doing}\n\n\
             Put the work on one first: glimpse branch create <name>"
        )
        .into());
    }
    Ok(branch)
}

fn upstream_or_refuse(repo: &Repo, branch: &str, doing: &str) -> Result<String, Failure> {
    let upstream = repo.upstream();
    if upstream.is_empty() {
        return Err(format!(
            "{branch} has no upstream, so there is nothing to {doing}\n\n\
             Publish it and record where it went: glimpse push -u"
        )
        .into());
    }
    Ok(upstream)
}

/// Why a pull stopped — named after the operation that actually ran.
///
/// `git pull --abort` does not exist, so the way out is `git merge --abort` or
/// `git rebase --abort` depending on the strategy. Offering the reader a command
/// that does not exist, at the moment their repository is mid-operation, is the
/// specific failure this function exists to avoid.
fn stopped_pull(repo: &Repo, strategy: &str, reason: &str, before: &str) -> Failure {
    let op = if strategy == "rebase" {
        "rebase"
    } else {
        "merge"
    };
    let conflicted = conflicted_paths(repo);
    let moved = repo
        .resolve_commit("HEAD")
        .map(|now| now != before)
        .unwrap_or(false);
    let open = in_progress(repo).is_some() || repo.rebase_in_progress();
    let reason = said_what_stopped(op, reason);

    // Nothing was touched — `--ff-only` declining a diverged branch, a remote
    // that refused the connection. The reason on its own is the whole answer,
    // and dressing it up as a mid-operation state would be false.
    if !moved && !open && conflicted.is_empty() {
        return reason.into();
    }

    let detail = match conflicted.as_slice() {
        [] => String::new(),
        [one] => format!("\n\n{one} is in conflict."),
        many => format!("\n\nStill in conflict:\n{}", bulleted(many)),
    };
    Failure {
        message: format!(
            "{reason}{detail}\n\n\
             The pull is left mid-{op}. Resolve each path and stage it, then glimpse commit \
             — or undo it with `git {op} --abort`."
        ),
        // The tree and the index moved even though the command failed, so a
        // window open on the repository is told; leaving it showing the state
        // from before would be showing work that is no longer there.
        partial: Some(Report::new(
            "pull",
            conflicted,
            format!("the pull stopped mid-{op}"),
        )),
    }
}

/// A push git would not take. The hint is added only where the remote is what
/// declined, so a credential or transport failure is not answered with advice
/// about history.
fn rejected(reason: &str, forced: bool) -> Failure {
    let declined = reason.contains("rejected")
        || reason.contains("fetch first")
        || reason.contains("stale info");
    if !declined {
        return reason.into();
    }
    let next = if forced {
        "The lease held: the remote has moved since this repository last fetched it, so even \
         a forced push declined rather than overwrite work it has not seen. Run `glimpse fetch`, \
         look at what arrived, then push again."
    } else {
        "The remote has commits this branch does not. Bring them down first with `glimpse pull`, \
         or overwrite the remote with `glimpse push --force` — which is a lease, so it still \
         refuses if the remote has moved since you last fetched."
    };
    format!("{reason}\n\n{next}").into()
}

/// Remote-tracking refs that gained a new commit, or appeared outright.
fn moved_refs(before: &[(String, String)], after: &[(String, String)]) -> Vec<String> {
    after
        .iter()
        .filter(|(name, hash)| !before.iter().any(|(was, at)| was == name && at == hash))
        .map(|(name, _)| name.clone())
        .collect()
}

/// Remote-tracking refs `--prune` removed because the remote no longer has them.
fn pruned_refs(before: &[(String, String)], after: &[(String, String)]) -> Vec<String> {
    before
        .iter()
        .filter(|(name, _)| !after.iter().any(|(now, _)| now == name))
        .map(|(name, _)| name.clone())
        .collect()
}

fn refs(n: usize) -> String {
    if n == 1 {
        "1 remote-tracking branch".to_string()
    } else {
        format!("{n} remote-tracking branches")
    }
}

fn commits(n: usize) -> String {
    if n == 1 {
        "1 commit".to_string()
    } else {
        format!("{n} commits")
    }
}

fn strategy_name(strategy: &str) -> &'static str {
    match strategy {
        "rebase" => "rebase",
        "ff-only" => "fast-forward",
        _ => "merge",
    }
}

#[cfg(test)]
mod tests {
    use super::{moved_refs, pruned_refs};

    fn tips(pairs: &[(&str, &str)]) -> Vec<(String, String)> {
        pairs
            .iter()
            .map(|(n, h)| (n.to_string(), h.to_string()))
            .collect()
    }

    #[test]
    fn a_ref_that_did_not_move_is_not_reported_as_having_moved() {
        // The whole point of the read-back: a fetch that changed nothing must
        // report nothing, or "up to date" stops meaning anything.
        let before = tips(&[("origin/main", "aaa"), ("origin/next", "bbb")]);
        assert!(moved_refs(&before, &before).is_empty());
        assert!(pruned_refs(&before, &before).is_empty());
    }

    #[test]
    fn a_new_ref_counts_as_moved_and_a_vanished_one_as_pruned() {
        let before = tips(&[("origin/main", "aaa"), ("origin/gone", "ccc")]);
        let after = tips(&[("origin/main", "zzz"), ("origin/new", "ddd")]);
        let mut moved = moved_refs(&before, &after);
        moved.sort();
        assert_eq!(moved, ["origin/main", "origin/new"]);
        assert_eq!(pruned_refs(&before, &after), ["origin/gone"]);
    }
}
