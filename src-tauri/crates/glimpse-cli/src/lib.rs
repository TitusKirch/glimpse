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
mod layout;
mod network;
mod paused;
mod read;
mod refs;
mod signal;
mod write;

pub use write::WRITE_SUBCOMMANDS;

/// The words this CLI answers to, in the order `help` and the README list them.
/// `claims` gates the GUI binary on exactly this list — and a subcommand that is
/// not discoverable from `glimpse --help` **and** the README does not count as
/// shipped (#103), which two tests in `tests/headless.rs` enforce.
pub const SUBCOMMANDS: &[&str] = &[
    "status",
    "diff",
    "log",
    "show",
    "history",
    "blame",
    "branches",
    "tags",
    "remotes",
    "stashes",
    "reflog",
    "worktrees",
    "submodules",
    "sparse",
    "stats",
    "info",
    "stage",
    "unstage",
    "discard",
    "commit",
    "amend",
    "branch",
    "tag",
    "remote",
    "stash",
    "cherry-pick",
    "revert",
    "reset",
    "fetch",
    "pull",
    "push",
    "rebase",
    "bisect",
    "resolve",
    "worktree",
    "submodule",
    "cl",
];

/// Every **verb** of a grouped command, spelled as a user writes it.
///
/// [`SUBCOMMANDS`] carries one word per command, which is what `claims` needs
/// and all the two documentation guards could check while every command was one
/// word. A group hides its real surface behind that word: `branch` alone says
/// nothing about `branch delete`, so a verb could ship undocumented and pass
/// both guards. #103's criterion (b) is about the *action*, not the noun, so the
/// guards read this list too.
///
/// The `ls` verb of each group is deliberately absent: it is not an action of
/// its own, it is the bare group command (`glimpse branch` lists branches), and
/// that spelling is already covered as a [`SUBCOMMANDS`] entry.
pub const GROUPED: &[&str] = &[
    "branch create",
    "branch switch",
    "branch rename",
    "branch delete",
    "branch merge",
    "tag create",
    "tag delete",
    "tag push",
    "remote add",
    "remote rename",
    "remote remove",
    "stash save",
    "stash pop",
    "stash apply",
    "stash drop",
    "rebase continue",
    "rebase skip",
    "rebase abort",
    "bisect start",
    "bisect good",
    "bisect bad",
    "bisect skip",
    "bisect reset",
    "worktree add",
    "worktree remove",
    "submodule update",
    "submodule sync",
    "sparse set",
    "sparse disable",
    "cl add",
    "cl mv",
    "cl rm",
    "cl active",
    "cl commit",
];

/// Long-form spellings and aliases accepted in addition to [`SUBCOMMANDS`].
/// Kept apart so `--help` lists one name per command instead of every synonym.
///
/// `branch` and `stash` used to live here as read-only synonyms for `branches`
/// and `stashes`. They are commands in their own right now — grouped ones, whose
/// verbs write — and the bare spelling still lists, so nothing a user typed
/// before means anything different today.
pub const ALIASES: &[&str] = &["changelist", "sparse-checkout", "file-history"];

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
///
/// Globals written *before* the subcommand are looked past first, so `glimpse
/// -C sub status` reaches the command line from the single installed binary
/// rather than opening a window on a directory called `sub`.
pub fn claims(args: &[String]) -> bool {
    let hoisted = globals_after_the_subcommand(args);
    let args = hoisted.as_deref().unwrap_or(args);
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
    let hoisted = globals_after_the_subcommand(args);
    let args = hoisted.as_deref().unwrap_or(args);
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
        // The long spelling of the sparse group, normalised to the one word the
        // rest of the CLI knows it by — the same door `changelist` opens onto
        // `cl`. Without this the alias would reach only the read view, so
        // `glimpse sparse-checkout disable` would list instead of disabling.
        Some("sparse-checkout") => write::run("sparse", &args[1..], out, err),
        Some(cmd) if write::claims(cmd) => write::run(cmd, &args[1..], out, err),
        Some(cmd) => read::run(cmd, &args[1..], out, err),
    }
}

/// Rewrite argv so the globals a user wrote *before* the subcommand sit after
/// it, where the one parser looks for them.
///
/// `glimpse -C sub status` is the spelling every `git -C` habit produces, and
/// it used to answer `unknown subcommand: -C`: [`run`] dispatches on the first
/// word, and the first word was the option. Moving them is the whole fix —
/// [`parse_globals`] already accepts a global anywhere among a command's
/// arguments, so nothing else has to learn about the second spelling.
///
/// `None` when there is nothing to move: no leading global, or nothing *but*
/// globals. That second case matters — `glimpse -C /repo` names no command, so
/// it stays the GUI's, exactly as before.
///
/// The globals go immediately after the subcommand rather than at the end, so
/// a command's own dangling value option still ends the line: `glimpse -C /r
/// log -n` must report the missing count, not swallow `-C` as it.
fn globals_after_the_subcommand(args: &[String]) -> Option<Vec<String>> {
    let mut leading: Vec<String> = Vec::new();
    let mut i = 0;
    while let Some(a) = args.get(i) {
        match a.as_str() {
            "--json" => {
                leading.push(a.clone());
                i += 1;
            }
            "-C" | "--repo" => {
                leading.push(a.clone());
                i += 1;
                // A dangling `-C` keeps its own error rather than gaining a
                // second voice here: pass through what there is and let
                // `parse_globals` say what is missing.
                if let Some(value) = args.get(i) {
                    leading.push(value.clone());
                    i += 1;
                }
            }
            _ => break,
        }
    }
    let rest = &args[i..];
    if leading.is_empty() || rest.is_empty() {
        return None;
    }
    let mut rebuilt = Vec::with_capacity(args.len());
    rebuilt.push(rest[0].clone());
    rebuilt.extend(leading);
    rebuilt.extend_from_slice(&rest[1..]);
    Some(rebuilt)
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

/// Options a *command* owns that take a value — so the word after them is that
/// value and is never scanned as a global.
///
/// Without this, `glimpse commit -m help` read the message as a request for
/// `--help`: the help text printed, **nothing was committed, and the command
/// exited 0**, which a script reads as "the commit landed". A silent no-op is
/// the worst shape a write command can take. git takes whatever follows `-m`
/// literally — `-m --json` commits a commit whose message is `--json` — and so
/// does this; the value is the caller's, not the parser's to reinterpret.
///
/// `-C`'s own value is consumed by the arm below, for the same reason.
///
/// PUBLIC because a second parser has to agree with this one: the WSL launcher
/// (`scripts/glimpse-wsl.sh`) scans a forwarded argv for `-C` and would read a
/// `-m "-C"` message as naming a repository. `tests/wsl_shim.rs` pins its list
/// against this one in both directions.
pub const VALUE_OPTIONS: &[&str] = &["-m", "--message", "-n", "--max-count"];

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
            opt if VALUE_OPTIONS.contains(&opt) => {
                rest.push(a.clone());
                // A dangling one is passed through as it stands: the command's
                // own parser owns "missing message after -m", and answering it
                // here would say it twice, in two voices.
                if let Some(value) = it.next() {
                    rest.push(value.clone());
                }
            }
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
/// directory, else `.` (a cwd that no longer exists is still worth trying) —
/// then **re-anchor it at the repository root**.
///
/// That second step is what gives the whole command line one path convention.
/// Every path argument — `stage`, `unstage`, `discard`, `diff`, `blame`,
/// `history`, `cl mv` — is **repo-root-relative**: the spelling `glimpse
/// status` prints, `--json` reports back and the changelist store records. So
/// the obvious pipeline (read paths out of one command, feed them to the next)
/// holds from any directory in the tree, which is where a script, CI job or
/// agent actually runs.
///
/// The alternative — cwd-relative, as bare `git` pathspecs are — was the
/// accident rather than the design, and it made the two halves disagree:
/// `status` reported `sub/a.txt` while `discard` from `sub/` accepted neither
/// that nor `a.txt`. One convention, and this is the single seam that applies
/// it, so a command cannot opt out of it by forgetting to.
///
/// Costs one `git rev-parse --show-toplevel` per invocation. A directory that
/// is not in a repository keeps the path it was given, so the command that
/// needs a repository still fails with git's own reason for it.
pub(crate) fn open_repo(dir: Option<String>) -> git::Repo {
    let dir = dir
        .or_else(|| {
            std::env::current_dir()
                .ok()
                .map(|p| p.to_string_lossy().into_owned())
        })
        .unwrap_or_else(|| ".".to_string());
    let repo = git::Repo::open(&dir);
    match repo.toplevel() {
        Ok(root) => git::Repo::open(&root),
        Err(_) => repo,
    }
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
  diff [<file>...] [--staged] [-w]     Working-tree changes as a unified diff
  log [-n <count>]                     Commit history (default: 50)
  show [<commit>]                      One commit: message and files (default: HEAD)
  history <file>                       Commits touching one file, across renames
  blame <file>                         Per-line authorship for one file
  branches                             Local branches, with ahead/behind and upstream
  tags                                 Tag names (same as `glimpse tag`)
  remotes                              Remote names (same as `glimpse remote`)
  stashes                              Saved stash entries, newest first
  reflog [-n <count>]                  Where HEAD has been (default: 50)
  worktrees                            Linked worktrees, their branch and HEAD
  submodules                           Submodules, their commit and sync state
  sparse                               Sparse-checkout state and its patterns
  stats                                Commits, contributors, activity, churn
  info                                 Branch, remotes, tags, stashes, git flavour

Changing a repository:
  stage <file>...                      Add files to the index
  unstage <file>...                    Take files back out of the index
  discard <file>... | --all --force    Throw away uncommitted changes
  commit -m <message>                  Commit what is staged
  amend [-m <message>]                 Rewrite the previous commit

Branches, tags, remotes and stashes:
  branch [ls]                          List local branches
  branch create <name> [<commit>]      Create a branch and switch to it
  branch switch <name>                 Check out an existing branch
  branch rename <old> <new>            Rename a branch
  branch delete <name> [--force]       Delete a branch (--force: unmerged too)
  branch merge <branch>                Merge a branch into the current one
  tag [ls]                             List tags
  tag create <name> [<commit>] [-m <message>] [--sign]
                                       Create a tag (-m makes it annotated)
  tag delete <name>                    Delete a tag
  tag push                             Push every local tag to the remote
  remote [ls]                          List remotes
  remote add <name> <url>              Add a remote
  remote rename <old> <new>            Rename a remote
  remote remove <name>                 Remove a remote
  stash [ls]                           List stash entries
  stash save [-m <message>] [-u] [<file>...]
                                       Put the working tree away (-u: untracked too)
  stash pop [<stash>]                  Restore an entry and remove it (default: stash@{{0}})
  stash apply [<stash>]                Restore an entry and keep it
  stash drop <stash>                   Throw an entry away (the name is required)

Talking to a remote:
  fetch                                Update every remote-tracking branch
  pull [--merge|--rebase|--ff-only]    Bring the upstream's commits down
  push [-u] [--force]                  Publish this branch (--force is a lease)

Moving commits:
  cherry-pick <commit>...              Replay commits onto the current branch
  revert [-m <parent>] <commit>...     Commit the inverse of commits
  reset [--soft|--mixed|--hard] <commit> [--force]
                                       Move the current branch (default: --mixed)

Flows that pause and wait:
  rebase <branch>                      Replay this branch's commits onto <branch>
  rebase continue                      Carry on once the conflicts are settled
  rebase skip                          Drop the commit it stopped on and carry on
  rebase abort                         Put everything back where the rebase started
  bisect start <bad> <good>            Begin hunting the commit that broke it
  bisect good | bisect bad             Say how the commit under test behaved
  bisect skip                          This one cannot be tested; try another
  bisect reset                         End the session and go back to your branch
  resolve <file>... --ours|--theirs    Settle conflicts by taking one whole side

  The git spellings work too: `rebase --continue`, `rebase --abort`.
  In a MERGE, --ours is the branch you are on. In a REBASE they swap: --ours is
  the branch you are rebasing onto, --theirs is your own commit being replayed.

Repository layout:
  worktree [ls]                        List linked worktrees
  worktree add <path> [<commit>]       Create a worktree at <path> (default: a new branch)
  worktree remove <path>               Remove a linked worktree
  submodule [ls]                       List submodules and their sync state
  submodule update                     Check every submodule out at its recorded commit
  submodule sync                       Re-read submodule URLs from .gitmodules
  sparse [ls]                          Show the sparse-checkout state
  sparse set <dir>...                  Narrow the working tree to those directories
  sparse disable                       Restore the whole working tree

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

--json and -C may be written before the command as well as after it, so
`glimpse -C <dir> status` and `glimpse status -C <dir>` mean the same thing.

Every command above works with no glimpse window running, against the same
repository state the app sees. A window that IS open on the repository refreshes
as soon as a write command succeeds.

Anything that destroys work says so and asks for it: naming the subject is the
confirmation (`branch delete <name>`, `stash drop <stash>`), and an action that
names no subject carries --force instead (`discard --all --force`, and
`reset --hard` when there are uncommitted changes). `rebase abort` needs no flag
because the paused rebase IS its subject and what it restores is the commit that
rebase started from; `resolve` needs none either, but it will never pick a side
for you.

Every <file> is relative to the repository root — the spelling `glimpse status`
prints and `--json` reports back — whichever directory you run the command from.
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
    fn a_global_before_the_subcommand_is_still_the_cli_not_the_gui() {
        // The single installed binary decides here whether argv is a command or
        // a path to open. Claiming on argv[0] alone answered "path" for
        // `glimpse -C sub status` and opened a window on nothing.
        assert!(claims(&argv(&["-C", "sub", "status"])));
        assert!(claims(&argv(&["--repo", "/r", "--json", "cl", "ls"])));
        assert!(claims(&argv(&["--json", "status"])));

        // Globals with no command after them name no command: still the GUI's,
        // exactly as before.
        assert!(!claims(&argv(&["-C", "/r"])));
        assert!(!claims(&argv(&["--json"])));
        assert!(!claims(&argv(&["."])));
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
    fn an_options_value_is_never_read_as_a_global() {
        // `glimpse commit -m help` used to print the help and exit 0 without
        // committing — the global scan swallowed the message. The value after a
        // value-taking option belongs to the command, whatever it spells.
        for word in ["help", "-h", "--help", "--json"] {
            let g = parse_globals(&argv(&["-m", word])).unwrap();
            assert!(!g.help, "`-m {word}` is a message, not --help");
            assert!(!g.json, "`-m {word}` is a message, not --json");
            assert_eq!(g.rest, argv(&["-m", word]));
        }
        // The same for `-n`, whose value is likewise the command's.
        let g = parse_globals(&argv(&["log", "-n", "help"])).unwrap();
        assert!(!g.help);
        assert_eq!(g.rest, argv(&["log", "-n", "help"]));

        // A real global still lands, on either side of the option's value.
        let g = parse_globals(&argv(&["--json", "-m", "help", "-C", "/r"])).unwrap();
        assert!(g.json);
        assert_eq!(g.dir.as_deref(), Some("/r"));
        assert_eq!(g.rest, argv(&["-m", "help"]));

        // A dangling value option is passed through so the command that owns it
        // can say what is missing, rather than being silently dropped.
        let g = parse_globals(&argv(&["-m"])).unwrap();
        assert_eq!(g.rest, argv(&["-m"]));
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
