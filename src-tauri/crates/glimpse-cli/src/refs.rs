//! The refs and metadata commands: branches, tags, remotes, stashes, and the
//! three verbs that move commits about (`cherry-pick`, `revert`, `reset`).
//!
//! They share [`write`](crate::write)'s contract — one [`Report`], `--json`,
//! `-C`, a best-effort receipt for a running window — and are kept apart from it
//! because their **subject is a ref, not a path**, and that changes two things:
//!
//! * **What "it worked" means.** A working-tree write is checked against
//!   `status`; these are checked against the ref store — the branch list, the
//!   tag list, `HEAD`. Every command here reads its outcome back from git after
//!   the fact and reports *that*, never what it asked for. It is the same rule
//!   `discard` learned the hard way: git can decline part of a request and say
//!   nothing about it.
//! * **What has to be refused.** A cherry-pick, revert or merge that stopped on
//!   a conflict leaves the repository *mid-operation*, and starting a second one
//!   on top of it is the half-act these commands exist not to commit. Every verb
//!   that would begin one asks first ([`in_progress`]).

use crate::write::{bulleted, listed, Failure, Report};
use glimpse_core::git::{Repo, ResetMode};

pub(crate) fn run(cmd: &str, repo: &Repo, rest: &[String]) -> Result<Report, Failure> {
    match cmd {
        "branch" => branch(repo, rest),
        "cherry-pick" => cherry_pick(repo, rest),
        "revert" => revert(repo, rest),
        "reset" => reset(repo, rest),
        "tag" => tag(repo, rest),
        "remote" => remote(repo, rest),
        "stash" => stash(repo, rest),
        // Unreachable: `write::claims` gates this on the same list.
        other => Err(format!("unknown subcommand: {other}").into()),
    }
}

/// Replay commits onto the current branch, in the order given (oldest first,
/// as git wants them).
fn cherry_pick(repo: &Repo, rest: &[String]) -> Result<Report, Failure> {
    let hashes = commit_operands(rest, "cherry-pick <commit>...")?;
    refuse_if_open(repo)?;
    let before = repo.resolve_commit("HEAD")?;
    if let Err(e) = repo.cherry_pick(&hashes) {
        return Err(stopped_operation(
            repo,
            "cherry-pick",
            &hashes.join(", "),
            &e,
            &before,
        ));
    }
    landed(repo, "cherry-pick", &before, hashes.len(), "replayed")
}

/// Commit the inverse of one or more commits, leaving the originals in place.
fn revert(repo: &Repo, rest: &[String]) -> Result<Report, Failure> {
    let mut mainline: Option<u32> = None;
    let mut args: Vec<String> = Vec::new();
    let mut it = rest.iter();
    while let Some(a) = it.next() {
        match a.as_str() {
            // git spells the parent selector `-m` on `revert` too, so the same
            // habit carries; it is a number here, not a message.
            "-m" | "--mainline" => {
                let Some(v) = it.next() else {
                    return Err("missing parent number after -m".into());
                };
                let Ok(n) = v.parse::<u32>() else {
                    return Err(format!(
                        "-m takes the parent to revert against, as a number: got {v}"
                    )
                    .into());
                };
                mainline = Some(n);
            }
            other => args.push(other.to_string()),
        }
    }
    let hashes = commit_operands(&args, "revert [-m <parent>] <commit>...")?;
    refuse_if_open(repo)?;
    let before = repo.resolve_commit("HEAD")?;
    if let Err(e) = repo.revert(&hashes, mainline) {
        // git's own words for a merge with no mainline are accurate but assume
        // you know the flag exists; the hint is added, the diagnosis is not
        // second-guessed.
        //
        // Keyed on git's actual sentence — "commit <hash> is a merge but no -m
        // option was given" — and not on the word "mainline", which appears in
        // the manual and nowhere in the message. Keying on the wrong word left
        // this hint dead, and a test that only looked for "-m" passed on git's
        // own wording rather than on ours.
        let hint = if mainline.is_none() && (e.contains("is a merge") || e.contains("mainline")) {
            "\n\nA merge has two sides, so a revert has to be told which one to keep: \
             glimpse revert -m 1 <commit>"
        } else {
            ""
        };
        let mut failure = stopped_operation(repo, "revert", &hashes.join(", "), &e, &before);
        failure.message.push_str(hint);
        return Err(failure);
    }
    landed(repo, "revert", &before, hashes.len(), "reverted")
}

/// Tag verbs. `glimpse tag` with no verb lists, handled a layer up.
fn tag(repo: &Repo, rest: &[String]) -> Result<Report, Failure> {
    let (verb, args) = verb(rest, "tag", &["create", "delete", "push"])?;
    match verb {
        "create" => tag_create(repo, args),
        "delete" => tag_delete(repo, args),
        "push" => tag_push(repo, args),
        other => Err(format!("unknown tag verb: {other}").into()),
    }
}

/// Create a tag: lightweight by default, annotated once it is given a message,
/// signed when asked — exactly the three the GUI's dialog offers.
fn tag_create(repo: &Repo, args: &[String]) -> Result<Report, Failure> {
    let mut message = String::new();
    let mut sign = false;
    let mut named: Vec<String> = Vec::new();
    let mut it = args.iter();
    while let Some(a) = it.next() {
        match a.as_str() {
            "-m" | "--message" => match it.next() {
                Some(m) => message = m.clone(),
                None => return Err("missing message after -m".into()),
            },
            "-s" | "--sign" => sign = true,
            other if other.starts_with('-') => {
                return Err(format!("unexpected argument: {other}").into())
            }
            other => named.push(other.to_string()),
        }
    }
    let (name, at) = match named.as_slice() {
        [name] => (name.clone(), String::new()),
        [name, at] => (name.clone(), at.clone()),
        _ => {
            return Err(
                "usage: glimpse tag create <name> [<commit>] [-m <message>] [--sign]".into(),
            )
        }
    };

    repo.create_tag(&name, &at, &message, sign)?;
    if !repo.tag_names()?.iter().any(|t| t == &name) {
        return Err(format!("git reported no error, but {name} is not among the tags.").into());
    }
    // `^{commit}` so an annotated tag reports the commit it marks rather than
    // its own object — the commit is what a reader wants to see.
    let points_at = repo.resolve_commit(&name)?;
    let kind = if sign {
        "signed tag"
    } else if message.is_empty() {
        "lightweight tag"
    } else {
        "annotated tag"
    };
    Ok(Report::new(
        "tag create",
        vec![name.clone()],
        format!("created {kind} {name} at {}", short(&points_at)),
    ))
}

/// Delete a tag. Naming it is the confirmation — and the commit it marked is
/// reported, since after the ref is gone nothing else remembers it.
fn tag_delete(repo: &Repo, args: &[String]) -> Result<Report, Failure> {
    let name = operands(args, "tag delete <name>", 1)?[0].clone();
    must_exist(&repo.tag_names()?, &name, "tag", "glimpse tags")?;
    let at = repo.resolve_commit(&name)?;
    repo.delete_tag(&name)?;
    if repo.tag_names()?.iter().any(|t| t == &name) {
        return Err(format!("git reported no error, but {name} is still there.").into());
    }
    Ok(Report::new(
        "tag delete",
        vec![name.clone()],
        format!(
            "deleted {name}, which marked {} — restore it with: git tag {name} {}",
            short(&at),
            short(&at)
        ),
    ))
}

/// Push every local tag to the default remote, and report the ones git says it
/// actually moved rather than the ones it was handed.
///
/// A push is a **batch**, so its exit code is not a verdict on any single ref:
/// one tag the remote already holds at a different commit makes git exit 1 with
/// every other tag already pushed. The porcelain is the only record of which,
/// and it is on stdout — which is why [`Repo::push_tags`] hands back both
/// halves instead of a `Result` a `?` would collapse. A failure that named
/// nothing while the remote had in fact moved is this module's own contract
/// ("report what git actually moved") broken where it matters most.
fn tag_push(repo: &Repo, args: &[String]) -> Result<Report, Failure> {
    operands(args, "tag push", 0)?;
    // git's own answer here is "fatal: No configured push destination", which is
    // true and tells a first-time user nothing about what to do next.
    if repo.remote_names()?.is_empty() {
        return Err(
            "there is no remote to push tags to\n\nAdd one first: glimpse remote add \
             origin <url>"
                .into(),
        );
    }
    // Asked before pushing, because afterwards "nothing moved" and "there was
    // nothing to move" produce the same porcelain — and answering the second
    // with the first tells a caller their tags are safely on the remote.
    if repo.tag_names()?.is_empty() {
        return Err(
            "there are no tags to push\n\nCreate one first: glimpse tag create <name>".into(),
        );
    }

    let done = repo.push_tags();
    let moved = pushed_refs(&done.porcelain);
    if let Some(reason) = done.failure {
        let landed = match moved.as_slice() {
            [] => String::new(),
            [one] => {
                format!("\n\n{one} did reach the remote before git stopped; the rest did not.")
            }
            many => format!(
                "\n\nThese reached the remote before git stopped:\n{}\n\nThe rest did not.",
                bulleted(many)
            ),
        };
        return Err(Failure {
            message: format!("{reason}{landed}"),
            // The remote moved even though the command failed, so a window open
            // on the repository hears about the half that landed — the same
            // reason a stopped merge leaves one.
            partial: (!moved.is_empty())
                .then(|| Report::new("tag push", moved.clone(), String::new())),
        });
    }
    let detail = match moved.as_slice() {
        [] => "the remote already had every local tag; nothing was pushed".to_string(),
        [one] => format!("pushed {one}"),
        many => format!("pushed {} tags: {}", many.len(), many.join(", ")),
    };
    Ok(Report::new("tag push", moved, detail))
}

/// The short ref names a `git push --porcelain` run reports as *changed*.
///
/// The format is one tab-separated line per ref — `<flag>\t<from>:<to>\t<summary>`
/// — wrapped in `To <url>` and `Done`. A leading `=` marks a ref that was already
/// up to date, and those are what make the difference between "pushed nothing"
/// and "pushed everything": echoing the local tag list would report a push that
/// never happened.
fn pushed_refs(porcelain: &str) -> Vec<String> {
    porcelain
        .lines()
        .filter_map(|line| {
            let mut parts = line.split('\t');
            let flag = parts.next()?;
            let refs = parts.next()?;
            // `=` is "up to date", `!` is rejected — neither moved anything.
            if flag == "=" || flag == "!" {
                return None;
            }
            let remote = refs.split(':').next_back()?;
            Some(remote.trim_start_matches("refs/tags/").to_string())
        })
        .collect()
}

/// Remote verbs. `glimpse remote` with no verb lists, handled a layer up.
fn remote(repo: &Repo, rest: &[String]) -> Result<Report, Failure> {
    let (verb, args) = verb(rest, "remote", &["add", "rename", "remove"])?;
    match verb {
        "add" => remote_add(repo, args),
        "rename" => remote_rename(repo, args),
        "remove" => remote_remove(repo, args),
        other => Err(format!("unknown remote verb: {other}").into()),
    }
}

fn remote_add(repo: &Repo, args: &[String]) -> Result<Report, Failure> {
    let named = operands(args, "remote add <name> <url>", 2)?;
    let (name, url) = (named[0].clone(), named[1].clone());
    repo.add_remote(&name, &url)?;
    // The URL git recorded, not the one it was handed: an `insteadOf` rewrite in
    // the user's config can legitimately change it, and the report should show
    // what the repository will actually talk to.
    let recorded = repo.remote_url(&name)?;
    Ok(Report::new(
        "remote add",
        vec![name.clone()],
        format!("added {name} → {recorded}"),
    ))
}

fn remote_rename(repo: &Repo, args: &[String]) -> Result<Report, Failure> {
    let named = operands(args, "remote rename <old> <new>", 2)?;
    let (old, new) = (named[0].clone(), named[1].clone());
    repo.rename_remote(&old, &new)?;
    let names = repo.remote_names()?;
    if names.iter().any(|n| n == &old) || !names.iter().any(|n| n == &new) {
        return Err(format!(
            "git did not rename {old} to {new}; the remotes are now: {}",
            listed(&names)
        )
        .into());
    }
    Ok(Report::new(
        "remote rename",
        vec![new.clone()],
        format!("renamed remote {old} to {new}"),
    ))
}

fn remote_remove(repo: &Repo, args: &[String]) -> Result<Report, Failure> {
    let name = operands(args, "remote remove <name>", 1)?[0].clone();
    must_exist(&repo.remote_names()?, &name, "remote", "glimpse remotes")?;
    // Read first: removing a remote takes its URL with it, and that URL is the
    // only thing needed to put it back.
    let url = repo.remote_url(&name)?;
    repo.remove_remote(&name)?;
    if repo.remote_names()?.iter().any(|n| n == &name) {
        return Err(format!("git reported no error, but {name} is still configured.").into());
    }
    Ok(Report::new(
        "remote remove",
        vec![name.clone()],
        format!("removed {name} — restore it with: glimpse remote add {name} {url}"),
    ))
}

/// Stash verbs. `glimpse stash` with no verb lists, handled a layer up.
fn stash(repo: &Repo, rest: &[String]) -> Result<Report, Failure> {
    let (verb, args) = verb(rest, "stash", &["save", "pop", "apply", "drop"])?;
    match verb {
        "save" => stash_save(repo, args),
        "pop" => stash_restore(repo, args, true),
        "apply" => stash_restore(repo, args, false),
        "drop" => stash_drop(repo, args),
        other => Err(format!("unknown stash verb: {other}").into()),
    }
}

/// Put the working tree away.
///
/// The refusal is the reason this is not a thin wrapper: `git stash push` with
/// nothing to stash prints `No local changes to save` and **exits 0**, which a
/// script reads as "stashed, carry on" and a later `stash pop` then contradicts.
/// The same trap catches an untracked-only tree, where the cause is different
/// and the flag that fixes it is worth naming.
fn stash_save(repo: &Repo, args: &[String]) -> Result<Report, Failure> {
    let mut message = String::new();
    let mut untracked = false;
    let mut paths: Vec<String> = Vec::new();
    let mut it = args.iter();
    while let Some(a) = it.next() {
        match a.as_str() {
            "-m" | "--message" => match it.next() {
                Some(m) => message = m.clone(),
                None => return Err("missing message after -m".into()),
            },
            "-u" | "--include-untracked" => untracked = true,
            other if other.starts_with('-') => {
                return Err(format!("unexpected argument: {other}").into())
            }
            other => paths.push(other.to_string()),
        }
    }

    let status = repo.status()?;
    if status.is_empty() {
        return Err("there is nothing to stash: the working tree is clean".into());
    }
    // What `git stash push` will actually take, which is not the same as what
    // has changed: without -u the untracked half is invisible to it.
    if !untracked && status.iter().all(|e| e.untracked) {
        return Err(format!(
            "only untracked files have changed, and a stash leaves those behind:\n{}\n\n\
             Include them: glimpse stash save -u",
            bulleted(
                &status
                    .iter()
                    .map(|e| e.path.clone())
                    .collect::<Vec<String>>()
            )
        )
        .into());
    }

    let before = repo.stash_list()?.len();
    repo.stash_save(&message, untracked, &paths)?;
    let after = repo.stash_list()?;
    if after.len() != before + 1 {
        return Err(
            "git reported no error, but no new stash entry appeared — nothing was stashed."
                .to_string()
                .into(),
        );
    }
    let entry = &after[0];
    Ok(Report::new(
        "stash save",
        vec![entry.reference.clone()],
        format!("stashed as {} — {}", entry.reference, entry.message),
    ))
}

/// `pop` and `apply` are the same restore; `pop` additionally drops the entry
/// once it has landed, which is the only difference and the only thing that can
/// go differently.
///
/// Both default to `stash@{0}`, git's own default, because neither *loses*
/// anything by choosing for you: the content ends up in the working tree either
/// way. [`stash_drop`] does not get that latitude.
fn stash_restore(repo: &Repo, args: &[String], pop: bool) -> Result<Report, Failure> {
    let verb = if pop { "pop" } else { "apply" };
    // Named once, at the top, because both exits below carry it — the receipt a
    // stopped restore leaves and the report a finished one returns. Spelling it
    // out separately in each is how the receipt came to say `stash pop` after
    // an `apply`.
    let action = if pop { "stash pop" } else { "stash apply" };
    let named = match args {
        [] => None,
        [one] if !one.starts_with('-') => Some(one.clone()),
        [other, ..] => return Err(format!("unexpected argument: {other}").into()),
    };
    let entries = repo.stash_list()?;
    if entries.is_empty() {
        return Err(format!("there are no stash entries to {verb}").into());
    }
    let reference = named.unwrap_or_else(|| entries[0].reference.clone());
    let described = entries
        .iter()
        .find(|e| e.reference == reference)
        .map(|e| e.message.clone())
        .unwrap_or_default();

    let outcome = if pop {
        repo.stash_pop(&reference)
    } else {
        repo.stash_apply(&reference)
    };
    if let Err(e) = outcome {
        // A stash that conflicts has already written to the working tree, and
        // has kept its entry so nothing is lost — `apply` always, `pop` because
        // it will not drop what it could not fully restore. Both facts belong
        // in the message, and the tree having moved is why this failure carries
        // a receipt.
        let conflicted = conflicted_paths(repo);
        // Counted rather than looked up by name: `stash@{0}` still names *an*
        // entry after the one it named is dropped, so finding the reference
        // again is not evidence it survived.
        let kept = if repo.stash_list()?.len() == entries.len() {
            format!("\n\n{reference} was kept, so nothing is lost.")
        } else {
            String::new()
        };
        let detail = match conflicted.as_slice() {
            [] => String::new(),
            [one] => format!("\n\n{one} is in conflict."),
            many => format!("\n\nStill in conflict:\n{}", bulleted(many)),
        };
        return Err(Failure {
            message: format!("{}{detail}{kept}", said_what_stopped(action, &e)),
            partial: (!conflicted.is_empty())
                .then(|| Report::new(action, vec![reference.clone()], String::new())),
        });
    }

    // Read back the one thing that distinguishes the two verbs.
    let still_there = repo.stash_list()?.iter().any(|s| s.reference == reference);
    if pop && still_there {
        return Err(
            format!("git reported no error, but {reference} is still in the stash list.").into(),
        );
    }
    let tail = if pop {
        format!("{reference} is gone")
    } else {
        format!("{reference} is still there")
    };
    Ok(Report::new(
        action,
        vec![reference.clone()],
        format!("restored {reference} — {described}; {tail}"),
    ))
}

/// Throw a stash entry away.
///
/// **The reference is required**, and that is the whole design decision here.
/// `git stash drop` with no argument means `stash@{0}`, so the most destructive
/// verb in the group is the one where git guesses hardest — and the guess is
/// invisible in the command that a script or an agent wrote. The convention the
/// working-tree commands set is that naming the subject *is* the confirmation
/// (`glimpse discard a.txt` needs no flag; `--all`, which names nothing, needs
/// `--force`). Requiring the reference puts `drop` in the first camp and means
/// it never needs a flag at all.
///
/// The report carries the entry's message, because once the entry is gone that
/// sentence is the only description of what was thrown away that ever existed.
fn stash_drop(repo: &Repo, args: &[String]) -> Result<Report, Failure> {
    let entries = repo.stash_list()?;
    let [reference] = args else {
        let example = entries
            .first()
            .map(|e| e.reference.clone())
            .unwrap_or_else(|| "stash@{0}".to_string());
        return Err(format!(
            "drop needs the entry named: glimpse stash drop {example}\n\n\
             git would have assumed stash@{{0}}, and a command that destroys work does not \
             get to choose its own subject. `glimpse stashes` lists them."
        )
        .into());
    };
    if reference.starts_with('-') {
        return Err(format!("unexpected argument: {reference}").into());
    }
    let Some(entry) = entries.iter().find(|e| &e.reference == reference) else {
        return Err(format!(
            "there is no {reference} to drop\n\nRun `glimpse stashes` to see what there is."
        )
        .into());
    };
    let described = entry.message.clone();

    repo.stash_drop(reference)?;
    // Entries renumber as they are removed, so "is it gone?" is asked as "is the
    // list one shorter?" rather than "is that name absent?" — stash@{0} exists
    // again the moment stash@{1} shifts down.
    if repo.stash_list()?.len() + 1 != entries.len() {
        return Err(format!(
            "git reported no error, but the stash list is unchanged — {reference} is still there."
        )
        .into());
    }
    Ok(Report::new(
        "stash drop",
        vec![reference.clone()],
        format!("dropped {reference} — {described}"),
    ))
}

/// Move the current branch to another commit, in git's three modes.
///
/// The confirmation here is split, because what a `reset` puts at risk is split.
/// Naming the commit confirms **moving the branch**, and that half is always
/// recoverable: the commits left behind stay in the object store and the reflog
/// names where HEAD was, which is why the report says so in as many words.
///
/// `--hard` also throws away every uncommitted change in the working tree — and
/// *that* the caller has not named, may not know about, and cannot get back from
/// anywhere. So it is the `discard --all` case exactly: an action with no named
/// subject, carrying `--force` instead. The flag is demanded only when there is
/// something to lose; on a clean tree `--hard` destroys nothing uncommitted and
/// asking for it anyway would just teach the habit of passing it unread.
///
/// "Something to lose" is decided against the **target tree**, not against
/// `status` — see [`at_risk_of_reset`]. An untracked-only working tree is the
/// common shape of dirty, and most of the time a `reset --hard` does not touch
/// it at all.
///
/// It does **not** refuse mid-operation, unlike `discard --all --force`. That
/// refusal exists because discarding settles every conflict on *ours* and leaves
/// `MERGE_HEAD` behind a clean-looking status; `git reset` clears `MERGE_HEAD`
/// and `CHERRY_PICK_HEAD` with it, so it concludes the operation rather than
/// hiding it — and it is the only route out of a stopped one this CLI has until
/// the slice that owns `rebase` lands.
fn reset(repo: &Repo, rest: &[String]) -> Result<Report, Failure> {
    let mut mode = ResetMode::Mixed;
    let mut named: Option<ResetMode> = None;
    let mut force = false;
    let mut target: Vec<String> = Vec::new();
    for a in rest {
        let picked = match a.as_str() {
            "--soft" => Some(ResetMode::Soft),
            "--mixed" => Some(ResetMode::Mixed),
            "--hard" => Some(ResetMode::Hard),
            "-f" | "--force" => {
                force = true;
                None
            }
            other if other.starts_with('-') => {
                return Err(format!("unexpected argument: {other}").into())
            }
            other => {
                target.push(other.to_string());
                None
            }
        };
        if let Some(m) = picked {
            // Two modes is not a preference between them, it is a caller who
            // does not know which one they are asking for.
            if named.is_some() {
                return Err("reset takes one of --soft, --mixed or --hard, not several".into());
            }
            named = Some(m);
            mode = m;
        }
    }
    let [rev] = target.as_slice() else {
        return Err("usage: glimpse reset [--soft|--mixed|--hard] <commit> [--force]".into());
    };

    let was = repo.resolve_commit("HEAD")?;
    let to = repo.resolve_commit(rev)?;
    if matches!(mode, ResetMode::Hard) && !force {
        let at_risk = at_risk_of_reset(repo, &to)?;
        if !at_risk.is_empty() {
            let paths: Vec<String> = at_risk.iter().map(|(p, _)| p.clone()).collect();
            let stash = if at_risk.iter().any(|(_, untracked)| *untracked) {
                "glimpse stash save -u"
            } else {
                "glimpse stash save"
            };
            return Err(format!(
                "reset --hard would throw away uncommitted changes to {}:\n{}\n\n\
                 Moving the branch is undoable — HEAD is at {} and the reflog keeps it. \
                 These are not: there is no copy of them anywhere. Re-run with --force if \
                 that is what you mean, or put them somewhere first with {stash}.",
                listed(&paths),
                bulleted(
                    &at_risk
                        .iter()
                        .map(|(path, untracked)| if *untracked {
                            format!("{path} (untracked, but {} has a file there)", short(&to))
                        } else {
                            path.clone()
                        })
                        .collect::<Vec<String>>()
                ),
                short(&was),
            )
            .into());
        }
    }

    repo.reset(rev, mode)?;
    let now = repo.resolve_commit("HEAD")?;
    if now != to {
        return Err(format!(
            "git reported no error, but HEAD is at {} rather than {}.",
            short(&now),
            short(&to)
        )
        .into());
    }
    let how = match mode {
        ResetMode::Soft => "soft",
        ResetMode::Mixed => "mixed",
        ResetMode::Hard => "hard",
    };
    Ok(Report::new(
        "reset",
        vec![repo.current_branch()?],
        format!(
            "{how} reset to {}, from {} — get back with: git reset --{how} {}",
            short(&now),
            short(&was),
            short(&was)
        ),
    )
    .with_commit(now))
}

/// What a `reset --hard` to `target` would really destroy — each path paired
/// with whether it is at risk *as an untracked file*.
///
/// The two halves of "dirty" are not at risk on the same terms, and a guard is
/// only worth having if it says which. A tracked modification or a staged
/// change is at risk unconditionally: the reset writes the target's version of
/// the file over it and no copy of the caller's exists anywhere. An
/// **untracked** path is at risk **exactly when the target commit has a file at
/// that path** — `reset --hard` does not sweep the working tree, so otherwise
/// it survives untouched, and listing it would be a false statement about the
/// caller's repository on this CLI's most safety-critical prompt.
///
/// Neither direction of that is cosmetic. An untracked-only tree is the *common*
/// shape of dirty — build output, a scratch note — so a guard that fires on it
/// fires constantly on a reset that risks nothing, which is precisely how a
/// caller learns to type `--force` without reading it. And an untracked file
/// the target *does* have really is destroyed, silently, by the same command.
///
/// `status` cannot answer this on its own: it describes the working tree
/// against **HEAD**, and the target is a different tree.
fn at_risk_of_reset(repo: &Repo, target: &str) -> Result<Vec<(String, bool)>, Failure> {
    let status = repo.status()?;
    let untracked: Vec<String> = status
        .iter()
        .filter(|e| e.untracked)
        .map(|e| e.path.clone())
        .collect();
    let written_over = repo.paths_in_tree(target, &untracked)?;
    Ok(status
        .iter()
        .filter(|e| !e.untracked || written_over.contains(&e.path))
        .map(|e| (e.path.clone(), e.untracked))
        .collect())
}

/// The commit-ish operands the three commit-moving verbs take: at least one, no
/// options among them.
fn commit_operands(args: &[String], usage: &str) -> Result<Vec<String>, Failure> {
    for a in args {
        if a.starts_with('-') {
            return Err(format!("unexpected argument: {a}").into());
        }
    }
    if args.is_empty() {
        return Err(format!("usage: glimpse {usage}").into());
    }
    Ok(args.to_vec())
}

/// What an operation added, asked of git rather than assumed from the arguments.
///
/// A cherry-pick or revert writes *new* commits, so the hashes the caller passed
/// in name nothing that now exists; the report carries the ones git actually
/// wrote. And the count is checked: git's sequencer can stop having applied only
/// some of a list, and an exit code of zero on its own does not rule that out.
fn landed(
    repo: &Repo,
    action: &'static str,
    before: &str,
    asked: usize,
    verb: &str,
) -> Result<Report, Failure> {
    let added = repo.commits_since(before)?;
    if added.len() != asked {
        return Err(format!(
            "asked for {asked} commit(s) but git wrote {} — the repository is not in the \
             state this command was asked for. `glimpse log` shows where it stopped.",
            added.len()
        )
        .into());
    }
    let head = added.last().cloned().unwrap_or_else(|| before.to_string());
    let detail = match added.as_slice() {
        [one] => format!("{verb} 1 commit as {}", short(one)),
        many => format!(
            "{verb} {} commits, HEAD now at {}",
            many.len(),
            short(&head)
        ),
    };
    Ok(Report::new(action, added, detail).with_commit(head))
}

/// Split a grouped command's verb from its own arguments, naming the verbs it
/// does have rather than deferring to `--help` — the user is one word away from
/// what they meant, and the list is short enough to say here.
fn verb<'a>(
    rest: &'a [String],
    group: &str,
    verbs: &[&str],
) -> Result<(&'a str, &'a [String]), Failure> {
    let Some(first) = rest.first() else {
        return Err(format!("{group} needs a verb: {}", verbs.join(", ")).into());
    };
    if !verbs.contains(&first.as_str()) {
        return Err(format!(
            "unknown {group} verb: {first}\n\nExpected one of: {}",
            verbs.join(", ")
        )
        .into());
    }
    Ok((first.as_str(), &rest[1..]))
}

/// Refuse a subject that is not there, naming **it**.
///
/// These commands read the subject's commit or URL before removing it, so that
/// the report can say what was lost. That read-back is therefore the first thing
/// to fail when the subject does not exist — and it failed in its own words:
/// `fatal: Needed a single revision`, followed by a `git rev-parse` command
/// line. An accurate answer to a question the user never asked.
fn must_exist(have: &[String], name: &str, kind: &str, lister: &str) -> Result<(), Failure> {
    if have.iter().any(|n| n == name) {
        return Ok(());
    }
    Err(format!("there is no {kind} called {name}\n\nRun `{lister}` to see what there is.").into())
}

/// Exactly `n` positional arguments, refusing both too few and too many.
///
/// Too many matters as much as too few here: `glimpse branch rename old new
/// extra` with the tail dropped would rename against arguments the user did not
/// think they were giving.
fn operands<'a>(args: &'a [String], usage: &str, n: usize) -> Result<&'a [String], Failure> {
    for a in args {
        if a.starts_with('-') {
            return Err(format!("unexpected argument: {a}").into());
        }
    }
    if args.len() != n {
        return Err(format!("usage: glimpse {usage}").into());
    }
    Ok(args)
}

/// Branch verbs. `glimpse branch` with no verb lists, which is handled a layer
/// up so the listing keeps the read module's own renderer.
fn branch(repo: &Repo, rest: &[String]) -> Result<Report, Failure> {
    let (verb, args) = verb(
        rest,
        "branch",
        &["create", "switch", "rename", "delete", "merge"],
    )?;
    match verb {
        "create" => branch_create(repo, args),
        "switch" => branch_switch(repo, args),
        "rename" => branch_rename(repo, args),
        "delete" => branch_delete(repo, args),
        "merge" => branch_merge(repo, args),
        // Unreachable: `verb` above gates this on the same list.
        other => Err(format!("unknown branch verb: {other}").into()),
    }
}

/// Create a branch — and switch to it, which is what the GUI's button does and
/// what `git switch -c` does. Named in the report either way, because "created"
/// and "created and checked out" are different facts about the repository.
fn branch_create(repo: &Repo, args: &[String]) -> Result<Report, Failure> {
    let named = operands(args, "branch create <name> [<start-point>]", args.len())?;
    let (name, start) = match named {
        [name] => (name.clone(), None),
        [name, start] => (name.clone(), Some(start.clone())),
        _ => return Err("usage: glimpse branch create <name> [<start-point>]".into()),
    };
    match &start {
        Some(s) => repo.create_branch_at(&name, s)?,
        None => repo.create_branch(&name)?,
    }
    // Read back rather than assume: `switch -c` both creates and checks out, and
    // a report that claimed the second without looking would be guessing.
    let head = repo.current_branch()?;
    if head != name {
        return Err(format!(
            "git created {name} but left HEAD on {head}, so this command did less than it \
             was asked to."
        )
        .into());
    }
    // An empty repository has no commit for the new branch to point at, and
    // that is not a failure: `git switch -c` wrote `.git/HEAD`, the ref appears
    // with the first commit, and the work the caller asked for happened. There
    // is simply no hash to name, so the report does not pretend there is.
    let detail = match repo.resolve_commit("HEAD") {
        Ok(at) => format!("created {name} at {} and switched to it", short(&at)),
        Err(_) => format!("created {name} and switched to it; it has no commits yet"),
    };
    Ok(Report::new("branch create", vec![name.clone()], detail))
}

/// Check out an existing branch. The read-back is the whole safety here: `git
/// switch` can decline (a dirty file that the switch would overwrite) and the
/// caller has to be told HEAD stayed put rather than left to assume it moved.
fn branch_switch(repo: &Repo, args: &[String]) -> Result<Report, Failure> {
    let name = operands(args, "branch switch <name>", 1)?[0].clone();
    repo.checkout_branch(&name)?;
    let head = repo.current_branch()?;
    if head != name {
        return Err(format!("git left HEAD on {head} rather than switching to {name}.").into());
    }
    let at = repo.resolve_commit("HEAD")?;
    Ok(Report::new(
        "branch switch",
        vec![name.clone()],
        format!("switched to {name} at {}", short(&at)),
    ))
}

fn branch_rename(repo: &Repo, args: &[String]) -> Result<Report, Failure> {
    let named = operands(args, "branch rename <old> <new>", 2)?;
    let (old, new) = (named[0].clone(), named[1].clone());
    repo.rename_branch(&old, &new)?;
    // Both halves, because a rename that left the old name behind would be a
    // copy, and one that never created the new name would be a delete.
    let names = repo.branch_names()?;
    if names.iter().any(|n| n == &old) || !names.iter().any(|n| n == &new) {
        return Err(format!(
            "git did not rename {old} to {new}; the branches are now: {}",
            listed(&names)
        )
        .into());
    }
    Ok(Report::new(
        "branch rename",
        vec![new.clone()],
        format!("renamed {old} to {new}"),
    ))
}

/// Delete a branch — and the one place in this module where `--force` is not
/// redundant with naming the subject.
///
/// The convention the working-tree commands set is that **naming the subject is
/// the confirmation**: `glimpse discard a.txt` needs no flag because the caller
/// has said exactly what they are willing to lose, and only `--all`, which names
/// nothing, carries `--force`. `branch delete <name>` names its subject, so
/// removing the *ref* needs no flag either.
///
/// But a branch is two things at once, and the second one is not in the name:
/// the ref, and whatever commits only that ref keeps reachable. Deleting the
/// first is what the caller asked for; losing the second is a consequence they
/// may not know about — `git branch -d` refuses it for exactly that reason.
/// So `--force` is consent to *that*, and to nothing else, in the same shape as
/// `discard --all --force`: one flag, one meaning.
///
/// Either way the report names the commit the branch pointed at, because that
/// hash is what puts the branch back (`git branch <name> <hash>`), and after the
/// ref is gone there is nowhere else to read it.
fn branch_delete(repo: &Repo, args: &[String]) -> Result<Report, Failure> {
    let mut force = false;
    let mut named: Vec<String> = Vec::new();
    for a in args {
        match a.as_str() {
            "-f" | "--force" => force = true,
            other if other.starts_with('-') => {
                return Err(format!("unexpected argument: {other}").into())
            }
            other => named.push(other.to_string()),
        }
    }
    let [name] = named.as_slice() else {
        return Err("usage: glimpse branch delete <name> [--force]".into());
    };
    must_exist(&repo.branch_names()?, name, "branch", "glimpse branches")?;

    // Read the tip *before* the ref that holds it is removed: afterwards there
    // is no branch left to ask.
    let at = repo.resolve_commit(name)?;
    if let Err(e) = repo.delete_branch(name, force) {
        // git's own refusal is the accurate one — it knows what is reachable
        // from where — so it is quoted rather than second-guessed. The way out
        // is added only where it *is* the way out: `--force` answers exactly one
        // of git's refusals, and offering it for the others (a checked-out
        // branch, which `-D` declines just as firmly) is advice that cannot work.
        let hint = if !force && e.contains("not fully merged") {
            format!(
                "\n\n{name} is at {}. If those commits really are disposable, say so: \
                 glimpse branch delete {name} --force",
                short(&at)
            )
        } else {
            String::new()
        };
        return Err(format!("{e}{hint}").into());
    }
    if repo.branch_names()?.iter().any(|n| n == name) {
        return Err(format!("git reported no error, but {name} is still there.").into());
    }
    Ok(Report::new(
        "branch delete",
        vec![name.clone()],
        format!(
            "deleted {name}, which was at {} — restore it with: git branch {name} {}",
            short(&at),
            short(&at)
        ),
    ))
}

/// Merge a branch into the checked-out one, always as a real merge commit
/// (`--no-ff`, matching the GUI, so the branch keeps its lane in the graph).
fn branch_merge(repo: &Repo, args: &[String]) -> Result<Report, Failure> {
    let name = operands(args, "branch merge <branch>", 1)?[0].clone();
    refuse_if_open(repo)?;
    let before = repo.resolve_commit("HEAD")?;
    if let Err(e) = repo.merge(&name) {
        return Err(stopped_operation(repo, "branch merge", &name, &e, &before));
    }
    let hash = repo.resolve_commit("HEAD")?;
    if hash == before {
        // HEAD not moving has two quite different causes, and only one of them
        // is a malfunction. A branch already reachable from HEAD is "Already up
        // to date" — git's own routine answer, and a routine day for a script —
        // so it exits 0 and says so. The sentence below stays reserved for git
        // succeeding at something it visibly did not do.
        let tip = repo.resolve_commit(&name)?;
        if repo.merge_base(&name)? == tip {
            return Ok(Report::new(
                "branch merge",
                vec![name.clone()],
                format!(
                    "{name} is already in {}; nothing to merge",
                    repo.current_branch()?
                ),
            ));
        }
        return Err(format!(
            "git reported no error, but HEAD is still at {} — nothing was merged.",
            short(&before)
        )
        .into());
    }
    Ok(Report::new(
        "branch merge",
        vec![name.clone()],
        format!(
            "merged {name} into {} as {}",
            repo.current_branch()?,
            short(&hash)
        ),
    )
    .with_commit(hash))
}

/// The operations that can be *stopped rather than finished*, and the ref that
/// says so. A repository in one of these states is mid-decision: the working
/// tree holds one side of a conflict, the index holds part of an answer, and the
/// operation is not recorded anywhere until it concludes.
///
/// `REBASE_HEAD` is deliberately absent. A stopped rebase is the one of these
/// whose own subcommands do not exist yet, so refusing on it would refuse work a
/// caller has no glimpse way to finish; it belongs with the slice that adds
/// `rebase` (#103).
pub(crate) fn in_progress(repo: &Repo) -> Option<&'static str> {
    if repo.merge_in_progress() {
        Some("merge")
    } else if repo.cherry_pick_in_progress() {
        Some("cherry-pick")
    } else if repo.revert_in_progress() {
        Some("revert")
    } else {
        None
    }
}

/// Refuse to *begin* an operation while one is already open.
///
/// git refuses most of these itself, in its own words and at its own moment —
/// sometimes after writing to the index. Asking first means the refusal happens
/// before anything is touched, names the state the repository is actually in and
/// the paths still in dispute, and says how to get out. Starting a second
/// operation on top of an unfinished one is the half-act these commands exist
/// not to commit.
fn refuse_if_open(repo: &Repo) -> Result<(), Failure> {
    let Some(state) = in_progress(repo) else {
        return Ok(());
    };
    let conflicted = conflicted_paths(repo);
    let where_it_is = match conflicted.as_slice() {
        [] => format!("a {state} is still in progress"),
        [one] => format!("a {state} is still in progress, and {one} is still in conflict"),
        many => format!(
            "a {state} is still in progress, with unresolved conflicts:\n{}",
            bulleted(many)
        ),
    };
    Err(format!(
        "{where_it_is}\n\n\
         Starting another one on top of it would record a decision nobody made. Finish \
         this one (resolve each path, then glimpse stage <path>... and glimpse commit), \
         or undo it with `git {state} --abort`."
    )
    .into())
}

/// The paths git still shows as unmerged. Best-effort: this only ever decorates
/// a message that is already being written, so a `status` that itself fails
/// leaves the message shorter rather than replacing the real reason with its own.
fn conflicted_paths(repo: &Repo) -> Vec<String> {
    repo.status()
        .map(|entries| {
            entries
                .iter()
                .filter(|e| e.conflicted)
                .map(|e| e.path.clone())
                .collect()
        })
        .unwrap_or_default()
}

/// A failure's opening sentence, supplied when git did not write one.
///
/// **A conflict is the case where git says nothing on stderr**: it writes
/// `CONFLICT (content): …` to *stdout*, and the engine returns stdout only on
/// success, so every command that can stop on a conflict is handed either an
/// empty reason or one that opens straight into the echoed git command line.
/// Neither says what failed, and that is the one thing a failure owes its first
/// sentence.
///
/// Shared rather than repeated because the shape recurs across the whole group
/// — merge, cherry-pick, revert and both stash restores stop the same way, and
/// a repair living inside [`stopped_operation`] reached only the three that
/// went through it.
fn said_what_stopped(op: &str, reason: &str) -> String {
    if reason.trim_start().starts_with('$') || reason.trim().is_empty() {
        format!("the {op} stopped without completing\n{reason}")
    } else {
        reason.to_string()
    }
}

/// How a merge, cherry-pick or revert failed — **asked of the repository**,
/// rather than assumed from the fact that git returned an error.
///
/// git fails these two quite different ways, and saying the wrong one is the
/// failure mode this whole group exists to avoid:
///
/// * It **began and stopped**, leaving a conflict in the tree and its own
///   `*_HEAD` ref set. Nothing is recorded yet and the caller has to finish or
///   abort — and a window open on the repository is showing a tree that no
///   longer exists, so this failure carries a `partial` receipt.
/// * It **refused outright** — a merge commit with no `-m`, an unknown revision
///   — and touched nothing at all. Telling that caller the repository is "left
///   mid-operation" is a false statement about their repository, and one that
///   sends them to `git … --abort` for a state that does not exist.
///
/// So the state is read back (`in_progress`, the conflicted paths, whether HEAD
/// moved) and the message is built from what is actually true.
fn stopped_operation(
    repo: &Repo,
    action: &'static str,
    subject: &str,
    reason: &str,
    before: &str,
) -> Failure {
    let op = action.split(' ').next_back().unwrap_or(action);
    let conflicted = conflicted_paths(repo);
    let landed = repo
        .resolve_commit("HEAD")
        .map(|now| now != before)
        .unwrap_or(false);
    let open = in_progress(repo).is_some();
    let reason = said_what_stopped(op, reason);

    if !open && !landed && conflicted.is_empty() {
        return reason.into();
    }

    let detail = match conflicted.as_slice() {
        [] => String::new(),
        [one] => format!("\n\n{one} is in conflict."),
        many => format!("\n\nStill in conflict:\n{}", bulleted(many)),
    };
    let moved = if landed {
        format!(
            "\n\nHEAD has moved on from {} — part of this landed.",
            short(before)
        )
    } else {
        String::new()
    };
    Failure {
        message: format!(
            "{reason}{detail}{moved}\n\n\
             The repository is left mid-operation. Resolve each path and stage it, then \
             glimpse commit — or undo it with `git {op} --abort`."
        ),
        // The tree and the index moved even though the command failed, so the
        // window is told — with the subject that was being applied, which is the
        // only name this half-finished state has.
        partial: (!conflicted.is_empty() || landed)
            .then(|| Report::new(action, vec![subject.to_string()], String::new())),
    }
}

/// A hash short enough to read in a sentence, long enough to paste back.
fn short(hash: &str) -> String {
    hash.chars().take(8).collect()
}

#[cfg(test)]
mod tests {
    use super::pushed_refs;

    #[test]
    fn only_the_refs_that_moved_are_reported_as_pushed() {
        // Real `git push --porcelain --tags` output: a new tag, one already
        // there, one rejected. Reporting all three would tell a caller a push
        // happened that did not.
        let porcelain = "To /tmp/remote.git\n\
             *\trefs/tags/v2:refs/tags/v2\t[new tag]\n\
             =\trefs/tags/v1:refs/tags/v1\t[up to date]\n\
             !\trefs/tags/v3:refs/tags/v3\t[rejected] (already exists)\n\
             Done\n";
        assert_eq!(pushed_refs(porcelain), vec!["v2".to_string()]);
    }

    #[test]
    fn a_remote_that_already_had_everything_reports_nothing_pushed() {
        let porcelain = "To /tmp/remote.git\n=\trefs/tags/v1:refs/tags/v1\t[up to date]\nDone\n";
        assert!(pushed_refs(porcelain).is_empty());
        // And the wrapper lines are not refs either.
        assert!(pushed_refs("To /tmp/remote.git\nDone\n").is_empty());
    }
}
