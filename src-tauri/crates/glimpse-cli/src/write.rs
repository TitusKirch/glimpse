//! The write commands: the GUI's working-tree and commit actions, headless.
//!
//! These differ from the read commands in kind, not just in direction, and the
//! difference is what shapes this module:
//!
//! * **A refusal is a feature.** A write that cannot do what was asked stops and
//!   says so rather than doing something adjacent. Nothing staged is not an
//!   empty commit; a path that matches nothing is not a no-op.
//! * **The report says what changed**, so a caller never has to run a second
//!   command to find out whether the first one did anything. Under `--json`
//!   that report is the same `{...}` contract the read commands emit, and a
//!   failure is still `{"error": ...}` on stderr — with no exception.
//! * **A running GUI is told afterwards** ([`crate::signal`]), best-effort: the
//!   notification cannot fail the command that succeeded.

use crate::{fail, open_repo, parse_globals, signal, wants_json};
use glimpse_core::git::Repo;
use std::io::Write;

/// The write commands this module answers to. Kept beside the implementation so
/// [`crate::run`] routes on one list rather than on a match arm that can drift.
pub const WRITE_SUBCOMMANDS: &[&str] = &["stage", "unstage", "discard", "commit", "amend"];

pub(crate) fn claims(cmd: &str) -> bool {
    WRITE_SUBCOMMANDS.contains(&cmd)
}

pub(crate) fn run(cmd: &str, args: &[String], out: &mut dyn Write, err: &mut dyn Write) -> i32 {
    let globals = match parse_globals(args) {
        Err(e) => return fail(err, wants_json(args), "glimpse", &e),
        Ok(g) => g,
    };
    if globals.help {
        let _ = write!(out, "{}", crate::help());
        return 0;
    }
    let json = globals.json;

    // `unknown` is answered before a repository is opened, so an unrecognised
    // word never depends on the cwd being a repo at all.
    if !claims(cmd) {
        return fail(
            err,
            json,
            "glimpse",
            &format!("unknown subcommand: {cmd}\n\nRun `glimpse --help` for the list."),
        );
    }
    let repo = open_repo(globals.dir);
    let result = match cmd {
        "stage" => stage(&repo, &globals.rest),
        "unstage" => unstage(&repo, &globals.rest),
        "discard" => discard(&repo, &globals.rest),
        "commit" => commit(&repo, &globals.rest),
        "amend" => amend(&repo, &globals.rest),
        // Unreachable: `claims` above gates this match on the same list.
        other => Err(format!("unknown subcommand: {other}")),
    };

    match result {
        Ok(report) => {
            // One place, so a new write command inherits the notification the
            // way it inherits `--json` and `-C` — rather than being expected to
            // remember it. Only a *successful* write is reported: a refusal
            // changed nothing, and telling the window otherwise would make it
            // reload for a change that never happened.
            signal::notify_gui(&repo, report.action, &report.paths);
            let _ = write!(out, "{}", report.emit(json));
            0
        }
        Err(e) => fail(err, json, "glimpse", &e),
    }
}

/// What a write command did, in the two shapes every command owes.
///
/// One type rather than a per-command struct: the useful answer to "what
/// happened?" is the same shape for all of them — a sentence for a human, and
/// the paths (or refs) that actually changed for a machine.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Report {
    /// The command that ran, so a `--json` caller can tell two logged runs apart.
    action: &'static str,
    /// What the action touched — paths, or a ref name. Empty is legitimate only
    /// where the action's subject is not a path (a commit, say).
    #[serde(skip_serializing_if = "Vec::is_empty")]
    paths: Vec<String>,
    /// The one-line human summary. Also carried in JSON so a caller can log it.
    detail: String,
    /// The commit a commit-producing action created, as a full hash. Absent for
    /// every other action rather than empty, so a caller can branch on presence.
    #[serde(skip_serializing_if = "Option::is_none")]
    commit: Option<String>,
}

impl Report {
    fn new(action: &'static str, paths: Vec<String>, detail: String) -> Self {
        Self {
            action,
            paths,
            detail,
            commit: None,
        }
    }

    fn with_commit(mut self, hash: String) -> Self {
        self.commit = Some(hash);
        self
    }

    fn emit(&self, json: bool) -> String {
        if json {
            match serde_json::to_string(self) {
                Ok(s) => format!("{s}\n"),
                // Serialising three owned strings cannot realistically fail, but
                // silently printing nothing would be worse than saying so.
                Err(e) => format!("{{\"error\":\"could not serialise the result: {e}\"}}\n"),
            }
        } else {
            format!("{}\n", self.detail)
        }
    }
}

/// The paths a path-taking write command was given, refusing the empty case.
///
/// A write command with no subject is a mistake, not a no-op: `glimpse stage`
/// with nothing after it reads as "stage everything" to a hurried user, and
/// answering "nothing to do" would confirm that reading falsely.
fn required_paths(rest: &[String], cmd: &str) -> Result<Vec<String>, String> {
    for a in rest {
        if a.starts_with('-') {
            return Err(format!("unexpected argument: {a}"));
        }
    }
    if rest.is_empty() {
        return Err(format!(
            "{cmd} needs at least one path\n\nRun `glimpse --help` for the usage."
        ));
    }
    Ok(rest.to_vec())
}

fn stage(repo: &Repo, rest: &[String]) -> Result<Report, String> {
    let paths = required_paths(rest, "stage")?;
    for p in &paths {
        repo.stage(p)?;
    }
    let detail = format!("staged {}", listed(&paths));
    Ok(Report::new("stage", paths, detail))
}

/// The `-m <message>` both commit commands take. Kept apart from
/// [`required_paths`] because these two take a message, not paths, and a
/// stray positional is a mistake worth naming rather than ignoring.
fn message_arg(rest: &[String]) -> Result<Option<String>, String> {
    let mut message: Option<String> = None;
    let mut it = rest.iter();
    while let Some(a) = it.next() {
        match a.as_str() {
            "-m" | "--message" => match it.next() {
                Some(m) => message = Some(m.clone()),
                None => return Err("missing message after -m".to_string()),
            },
            other => return Err(format!("unexpected argument: {other}")),
        }
    }
    Ok(message)
}

/// Commit what is staged. Never more than that: `glimpse commit` is not
/// `git commit -a`, so a dirty working tree stays dirty.
fn commit(repo: &Repo, rest: &[String]) -> Result<Report, String> {
    let message = message_arg(rest)?.ok_or(
        "commit needs a message: glimpse commit -m \"<message>\"\n\n\
         There is no editor to fall back to when running headlessly.",
    )?;

    // Refuse before calling git, so the reason names *this* CLI's contract
    // rather than surfacing git's own wording for a case we can see coming.
    if !repo.status()?.iter().any(|e| e.staged) {
        return Err(
            "nothing staged to commit\n\nStage something first: glimpse stage <path>..."
                .to_string(),
        );
    }

    repo.commit(&message, false)?;
    let hash = repo.resolve_commit("HEAD")?;
    Ok(Report::new("commit", Vec::new(), format!("committed {hash}")).with_commit(hash))
}

/// Rewrite the previous commit — fold the index into it, reword it, or both.
///
/// Unlike [`commit`] this does **not** require a staged change: a bare reword
/// (`-m` with nothing staged) is a legitimate use, and the engine's `--amend`
/// handles the empty-index case by design.
fn amend(repo: &Repo, rest: &[String]) -> Result<Report, String> {
    // No `-m` means "keep the previous message", which is what a user folding a
    // fix into the last commit means. Reading it back and passing it through
    // keeps that explicit rather than depending on `--amend`'s editor default,
    // which has no editor to open here.
    let message = match message_arg(rest)? {
        Some(m) => m,
        None => repo.head_message()?,
    };
    repo.commit(&message, true)?;
    let hash = repo.resolve_commit("HEAD")?;
    Ok(Report::new("amend", Vec::new(), format!("amended into {hash}")).with_commit(hash))
}

/// Throw away uncommitted work — the only command here that destroys anything,
/// and the only one that is therefore built to refuse.
///
/// Three deliberate choices, none of them git's default:
///
/// 1. **The subject is always explicit.** There is no bare `glimpse discard`
///    meaning "everything". Naming a path *is* the confirmation: the caller has
///    said exactly what they are willing to lose.
/// 2. **Everything needs a flag, because it names nothing.** `--all` has no path
///    to act as its confirmation, so it carries `--force` instead. A prompt is
///    not an option: this command's whole point is to run unattended, where
///    stdin is not a terminal — a prompt would either hang CI or be skipped
///    silently, and silently skipped is the worse of the two.
/// 3. **A path that matches nothing is an error, and it stops the batch.**
///    Resolved against `status` *before* anything is destroyed, so a typo costs
///    nothing at all. Reporting success for work never found is how a caller
///    comes to believe a change is gone when it is not (or the reverse).
fn discard(repo: &Repo, rest: &[String]) -> Result<Report, String> {
    let mut all = false;
    let mut force = false;
    let mut paths: Vec<String> = Vec::new();
    for a in rest {
        match a.as_str() {
            "--all" => all = true,
            "-f" | "--force" => force = true,
            other if other.starts_with('-') => return Err(format!("unexpected argument: {other}")),
            other => paths.push(other.to_string()),
        }
    }

    if all {
        if !paths.is_empty() {
            return Err(format!(
                "discard --all takes no paths, got: {}",
                paths.join(", ")
            ));
        }
        if !force {
            return Err(
                "discard --all throws away every uncommitted change in the working tree.\n\
                 Re-run it with --force if that is what you mean."
                    .to_string(),
            );
        }
        repo.discard_all()?;
        return Ok(Report::new(
            "discard",
            Vec::new(),
            "discarded every uncommitted change in the working tree".to_string(),
        ));
    }

    if paths.is_empty() {
        return Err(
            "discard needs at least one path, or --all --force for the whole working tree."
                .to_string(),
        );
    }

    // Resolve every path against `status` FIRST. Nothing is destroyed until all
    // of them are known to have something to destroy — so a batch is
    // all-or-nothing and a caller never has to work out how far it got.
    let status = repo.status()?;
    let mut plan: Vec<(String, bool)> = Vec::new();
    for p in &paths {
        match status.iter().find(|e| &e.path == p) {
            Some(entry) => plan.push((p.clone(), entry.untracked)),
            None => {
                return Err(format!(
                    "nothing to discard for {p}\n\nRun `glimpse status` to see what has changed."
                ))
            }
        }
    }

    let deleted = plan.iter().filter(|(_, untracked)| *untracked).count();
    for (p, untracked) in &plan {
        repo.discard(p, *untracked)?;
    }

    // An untracked file is *removed from disk*, a tracked one is *restored*.
    // Reporting both as "discarded" would understate the first: there is no
    // copy of it anywhere, not even in the index.
    let detail = match (deleted, plan.len() - deleted) {
        (0, _) => format!("restored {} to the last committed state", listed(&paths)),
        (_, 0) => format!("deleted untracked {}", listed(&paths)),
        (d, r) => format!(
            "discarded {}: {r} restored, {d} deleted (untracked)",
            listed(&paths)
        ),
    };
    Ok(Report::new("discard", paths, detail))
}

fn unstage(repo: &Repo, rest: &[String]) -> Result<Report, String> {
    let paths = required_paths(rest, "unstage")?;
    for p in &paths {
        repo.unstage(p)?;
    }
    let detail = format!("unstaged {}", listed(&paths));
    Ok(Report::new("unstage", paths, detail))
}

/// "a.txt", "a.txt and b.txt", "3 files" — a human summary that stays short
/// when a caller stages a whole directory's worth of paths.
fn listed(paths: &[String]) -> String {
    match paths {
        [one] => one.clone(),
        [a, b] => format!("{a} and {b}"),
        _ => format!("{} files", paths.len()),
    }
}
