//! The one-shot layout writes: `worktree`, `submodule` and `sparse`.
//!
//! They share [`write`](crate::write)'s contract — one [`Report`], `--json`,
//! `-C`, a best-effort receipt for a running window — and are kept apart from it
//! because their **subject is the repository's layout**: a second working tree,
//! an embedded repository, the slice of the tree that is checked out at all.
//! That gives them two properties the other groups do not share:
//!
//! * **They are one-shot.** Unlike the paused flows next door, none of these
//!   leaves a state behind that a later invocation has to continue or abort.
//!   Each one either changes the layout or refuses, and the repository is
//!   whole either way — so there is nothing here to ask
//!   [`refs::in_progress`](crate::refs::in_progress) about, and no verb that
//!   begins a sequencer operation a second one could land on top of.
//! * **What "it worked" means is read out of git's own listing of the layout** —
//!   `worktree list`, `submodule status`, the sparse-checkout state — never out
//!   of the arguments. Each verb reads that listing **before and after** and
//!   reports the difference. That is deliberate rather than incidental: it means
//!   no path the user typed is ever matched against a path git printed, which is
//!   a comparison that cannot be done honestly (git prints absolute, resolved
//!   paths; a user types a relative one, and on Windows in either separator).
//!   The entry that appeared, or the one that vanished, is the answer.
//!
//! Every path here is resolved by git itself with the repository root as its
//! working directory, which is the CLI's one path convention — so `glimpse
//! worktree add ../review` puts the new tree beside the repository, whichever
//! directory the command was run from.

use crate::write::{listed, Failure, Report};
use glimpse_core::git::{Repo, Worktree};

pub(crate) fn run(cmd: &str, repo: &Repo, rest: &[String]) -> Result<Report, Failure> {
    match cmd {
        "worktree" => worktree(repo, rest),
        "submodule" => submodule(repo, rest),
        "sparse" => sparse(repo, rest),
        // Unreachable: `write::claims` gates this on the same list.
        other => Err(format!("unknown subcommand: {other}").into()),
    }
}

/// Worktree verbs. `glimpse worktree` with no verb lists, handled a layer up.
fn worktree(repo: &Repo, rest: &[String]) -> Result<Report, Failure> {
    let (verb, args) = crate::refs::verb(rest, "worktree", &["add", "remove"])?;
    match verb {
        "add" => worktree_add(repo, args),
        "remove" => worktree_remove(repo, args),
        other => Err(format!("unknown worktree verb: {other}").into()),
    }
}

/// Create a linked worktree, optionally checking out an existing branch or
/// commit there. With no reference git puts a new branch named after the
/// directory on it, which is its own behaviour and not re-invented here.
fn worktree_add(repo: &Repo, args: &[String]) -> Result<Report, Failure> {
    let named = positional(args, "worktree add <path> [<commit>]", 1, 2)?;
    let path = named[0].clone();
    let reference = named.get(1).cloned().unwrap_or_default();

    let before = repo.worktrees()?;
    repo.worktree_add(&path, &reference)?;
    let after = repo.worktrees()?;

    let Some(new) = appeared(&before, &after) else {
        return Err(
            format!("git reported no error, but no new worktree is listed for {path}.").into(),
        );
    };
    Ok(Report::new(
        "worktree add",
        vec![new.path.clone()],
        format!("added a worktree at {} — {}", new.path, checked_out(new)),
    ))
}

/// Remove a linked worktree. Naming it is the confirmation, and git's own guard
/// on a worktree with uncommitted work in it stays exactly where it is: this
/// command offers no `--force`, because the GUI's action does not either.
fn worktree_remove(repo: &Repo, args: &[String]) -> Result<Report, Failure> {
    let path = positional(args, "worktree remove <path>", 1, 1)?[0].clone();

    let before = repo.worktrees()?;
    repo.worktree_remove(&path)?;
    let after = repo.worktrees()?;

    let Some(gone) = appeared(&after, &before) else {
        return Err(format!(
            "git reported no error, but every worktree it listed before is still listed, \
             {path} included."
        )
        .into());
    };
    // What it held is worth saying: once the entry is gone nothing else
    // remembers which branch was checked out there.
    let restore = if gone.branch.is_empty() {
        format!("glimpse worktree add {} {}", gone.path, gone.head)
    } else {
        format!("glimpse worktree add {} {}", gone.path, gone.branch)
    };
    Ok(Report::new(
        "worktree remove",
        vec![gone.path.clone()],
        format!(
            "removed the worktree at {}, which held {} — recreate it with: {restore}",
            gone.path,
            checked_out(gone)
        ),
    ))
}

/// The one entry in `after` that is not in `before`, by the path git printed.
///
/// Called both ways round — with the arguments swapped it answers "what
/// vanished" — because both verbs ask the same question of the same two
/// listings.
fn appeared<'a>(before: &[Worktree], after: &'a [Worktree]) -> Option<&'a Worktree> {
    after
        .iter()
        .find(|w| !before.iter().any(|b| b.path == w.path))
}

fn checked_out(wt: &Worktree) -> String {
    if wt.bare {
        return "a bare repository".to_string();
    }
    match (wt.branch.is_empty(), wt.head.is_empty()) {
        (false, _) => format!("{} at {}", wt.branch, wt.head),
        (true, false) => format!("a detached HEAD at {}", wt.head),
        (true, true) => "nothing checked out".to_string(),
    }
}

/// Submodule verbs. `glimpse submodule` with no verb lists, handled a layer up.
fn submodule(repo: &Repo, rest: &[String]) -> Result<Report, Failure> {
    let (verb, args) = crate::refs::verb(rest, "submodule", &["update", "sync"])?;
    match verb {
        "update" => submodule_update(repo, args),
        "sync" => submodule_sync(repo, args),
        other => Err(format!("unknown submodule verb: {other}").into()),
    }
}

/// Initialise every submodule and check each one out at the commit the outer
/// repository records for it — and report the ones that actually moved.
///
/// "Already there" is answered as a success rather than a refusal: the caller
/// asked for the submodules to be at their recorded commits and they are. It is
/// still said out loud, because a script that cannot tell "moved" from "was
/// already right" would have to run `glimpse submodules` to find out.
fn submodule_update(repo: &Repo, args: &[String]) -> Result<Report, Failure> {
    positional(args, "submodule update", 0, 0)?;
    let before = embedded(repo, "update")?;
    repo.submodule_update()?;
    let after = repo.submodules()?;

    let moved: Vec<String> = after
        .iter()
        .filter(|a| {
            before
                .iter()
                .any(|b| b.path == a.path && (b.sha != a.sha || b.state != a.state))
        })
        .map(|a| a.path.clone())
        .collect();

    let detail = if moved.is_empty() {
        "every submodule was already at the commit this repository records".to_string()
    } else {
        format!("updated {}", listed(&moved))
    };
    Ok(Report::new("submodule update", moved, detail))
}

/// Re-read each submodule's remote URL from `.gitmodules` into the repository's
/// own config — what you run after the upstream of an embedded repository moves.
///
/// **This is the one verb in this module with no read-back**, and it says so
/// rather than pretending otherwise: `git submodule status` — the only listing
/// the engine exposes — carries the path, the commit and the sync state, and
/// none of those change when a URL does. So what is reported is the set of
/// submodules git listed as the subjects of the sync, read back from git after
/// the fact; the URLs themselves are not re-read, and no claim is made about
/// them beyond git's own exit code.
fn submodule_sync(repo: &Repo, args: &[String]) -> Result<Report, Failure> {
    positional(args, "submodule sync", 0, 0)?;
    embedded(repo, "sync")?;
    repo.submodule_sync()?;

    let paths: Vec<String> = repo.submodules()?.iter().map(|s| s.path.clone()).collect();
    Ok(Report::new(
        "submodule sync",
        paths.clone(),
        format!(
            "re-read the remote URL of {} from .gitmodules",
            listed(&paths)
        ),
    ))
}

/// The submodules this repository embeds, refusing the empty case.
///
/// A repository with none is not a no-op worth reporting as a success: both
/// verbs would exit 0 having done nothing at all, which reads to a script as
/// though submodules were updated.
fn embedded(repo: &Repo, verb: &str) -> Result<Vec<glimpse_core::git::Submodule>, Failure> {
    let subs = repo.submodules()?;
    if subs.is_empty() {
        return Err(format!(
            "this repository has no submodules, so there is nothing to {verb}\n\n\
             Run `glimpse submodules` to see what it embeds."
        )
        .into());
    }
    Ok(subs)
}

/// Sparse-checkout verbs. `glimpse sparse` with no verb shows the state,
/// handled a layer up.
fn sparse(repo: &Repo, rest: &[String]) -> Result<Report, Failure> {
    let (verb, args) = crate::refs::verb(rest, "sparse", &["set", "disable"])?;
    match verb {
        "set" => sparse_set(repo, args),
        "disable" => sparse_disable(repo, args),
        other => Err(format!("unknown sparse verb: {other}").into()),
    }
}

/// Narrow the working tree to the given directories (cone mode), enabling
/// sparse-checkout if it was off.
///
/// The patterns reported back are **git's**, not the ones handed in: cone mode
/// normalises what it is given, so echoing the arguments would describe a
/// checkout other than the one that now exists.
fn sparse_set(repo: &Repo, args: &[String]) -> Result<Report, Failure> {
    let dirs = positional(args, "sparse set <dir>...", 1, usize::MAX)?.to_vec();

    repo.sparse_set(&dirs)?;
    let after = repo.sparse_status()?;
    if !after.enabled {
        return Err(
            "git reported no error, but sparse-checkout is not enabled in this worktree.".into(),
        );
    }
    Ok(Report::new(
        "sparse set",
        after.patterns.clone(),
        format!("narrowed the working tree to {}", listed(&after.patterns)),
    ))
}

/// Turn sparse-checkout off and restore the whole working tree.
///
/// A worktree that is not narrowed is refused rather than answered with a
/// silent success: `git sparse-checkout disable` exits 0 there having changed
/// nothing, and this command line's posture is that a write with nothing to
/// write says so.
fn sparse_disable(repo: &Repo, args: &[String]) -> Result<Report, Failure> {
    positional(args, "sparse disable", 0, 0)?;

    let before = repo.sparse_status()?;
    if !before.enabled {
        return Err(
            "sparse-checkout is not enabled in this worktree, so there is nothing to \
                    disable\n\n\
                    Run `glimpse sparse` to see its state."
                .into(),
        );
    }
    repo.sparse_disable()?;
    let after = repo.sparse_status()?;
    if after.enabled {
        return Err(
            "git reported no error, but sparse-checkout is still enabled in this worktree.".into(),
        );
    }
    let was = if before.patterns.is_empty() {
        String::new()
    } else {
        format!(" (it had been narrowed to {})", listed(&before.patterns))
    };
    Ok(Report::new(
        "sparse disable",
        before.patterns.clone(),
        format!("disabled sparse-checkout — the whole tree is checked out again{was}"),
    ))
}

/// Between `min` and `max` positional arguments, refusing an option among them.
///
/// [`refs::operands`](crate::refs::operands) takes an exact count, which two of
/// the verbs here cannot use: `worktree add` takes one argument or two, and
/// `sparse set` takes any number of directories. The refusal of a leading dash
/// is the half worth keeping either way — a mistyped flag silently becoming a
/// path is how `sparse set --json` would narrow a tree to a directory called
/// `--json`.
fn positional<'a>(
    args: &'a [String],
    usage: &str,
    min: usize,
    max: usize,
) -> Result<&'a [String], Failure> {
    for a in args {
        if a.starts_with('-') {
            return Err(format!("unexpected argument: {a}").into());
        }
    }
    if args.len() < min || args.len() > max {
        return Err(format!("usage: glimpse {usage}").into());
    }
    Ok(args)
}
