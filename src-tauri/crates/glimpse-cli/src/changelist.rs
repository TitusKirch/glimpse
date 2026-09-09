//! `glimpse cl …` — drive changelists from a terminal or a script/agent.
//!
//! Everything here operates on the same git-native store the GUI uses
//! (`<git-dir>/glimpse/changelists.json`) via the shared model in
//! [`glimpse_core::changelist`] and the engine in [`glimpse_core::git`], so the
//! CLI and the app never disagree about what is in a list.
//!
//! Subcommands: `ls` (default), `add <name>`, `mv <list> <path>…`, `rm <list>`,
//! `active <list>`, `commit <list> -m <msg>`. The global flags (`--json`,
//! `-C <path>`, `-h`) are the crate's, parsed once in
//! [`parse_globals`](crate::parse_globals) rather than again here.

use crate::{fail, open_repo, parse_globals};
use glimpse_core::changelist as cl;
use glimpse_core::git;
use std::io::Write;

pub(crate) fn run(args: &[String], out: &mut dyn Write, err: &mut dyn Write) -> i32 {
    let globals = match parse_globals(args) {
        Ok(g) => g,
        Err(e) => return fail(err, false, "glimpse cl", &e),
    };
    if globals.help {
        let _ = write!(out, "{}", help());
        return 0;
    }
    let json = globals.json;
    let repo = open_repo(globals.dir);

    let rest = globals.rest;
    let cmd = rest.first().map(String::as_str).unwrap_or("ls");
    let cmd_args = if rest.is_empty() { &[][..] } else { &rest[1..] };
    let result = match cmd {
        "ls" | "list" | "status" => cmd_ls(&repo, json),
        "add" | "new" => cmd_add(&repo, cmd_args, json),
        "mv" | "move" => cmd_move(&repo, cmd_args, json),
        "rm" | "del" | "delete" => cmd_rm(&repo, cmd_args, json),
        "active" | "use" => cmd_active(&repo, cmd_args, json),
        "commit" => cmd_commit(&repo, cmd_args, json),
        other => Err(format!(
            "unknown subcommand: {other}\n\nRun `glimpse cl --help`."
        )),
    };
    match result {
        Ok(text) => {
            let _ = write!(out, "{text}");
            0
        }
        Err(e) => fail(err, json, "glimpse cl", &e),
    }
}

// ── State helpers ──────────────────────────────────────────────────────────

/// Load membership from the store, falling back to a fresh default-only state.
fn load(repo: &git::Repo) -> Result<cl::ChangelistState, String> {
    Ok(repo
        .read_changelists()?
        .as_deref()
        .and_then(cl::deserialize)
        .unwrap_or_else(cl::initial_state))
}

/// The non-conflicted changed paths from git status — what changelists group.
fn changed_paths(repo: &git::Repo) -> Result<Vec<String>, String> {
    Ok(repo
        .status()?
        .into_iter()
        .filter(|e| !e.conflicted)
        .map(|e| e.path)
        .collect())
}

/// Membership reconciled against the real working tree (new changes routed in,
/// vanished ones pruned) — the current, accurate view.
fn current(repo: &git::Repo) -> Result<cl::ChangelistState, String> {
    Ok(cl::reconcile(&load(repo)?, &changed_paths(repo)?))
}

fn save(repo: &git::Repo, state: &cl::ChangelistState) -> Result<(), String> {
    repo.write_changelists(&cl::serialize(state))
}

/// Resolve a user token to a list id: exact id, then `default`, then a
/// case-insensitive name match.
fn resolve(state: &cl::ChangelistState, token: &str) -> Option<String> {
    if state.lists.iter().any(|l| l.id == token) {
        return Some(token.to_string());
    }
    if token.eq_ignore_ascii_case("default") {
        return Some(cl::DEFAULT_ID.to_string());
    }
    state
        .lists
        .iter()
        .find(|l| l.name.eq_ignore_ascii_case(token))
        .map(|l| l.id.clone())
}

fn display_name(list: &cl::Changelist) -> &str {
    if list.id == cl::DEFAULT_ID {
        "Default"
    } else {
        &list.name
    }
}

// ── Output ─────────────────────────────────────────────────────────────────

fn render_human(state: &cl::ChangelistState) -> String {
    let mut out = String::new();
    for list in &state.lists {
        let marker = if list.id == state.active_id { "*" } else { " " };
        out.push_str(&format!(
            "{marker} {} ({})\n",
            display_name(list),
            list.members.len()
        ));
        for m in &list.members {
            out.push_str(&format!("    {m}\n"));
        }
    }
    out
}

/// Emit the resulting state: the JSON contract for `--json`, else a confirmation
/// line plus the human-readable listing.
fn report(state: &cl::ChangelistState, json: bool, note: &str) -> Result<String, String> {
    if json {
        Ok(format!("{}\n", cl::serialize(state)))
    } else {
        Ok(format!("{note}\n{}", render_human(state)))
    }
}

// ── Subcommands ────────────────────────────────────────────────────────────

fn cmd_ls(repo: &git::Repo, json: bool) -> Result<String, String> {
    let state = current(repo)?;
    if json {
        Ok(format!("{}\n", cl::serialize(&state)))
    } else {
        Ok(render_human(&state))
    }
}

fn cmd_add(repo: &git::Repo, args: &[String], json: bool) -> Result<String, String> {
    let name = args.first().ok_or("usage: glimpse cl add <name>")?;
    let state = current(repo)?;
    let (next, id) = cl::create_list(&state, name);
    let next = cl::set_active(&next, &id); // a fresh list becomes active
    save(repo, &next)?;
    report(
        &next,
        json,
        &format!("Created changelist '{name}' (active)."),
    )
}

fn cmd_move(repo: &git::Repo, args: &[String], json: bool) -> Result<String, String> {
    if args.len() < 2 {
        return Err("usage: glimpse cl mv <list> <path>...".to_string());
    }
    let state = current(repo)?;
    let id = resolve(&state, &args[0]).ok_or_else(|| format!("no such changelist: {}", args[0]))?;
    let mut next = state;
    for path in &args[1..] {
        next = cl::move_file(&next, path, &id);
    }
    save(repo, &next)?;
    report(&next, json, &format!("Moved {} file(s).", args.len() - 1))
}

fn cmd_rm(repo: &git::Repo, args: &[String], json: bool) -> Result<String, String> {
    let token = args.first().ok_or("usage: glimpse cl rm <list>")?;
    let state = current(repo)?;
    let id = resolve(&state, token).ok_or_else(|| format!("no such changelist: {token}"))?;
    if id == cl::DEFAULT_ID {
        return Err("the Default changelist can't be deleted".to_string());
    }
    let next = cl::delete_list(&state, &id);
    save(repo, &next)?;
    report(&next, json, &format!("Deleted changelist '{token}'."))
}

fn cmd_active(repo: &git::Repo, args: &[String], json: bool) -> Result<String, String> {
    let token = args.first().ok_or("usage: glimpse cl active <list>")?;
    let state = current(repo)?;
    let id = resolve(&state, token).ok_or_else(|| format!("no such changelist: {token}"))?;
    let next = cl::set_active(&state, &id);
    save(repo, &next)?;
    report(&next, json, &format!("Active changelist: '{token}'."))
}

fn cmd_commit(repo: &git::Repo, args: &[String], json: bool) -> Result<String, String> {
    let mut token: Option<String> = None;
    let mut message: Option<String> = None;
    let mut it = args.iter();
    while let Some(a) = it.next() {
        match a.as_str() {
            "-m" | "--message" => message = it.next().cloned(),
            _ if token.is_none() => token = Some(a.clone()),
            _ => {}
        }
    }
    let token = token.ok_or("usage: glimpse cl commit <list> -m <message>")?;
    let message = message.ok_or("a commit message is required (-m \"...\")")?;

    let state = current(repo)?;
    let id = resolve(&state, &token).ok_or_else(|| format!("no such changelist: {token}"))?;
    let members: Vec<String> = state
        .lists
        .iter()
        .find(|l| l.id == id)
        .map(|l| l.members.clone())
        .unwrap_or_default();
    if members.is_empty() {
        return Err(format!("changelist '{token}' has no files to commit"));
    }

    let git_output = repo.commit_paths(&message, &members, false)?;
    // Prune the now-committed paths from the store so it reflects reality.
    let after = cl::reconcile(&state, &changed_paths(repo)?);
    save(repo, &after)?;

    if json {
        Ok(format!(
            "{}\n",
            serde_json::json!({ "committed": members, "output": git_output.trim() })
        ))
    } else {
        let mut out = format!("Committed {} file(s) from '{token}'.\n", members.len());
        let trimmed = git_output.trim();
        if !trimmed.is_empty() {
            out.push_str(trimmed);
            out.push('\n');
        }
        Ok(out)
    }
}

fn help() -> String {
    "glimpse cl — manage changelists from the command line

Usage:
  glimpse cl [ls]                 List changelists and their files (default)
  glimpse cl add <name>           Create a changelist and make it active
  glimpse cl mv <list> <path>...  Move files into <list>
  glimpse cl rm <list>            Delete a changelist (files fall back to Default)
  glimpse cl active <list>        Set the active changelist
  glimpse cl commit <list> -m <message>
                                  Commit exactly that changelist's files

Options:
  --json            Machine-readable output (the changelists.json contract)
  -C, --repo <dir>  Repository directory (default: current directory)
  -h, --help        Show this help

<list> matches a changelist by id or (case-insensitive) name; 'default' is the
permanent Default list. Membership is stored in <git-dir>/glimpse/changelists.json,
the same file the glimpse app uses.
"
    .to_string()
}
