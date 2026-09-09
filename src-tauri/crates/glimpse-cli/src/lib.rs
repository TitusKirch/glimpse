//! glimpse's headless command line.
//!
//! Every command here runs **standalone**: it opens the repository through
//! [`glimpse_core`]'s engine and answers, with no window, no WebView and no
//! running glimpse instance. That is what makes it usable from CI, an SSH
//! session, a script or an agent — the places a GUI cannot go.
//!
//! There are two front doors onto the same [`run`]:
//!
//! * the `glimpse-cli` binary in this crate, a plain **console** program; and
//! * [`try_run_cli`], which the GUI binary calls before it builds a window, so
//!   the single installed `glimpse` executable answers `glimpse status` as well
//!   as `glimpse .`.
//!
//! [`run`] writes into caller-supplied sinks rather than straight to the
//! process streams, so a test asserts on the exact bytes a user would see —
//! stdout, stderr and the exit code — instead of on an internal shape.
//!
//! `glimpse <path>` is deliberately NOT one of these commands: it exists to
//! open a window, so [`claims`] leaves it (and every bare path) to the GUI.

use glimpse_core::git;
use std::io::Write;

mod changelist;
mod read;

/// The words this CLI answers to. `claims` gates the GUI binary on exactly this
/// list, and `help` prints exactly this list — a subcommand that is not
/// discoverable from `glimpse --help` does not count as shipped (#103).
pub const SUBCOMMANDS: &[&str] = &["status", "log", "branches", "info", "cl"];

/// Long-form spellings and aliases accepted in addition to [`SUBCOMMANDS`].
/// Kept apart so `--help` lists one name per command instead of every synonym.
const ALIASES: &[&str] = &["changelist", "branch"];

const VERSION: &str = env!("CARGO_PKG_VERSION");

/// Does this argv belong to the command line rather than to the GUI?
///
/// True only for a word this crate owns — never for a path, so `glimpse .`,
/// `glimpse ../other` and a bare `glimpse` all still open a window.
///
/// A directory that happens to be *named* `status` or `log` is therefore
/// unreachable as `glimpse log`; write `glimpse ./log` and it is a path again.
/// That trade predates this list (`glimpse cl` already made it) and is the price
/// of a subcommand and a positional path sharing one argument slot.
pub fn claims(args: &[String]) -> bool {
    match args.first().map(String::as_str) {
        Some(a) => {
            SUBCOMMANDS.contains(&a)
                || ALIASES.contains(&a)
                || matches!(a, "-h" | "--help" | "help" | "-V" | "--version")
        }
        None => false,
    }
}

/// Run the CLI if argv asks for it. `Some(code)` → handled, the caller should
/// exit with `code`; `None` → not a CLI invocation, launch the GUI.
///
/// Called by the GUI binary, which is why the console attach lives here and not
/// in [`run_from_env`]: the standalone binary already has one.
pub fn try_run_cli() -> Option<i32> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if !claims(&args) {
        return None;
    }
    attach_console();
    Some(run_argv(&args))
}

/// Entry point for the standalone `glimpse-cli` binary: everything in argv is
/// for us, including a word we do not recognise (which is an error, not a path).
pub fn run_from_env() -> i32 {
    let args: Vec<String> = std::env::args().skip(1).collect();
    run_argv(&args)
}

fn run_argv(args: &[String]) -> i32 {
    let code = run(args, &mut std::io::stdout(), &mut std::io::stderr());
    // Both streams may be block-buffered when piped; flush before the caller
    // exits, because `process::exit` runs no destructors.
    let _ = std::io::stdout().flush();
    let _ = std::io::stderr().flush();
    code
}

/// Run one command and return its exit code, writing everything the user would
/// see into `out` and `err`.
pub fn run(args: &[String], out: &mut dyn Write, err: &mut dyn Write) -> i32 {
    match args.first().map(String::as_str) {
        // A bare invocation of the CLI has nothing to do but explain itself.
        None | Some("-h") | Some("--help") | Some("help") => {
            let _ = write!(out, "{}", help());
            0
        }
        Some("-V") | Some("--version") => {
            let _ = writeln!(out, "glimpse {VERSION}");
            0
        }
        Some("cl") | Some("changelist") => changelist::run(&args[1..], out, err),
        Some(cmd) => read::run(cmd, &args[1..], out, err),
    }
}

/// Options every command understands, split off the command's own arguments.
///
/// A pure function over argv so the parsing is testable without a repository —
/// and shared, so `-C` and `--json` mean the same thing on every subcommand
/// rather than being re-implemented per command.
#[derive(Debug)]
pub(crate) struct Globals {
    pub json: bool,
    pub dir: Option<String>,
    pub help: bool,
    /// Everything that was not a global option, in order.
    pub rest: Vec<String>,
}

pub(crate) fn parse_globals(args: &[String]) -> Result<Globals, String> {
    let mut json = false;
    let mut dir: Option<String> = None;
    let mut help = false;
    let mut rest: Vec<String> = Vec::new();
    let mut it = args.iter();
    while let Some(a) = it.next() {
        match a.as_str() {
            "--json" => json = true,
            "-C" | "--repo" => match it.next() {
                Some(p) => dir = Some(p.clone()),
                None => return Err("missing path after -C".to_string()),
            },
            "-h" | "--help" | "help" => help = true,
            _ => rest.push(a.clone()),
        }
    }
    Ok(Globals {
        json,
        dir,
        help,
        rest,
    })
}

/// Was `--json` asked for, read straight off argv rather than off [`Globals`]?
///
/// Only for the one case [`parse_globals`] cannot answer: its own failure. The
/// contract is that a `--json` caller never has to handle a second shape for
/// errors, and `--json` living *inside* the options that failed to parse is no
/// reason to break it — `glimpse status --json -C` is a mistake an agent should
/// read the same way as every other.
///
/// Deliberately naive: a bare scan, no positional awareness, so `-C --json`
/// (where `--json` is the path) would read as a request for JSON. That cannot
/// mislead anyone, because it only runs on the failure path and `-C --json`
/// parses successfully — there is no failure for it to shape.
pub(crate) fn wants_json(args: &[String]) -> bool {
    args.iter().any(|a| a == "--json")
}

/// Open the repository a command should act on: `-C <dir>`, else the current
/// directory, else `.` (a cwd that no longer exists is still worth trying).
pub(crate) fn open_repo(dir: Option<String>) -> git::Repo {
    let dir = dir
        .or_else(|| {
            std::env::current_dir()
                .ok()
                .map(|p| p.to_string_lossy().into_owned())
        })
        .unwrap_or_else(|| ".".to_string());
    git::Repo::open(&dir)
}

/// Report a failure and return the exit code. Under `--json` the failure is
/// itself JSON, so a caller parsing stdout does not need a second shape for
/// errors; otherwise it is a prefixed line on stderr.
///
/// That holds with **no exception**, including a failure in parsing the very
/// options `--json` is one of — see [`wants_json`], which is what closes it.
pub(crate) fn fail(err: &mut dyn Write, json: bool, prefix: &str, msg: &str) -> i32 {
    if json {
        let _ = writeln!(err, "{}", serde_json::json!({ "error": msg }));
    } else {
        let _ = writeln!(err, "{prefix}: {msg}");
    }
    1
}

pub fn help() -> String {
    format!(
        "glimpse {VERSION} — a lightweight, git-native Git client

Usage:
  glimpse [<path>]                     Open a repository in the app (default: .)
  glimpse <command> [options]          Run a command headlessly — no window needed

Reading a repository:
  status                               Changed files in the working tree
  log [-n <count>]                     Commit history (default: 50)
  branches                             Local branches, with ahead/behind and upstream
  info                                 Branch, remotes, tags, stashes, git flavour

Changelists:
  cl [ls]                              List changelists and their files
  cl add <name>                        Create a changelist and make it active
  cl mv <list> <path>...               Move files into <list>
  cl rm <list>                         Delete a changelist (files fall back to Default)
  cl active <list>                     Set the active changelist
  cl commit <list> -m <message>        Commit exactly that changelist's files

Options:
  --json                               Machine-readable output; errors become
                                       {{\"error\": \"...\"}} on stderr
  -C, --repo <dir>                     Repository directory (default: current directory)
  -h, --help                           Show this help
  -V, --version                        Show the version

Every command above works with no glimpse window running, against the same
repository state the app sees.
"
    )
}

/// On Windows the GUI binary has no console (`windows_subsystem = "windows"`);
/// attach to the launching terminal so CLI output is visible. Best-effort — if
/// there is no parent console (double-clicked, piped) it simply does nothing.
/// No-op on every other platform, and unnecessary for the `glimpse-cli` binary,
/// which is a console program to begin with.
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

#[cfg(test)]
mod tests {
    use super::{claims, help, parse_globals, ALIASES, SUBCOMMANDS};

    fn argv(parts: &[&str]) -> Vec<String> {
        parts.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn a_path_is_never_claimed_from_the_gui() {
        // The regression this guards: claiming argv too eagerly turns
        // `glimpse .` — the launcher — into a headless no-op.
        assert!(!claims(&argv(&["."])));
        assert!(!claims(&argv(&["../other"])));
        assert!(!claims(&argv(&["C:\\repos\\x"])));
        assert!(!claims(&argv(&[])));
        assert!(!claims(&argv(&["--new", "/r"])));
    }

    #[test]
    fn every_subcommand_and_alias_is_claimed() {
        for name in SUBCOMMANDS.iter().chain(ALIASES) {
            assert!(claims(&argv(&[name])), "`{name}` should be claimed");
        }
        for flag in ["-h", "--help", "help", "-V", "--version"] {
            assert!(claims(&argv(&[flag])), "`{flag}` should be claimed");
        }
    }

    #[test]
    fn globals_are_recognised_anywhere_in_the_arguments() {
        let g = parse_globals(&argv(&["add", "--json", "Name", "-C", "/repo"])).unwrap();
        assert!(g.json);
        assert_eq!(g.dir.as_deref(), Some("/repo"));
        assert!(!g.help);
        // Order is preserved, and only the non-global words survive.
        assert_eq!(g.rest, argv(&["add", "Name"]));
    }

    #[test]
    fn a_dangling_repo_flag_is_an_error_not_a_silent_default() {
        // Silently falling back to the cwd here would run the command against
        // the wrong repository, which is worse than refusing.
        let e = parse_globals(&argv(&["status", "-C"])).unwrap_err();
        assert!(e.contains("-C"), "{e:?}");
    }

    #[test]
    fn help_documents_every_subcommand() {
        let text = help();
        for name in SUBCOMMANDS {
            assert!(text.contains(name), "`{name}` missing from help:\n{text}");
        }
    }
}
