//! Headless `glimpse cl …` command line — drive changelists from a terminal or
//! a script/agent, without opening the GUI.
//!
//! [`try_run_cli`] is called at the very start of [`crate::run`]: if the first
//! argument is `cl`/`changelist` it handles the command and returns an exit code
//! (the caller then `exit`s before any Tauri/window setup); otherwise it returns
//! `None` and the normal app launches. Everything operates on the same
//! git-native store the GUI uses (`<git-dir>/glimpse/changelists.json`) via the
//! shared model in [`crate::changelist`] and the git engine in [`crate::git`],
//! so the CLI and GUI never disagree.
//!
//! Subcommands: `ls` (default), `add <name>`, `mv <list> <path>…`, `rm <list>`,
//! `active <list>`, `commit <list> -m <msg>`. Global flags: `--json` (machine
//! output), `-C <path>` (repo dir, default cwd), `-h`/`--help`.

use crate::changelist as cl;
use crate::git;
use std::io::Write;

/// Run the CLI if argv asks for it. `Some(code)` → handled, the caller should
/// exit with `code`; `None` → not a CLI invocation, launch the GUI.
pub fn try_run_cli() -> Option<i32> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("cl") | Some("changelist") => {}
        _ => return None,
    }
    attach_console();
    let code = run(&args[1..]);
    // stdout may be block-buffered when piped; flush before the caller exits
    // (process::exit runs no destructors).
    let _ = std::io::stdout().flush();
    let _ = std::io::stderr().flush();
    Some(code)
}

/// On Windows the GUI binary has no console (`windows_subsystem = "windows"`);
/// attach to the launching terminal so CLI output is visible. Best-effort — if
/// there is no parent console (double-clicked, piped) it simply does nothing.
/// No-op on every other platform.
#[cfg(windows)]
fn attach_console() {
    extern "system" {
        fn AttachConsole(dw_process_id: u32) -> i32;
    }
    const ATTACH_PARENT_PROCESS: u32 = 0xFFFF_FFFF;
    unsafe {
        let _ = AttachConsole(ATTACH_PARENT_PROCESS);
    }
}
#[cfg(not(windows))]
fn attach_console() {}

fn run(args: &[String]) -> i32 {
    let mut json = false;
    let mut dir: Option<String> = None;
    let mut rest: Vec<String> = Vec::new();
    let mut it = args.iter();
    while let Some(a) = it.next() {
        match a.as_str() {
            "--json" => json = true,
            "-C" | "--repo" => match it.next() {
                Some(p) => dir = Some(p.clone()),
                None => return fail("missing path after -C"),
            },
            "-h" | "--help" | "help" => {
                print_help();
                return 0;
            }
            _ => rest.push(a.clone()),
        }
    }

    let dir = dir
        .or_else(|| {
            std::env::current_dir()
                .ok()
                .map(|p| p.to_string_lossy().into_owned())
        })
        .unwrap_or_else(|| ".".to_string());
    let repo = git::Repo::open(&dir);

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
        Ok(()) => 0,
        Err(e) => fail(&e),
    }
}

fn fail(msg: &str) -> i32 {
    eprintln!("glimpse cl: {msg}");
    1
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

fn print_human(state: &cl::ChangelistState) {
    for list in &state.lists {
        let marker = if list.id == state.active_id { "*" } else { " " };
        println!("{marker} {} ({})", display_name(list), list.members.len());
        for m in &list.members {
            println!("    {m}");
        }
    }
}

/// Emit the resulting state: the JSON contract for `--json`, else a confirmation
/// line plus the human-readable listing.
fn report(state: &cl::ChangelistState, json: bool, note: &str) -> Result<(), String> {
    if json {
        println!("{}", cl::serialize(state));
    } else {
        println!("{note}");
        print_human(state);
    }
    Ok(())
}

// ── Subcommands ────────────────────────────────────────────────────────────

fn cmd_ls(repo: &git::Repo, json: bool) -> Result<(), String> {
    let state = current(repo)?;
    if json {
        println!("{}", cl::serialize(&state));
    } else {
        print_human(&state);
    }
    Ok(())
}

fn cmd_add(repo: &git::Repo, args: &[String], json: bool) -> Result<(), String> {
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

fn cmd_move(repo: &git::Repo, args: &[String], json: bool) -> Result<(), String> {
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

fn cmd_rm(repo: &git::Repo, args: &[String], json: bool) -> Result<(), String> {
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

fn cmd_active(repo: &git::Repo, args: &[String], json: bool) -> Result<(), String> {
    let token = args.first().ok_or("usage: glimpse cl active <list>")?;
    let state = current(repo)?;
    let id = resolve(&state, token).ok_or_else(|| format!("no such changelist: {token}"))?;
    let next = cl::set_active(&state, &id);
    save(repo, &next)?;
    report(&next, json, &format!("Active changelist: '{token}'."))
}

fn cmd_commit(repo: &git::Repo, args: &[String], json: bool) -> Result<(), String> {
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

    let out = repo.commit_paths(&message, &members, false)?;
    // Prune the now-committed paths from the store so it reflects reality.
    let after = cl::reconcile(&state, &changed_paths(repo)?);
    save(repo, &after)?;

    if json {
        println!(
            "{}",
            serde_json::json!({ "committed": members, "output": out.trim() })
        );
    } else {
        println!("Committed {} file(s) from '{token}'.", members.len());
        let out = out.trim();
        if !out.is_empty() {
            println!("{out}");
        }
    }
    Ok(())
}

fn print_help() {
    println!(
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
the same file the glimpse app uses."
    );
}
