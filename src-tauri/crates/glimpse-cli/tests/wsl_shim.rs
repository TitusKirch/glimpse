//! Cover for the WSL launcher, `scripts/glimpse-wsl.sh` — done-criterion (c)
//! of #103.
//!
//! Inside a WSL shell the installed `glimpse` is that shell script, not a
//! binary, so it is the thing that decides whether `glimpse cl ls` reaches the
//! command line at all. It has two routes and both are asserted here:
//!
//! * **native** — a Linux `glimpse-cli` in the distro, which the shim `exec`s
//!   with argv untouched, so the distro's own git answers and nothing crosses
//!   the Windows boundary;
//! * **fallback** — no native binary, so the subcommand is forwarded to
//!   `glimpse.exe` with the repository translated by `wslpath -w`.
//!
//! Every case runs the real script under `sh` against stub executables that
//! record their argv, because what is under test *is* the argv the script
//! builds. The stubs stand in for `wslpath` and for the Windows binaries —
//! neither exists on a Linux CI runner, and the script's own logic is what is
//! being pinned, not WSL's.
#![cfg(target_os = "linux")]

use std::io::Write;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::Command;

/// The launcher as it ships. Read from the repository rather than copied, so a
/// change to the script is a change to what these tests run.
fn shim() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../scripts/glimpse-wsl.sh")
        .canonicalize()
        .expect("the repository's WSL launcher")
}

/// A per-test scratch directory, removed before and after so reruns start
/// clean.
fn scratch(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("glimpse-shim-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(dir.join("bin")).expect("create the scratch directory");
    dir
}

/// Write an executable shell script.
fn script(path: &Path, body: &str) {
    let mut f = std::fs::File::create(path).expect("create the stub");
    f.write_all(body.as_bytes()).expect("write the stub");
    drop(f);
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).expect("chmod the stub");
}

/// A stub executable that appends its own name and every argument it was given
/// to `log`, one per line, then exits with `code`.
fn recorder(path: &Path, log: &Path, code: i32) {
    script(
        path,
        &format!(
            "#!/bin/sh\nprintf '%s\\n' \"$(basename \"$0\")\" \"$@\" >>'{}'\nexit {code}\n",
            log.display()
        ),
    );
}

/// A `wslpath` stand-in. `-w` maps a Linux path onto this distro's UNC share
/// (the shape the real one produces for a path outside `/mnt`), `-u` undoes it.
/// Anything else is an error, so a call the script makes by accident is loud.
fn stub_wslpath(path: &Path) {
    script(
        path,
        r#"#!/bin/sh
case "$1" in
-w) printf '\\\\wsl.localhost\\Test%s\n' "$(printf '%s' "$2" | tr / '\\')" ;;
-u) printf '%s\n' "$2" ;;
*) echo "wslpath: unexpected $*" >&2; exit 1 ;;
esac
"#,
    );
}

/// One run of the launcher.
struct Run {
    code: i32,
    out: String,
    err: String,
    /// Every line the stubs recorded: the program's basename, then its argv.
    log: Vec<String>,
}

/// The environment one launcher run sees.
struct Env {
    dir: PathBuf,
    /// Extra `KEY=value` pairs, applied after the defaults.
    vars: Vec<(String, String)>,
}

impl Env {
    fn new(tag: &str) -> Self {
        let dir = scratch(tag);
        stub_wslpath(&dir.join("bin/wslpath"));
        Self {
            dir,
            vars: Vec::new(),
        }
    }

    fn log(&self) -> PathBuf {
        self.dir.join("log")
    }

    fn var(&mut self, key: &str, value: &str) -> &Self {
        self.vars.push((key.to_string(), value.to_string()));
        self
    }

    /// Put a recording stub on the stub `PATH` under `name`.
    fn on_path(&self, name: &str) -> &Self {
        recorder(&self.dir.join("bin").join(name), &self.log(), 0);
        self
    }

    /// A recording stub at an absolute path, returned so a test can name it.
    fn binary(&self, name: &str, code: i32) -> PathBuf {
        let path = self.dir.join(name);
        recorder(&path, &self.log(), code);
        path
    }

    fn run(&self, args: &[&str]) -> Run {
        self.run_script(&shim(), args)
    }

    fn run_script(&self, script: &Path, args: &[&str]) -> Run {
        // The stubs first, then the bare system directories the script's own
        // tools (`grep`, `realpath`, `readlink`) live in. Nothing else: a real
        // `glimpse-cli` on the developer's PATH must not decide a test.
        let path = format!("{}:/usr/bin:/bin", self.dir.join("bin").display());
        // An absolute interpreter: `PATH` below holds only the stubs, so the
        // launcher's own environment is exactly what the script sees.
        let mut cmd = Command::new("/bin/sh");
        cmd.arg(script)
            .args(args)
            // Run from a directory inside the scratch tree, so an injected
            // `-C $PWD` is a stable, assertable path.
            .current_dir(&self.dir)
            .env_clear()
            .env("PATH", path)
            .env("HOME", &self.dir)
            .env("XDG_CONFIG_HOME", self.dir.join("config"))
            // The launcher's WSL gate: the distro name is what WSL itself sets,
            // and it is how these tests get past a check that would otherwise
            // only pass on a WSL kernel.
            .env("WSL_DISTRO_NAME", "Test");
        for (k, v) in &self.vars {
            cmd.env(k, v);
        }
        let out = cmd.output().expect("run the launcher");
        Run {
            code: out.status.code().expect("an exit code"),
            out: String::from_utf8_lossy(&out.stdout).into_owned(),
            err: String::from_utf8_lossy(&out.stderr).into_owned(),
            log: std::fs::read_to_string(self.log())
                .unwrap_or_default()
                .lines()
                .map(str::to_string)
                .collect(),
        }
    }
}

impl Drop for Env {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

// ---------------------------------------------------------------------------
// The native route
// ---------------------------------------------------------------------------

#[test]
fn cl_ls_reaches_the_native_command_line_instead_of_dying_as_a_path() {
    // The exact gap #103 names: before subcommand routing, `cl` fell through to
    // the path branch and the launcher answered `no such path: cl`.
    let mut env = Env::new("native-cl");
    let native = env.binary("glimpse-cli", 0);
    let run = env
        .var("GLIMPSE_CLI", native.to_str().unwrap())
        .run(&["cl", "ls", "--json"]);

    assert_eq!(run.code, 0, "stderr: {}", run.err);
    assert!(
        !run.err.contains("no such path"),
        "the old failure is gone: {:?}",
        run.err
    );
    assert_eq!(run.log, vec!["glimpse-cli", "cl", "ls", "--json"]);
}

#[test]
fn a_write_subcommand_runs_natively_with_argv_untouched() {
    // Criterion (c) asks for a write subcommand too. Nothing is translated on
    // this route: the native binary is in the same filesystem as the caller, so
    // the repo-root-relative path contract already holds end to end.
    let mut env = Env::new("native-write");
    let native = env.binary("glimpse-cli", 0);
    let run = env.var("GLIMPSE_CLI", native.to_str().unwrap()).run(&[
        "stage",
        "src/a.ts",
        "-C",
        "/some/repo",
    ]);

    assert_eq!(run.code, 0, "stderr: {}", run.err);
    assert_eq!(
        run.log,
        vec!["glimpse-cli", "stage", "src/a.ts", "-C", "/some/repo"]
    );
}

#[test]
fn the_native_route_propagates_the_exit_code() {
    let mut env = Env::new("native-code");
    let native = env.binary("glimpse-cli", 3);
    let run = env
        .var("GLIMPSE_CLI", native.to_str().unwrap())
        .run(&["status"]);
    assert_eq!(run.code, 3);
}

#[test]
fn a_glimpse_cli_on_the_path_is_found_without_being_configured() {
    // What a distro that installed the Linux package has: no GLIMPSE_CLI, just
    // the binary on PATH.
    let env = Env::new("native-path");
    env.on_path("glimpse-cli");
    let run = env.run(&["status"]);
    assert_eq!(run.code, 0, "stderr: {}", run.err);
    assert_eq!(run.log, vec!["glimpse-cli", "status"]);
}

#[test]
fn the_native_search_never_re_execs_the_launcher_itself() {
    // The Linux package installs its GUI binary as `glimpse`, and that binary
    // answers subcommands too — so `glimpse` on PATH is a legitimate native
    // candidate. The launcher is installed under that same name, so picking it
    // would be an infinite exec loop. It is skipped by its resolved path, and
    // the run falls through to the Windows fallback instead of hanging.
    let mut env = Env::new("native-self");
    std::fs::copy(shim(), env.dir.join("bin/glimpse")).expect("install the launcher on PATH");
    let exe = env.binary("glimpse.exe", 0);
    let run = env
        .var("GLIMPSE_EXE", exe.to_str().unwrap())
        .run(&["status"]);

    assert_eq!(run.code, 0, "stderr: {}", run.err);
    assert_eq!(run.log.first().map(String::as_str), Some("glimpse.exe"));
}

// ---------------------------------------------------------------------------
// The fallback route
// ---------------------------------------------------------------------------

#[test]
fn without_a_native_binary_a_subcommand_is_forwarded_to_windows() {
    // The repository is the one argument that must cross the boundary, so the
    // launcher names it explicitly rather than trusting the interop layer to
    // translate the working directory.
    let mut env = Env::new("fallback-cl");
    let exe = env.binary("glimpse.exe", 0);
    let run = env
        .var("GLIMPSE_EXE", exe.to_str().unwrap())
        .run(&["cl", "ls"]);

    assert_eq!(run.code, 0, "stderr: {}", run.err);
    let unc = format!(
        "\\\\wsl.localhost\\Test{}",
        env.dir.display().to_string().replace('/', "\\")
    );
    assert_eq!(run.log, vec!["glimpse.exe", "-C", &unc, "cl", "ls"]);
}

#[test]
fn a_forwarded_write_keeps_its_repo_root_relative_paths() {
    // Only `-C` names a filesystem path. Every other path argument is
    // repo-root-relative and means the same on both sides of the boundary, so
    // translating one would corrupt it.
    let mut env = Env::new("fallback-write");
    let exe = env.binary("glimpse.exe", 0);
    let run = env
        .var("GLIMPSE_EXE", exe.to_str().unwrap())
        .run(&["stage", "src/a.ts", "--json"]);

    assert_eq!(run.code, 0, "stderr: {}", run.err);
    assert!(
        run.log.contains(&"src/a.ts".to_string()),
        "the spelling survives: {:?}",
        run.log
    );
    assert!(
        run.log
            .iter()
            .all(|a| a != "\\\\wsl.localhost\\Testsrc\\a.ts"),
        "and is not translated: {:?}",
        run.log
    );
}

#[test]
fn an_explicit_repo_is_translated_rather_than_duplicated() {
    let mut env = Env::new("fallback-repo");
    let exe = env.binary("glimpse.exe", 0);
    let run = env
        .var("GLIMPSE_EXE", exe.to_str().unwrap())
        .run(&["status", "-C", "/home/x/repo"]);

    assert_eq!(run.code, 0, "stderr: {}", run.err);
    assert_eq!(
        run.log,
        vec![
            "glimpse.exe",
            "status",
            "-C",
            "\\\\wsl.localhost\\Test\\home\\x\\repo"
        ]
    );
    assert_eq!(
        run.log.iter().filter(|a| *a == "-C").count(),
        1,
        "exactly one -C: {:?}",
        run.log
    );
}

#[test]
fn globals_written_before_the_subcommand_still_reach_the_command_line() {
    // `claims` in the binary looks past leading globals; the launcher has to do
    // the same or `glimpse -C sub status` would be read as a path called `-C`.
    let mut env = Env::new("fallback-globals");
    let exe = env.binary("glimpse.exe", 0);
    let run = env.var("GLIMPSE_EXE", exe.to_str().unwrap()).run(&[
        "-C",
        "/home/x/repo",
        "--json",
        "status",
    ]);

    assert_eq!(run.code, 0, "stderr: {}", run.err);
    assert_eq!(
        run.log,
        vec![
            "glimpse.exe",
            "-C",
            "\\\\wsl.localhost\\Test\\home\\x\\repo",
            "--json",
            "status"
        ]
    );
}

#[test]
fn the_console_binary_beside_glimpse_exe_answers_a_subcommand() {
    // glimpse.exe is a GUI-subsystem program that can only attach to a parent
    // console, so its output is best-effort — which is the wrong bargain for a
    // command line. The console binary is preferred whenever it is there.
    let mut env = Env::new("fallback-console");
    let exe = env.binary("glimpse.exe", 0);
    env.binary("glimpse-cli.exe", 0);
    let run = env
        .var("GLIMPSE_EXE", exe.to_str().unwrap())
        .run(&["status"]);

    assert_eq!(run.code, 0, "stderr: {}", run.err);
    assert_eq!(
        run.log.first().map(String::as_str),
        Some("glimpse-cli.exe"),
        "{:?}",
        run.log
    );
}

#[test]
fn the_console_binary_is_not_used_to_open_a_window() {
    // A path is still the GUI's, and a console binary cannot open one.
    let mut env = Env::new("fallback-window");
    let exe = env.binary("glimpse.exe", 0);
    env.binary("glimpse-cli.exe", 0);
    let run = env.var("GLIMPSE_EXE", exe.to_str().unwrap()).run(&["."]);

    assert_eq!(run.code, 0, "stderr: {}", run.err);
    assert_eq!(run.log.first().map(String::as_str), Some("glimpse.exe"));
}

#[test]
fn the_fallback_route_propagates_the_exit_code() {
    let mut env = Env::new("fallback-code");
    let exe = env.binary("glimpse.exe", 4);
    let run = env
        .var("GLIMPSE_EXE", exe.to_str().unwrap())
        .run(&["status"]);
    assert_eq!(run.code, 4);
}

// ---------------------------------------------------------------------------
// The launcher's own behaviour, unchanged
// ---------------------------------------------------------------------------

#[test]
fn a_path_still_opens_a_window_on_it() {
    let mut env = Env::new("launch-path");
    let exe = env.binary("glimpse.exe", 0);
    let run = env.var("GLIMPSE_EXE", exe.to_str().unwrap()).run(&["."]);

    assert_eq!(run.code, 0, "stderr: {}", run.err);
    let unc = format!(
        "\\\\wsl.localhost\\Test{}",
        env.dir.display().to_string().replace('/', "\\")
    );
    assert_eq!(run.log, vec!["glimpse.exe", &unc]);
}

#[test]
fn a_bare_glimpse_still_focuses_the_app() {
    let mut env = Env::new("launch-bare");
    let exe = env.binary("glimpse.exe", 0);
    let run = env.var("GLIMPSE_EXE", exe.to_str().unwrap()).run(&[]);

    assert_eq!(run.code, 0, "stderr: {}", run.err);
    assert_eq!(run.log, vec!["glimpse.exe"]);
}

#[test]
fn a_path_that_is_not_there_is_still_refused_as_a_path() {
    // The trade the subcommand list makes: a word it does not know is a path
    // again, and the refusal says so rather than "unknown subcommand".
    let mut env = Env::new("launch-missing");
    let exe = env.binary("glimpse.exe", 0);
    let run = env
        .var("GLIMPSE_EXE", exe.to_str().unwrap())
        .run(&["frobnicate"]);

    assert_eq!(run.code, 1);
    assert!(
        run.err.contains("no such path: frobnicate"),
        "{:?}",
        run.err
    );
    assert!(run.log.is_empty(), "nothing was launched: {:?}", run.log);
}

#[test]
fn help_describes_both_jobs_and_needs_neither_route() {
    // `-h` stays the launcher's own: a distro with no native binary and no
    // configured glimpse.exe can still be asked what this command is, and the
    // launcher's usage is the only answer available there.
    let env = Env::new("help");
    let run = env.run(&["--help"]);

    assert_eq!(run.code, 0, "stderr: {}", run.err);
    assert!(run.out.contains("glimpse status"), "{}", run.out);
    assert!(run.out.contains("--exe"), "{}", run.out);
    assert!(run.log.is_empty(), "nothing was launched: {:?}", run.log);
}

#[test]
fn the_bare_help_word_is_the_command_lines_own() {
    // `glimpse help` is a subcommand the binary claims, so it routes like any
    // other — that is where the full command list lives.
    let mut env = Env::new("help-word");
    let native = env.binary("glimpse-cli", 0);
    let run = env
        .var("GLIMPSE_CLI", native.to_str().unwrap())
        .run(&["help"]);

    assert_eq!(run.code, 0, "stderr: {}", run.err);
    assert_eq!(run.log, vec!["glimpse-cli", "help"]);
}

#[test]
fn remembering_glimpse_exe_still_works() {
    let env = Env::new("exe");
    let run = env.run(&["--exe", "/mnt/c/glimpse.exe"]);
    assert_eq!(run.code, 0, "stderr: {}", run.err);
    let saved = std::fs::read_to_string(env.dir.join("config/glimpse/cli.env"))
        .expect("the remembered path");
    assert!(saved.contains("/mnt/c/glimpse.exe"), "{saved}");
}

#[test]
fn the_copy_the_installer_bakes_still_routes_a_subcommand() {
    // What a distro actually runs is not this file: `bake_wsl_shim` in the GUI
    // package injects a fixed `GLIMPSE_EXE` right after `set -eu` and writes
    // *that* into /usr/local/bin/glimpse. The anchor is a literal string match
    // against a shell script in another crate, so it can go stale silently —
    // and until now nothing executed the result. Both halves are pinned here:
    // the anchor is unambiguous, and the baked script still routes.
    let text = std::fs::read_to_string(shim()).expect("read the launcher");
    assert_eq!(
        text.matches("\nset -eu\n").count(),
        1,
        "one `set -eu` for the installer to anchor on"
    );

    let env = Env::new("baked");
    let exe = env.binary("glimpse.exe", 0);
    let baked = env.dir.join("glimpse-baked.sh");
    std::fs::write(
        &baked,
        text.replacen(
            "set -eu",
            &format!(
                "set -eu\nGLIMPSE_EXE=\"${{GLIMPSE_EXE:-{}}}\"",
                exe.display()
            ),
            1,
        ),
    )
    .expect("write the baked copy");

    // No GLIMPSE_EXE in the environment: the baked value is the only way this
    // run can reach the Windows side at all.
    let run = env.run_script(&baked, &["status"]);
    assert_eq!(run.code, 0, "stderr: {}", run.err);
    assert_eq!(run.log.first().map(String::as_str), Some("glimpse.exe"));
}

// ---------------------------------------------------------------------------
// The guard
// ---------------------------------------------------------------------------

/// The words the launcher routes to the command line, read out of the script.
fn shim_subcommands() -> Vec<String> {
    let text = std::fs::read_to_string(shim()).expect("read the launcher");
    let start = text
        .find("GLIMPSE_SUBCOMMANDS=\"")
        .expect("the launcher declares its subcommand list");
    let rest = &text[start + "GLIMPSE_SUBCOMMANDS=\"".len()..];
    let end = rest.find('"').expect("the list is closed");
    rest[..end].split_whitespace().map(str::to_string).collect()
}

#[test]
fn the_launcher_routes_every_word_the_command_line_claims() {
    // Criterion (c)'s standing half: a subcommand that shipped without reaching
    // this list would work everywhere except inside a WSL shell, and would fail
    // there as `no such path` — the exact bug this slice closes. Nothing about
    // adding a subcommand to the code touches a shell script, so the two are
    // pinned to each other here, the way the README is.
    let listed = shim_subcommands();
    for name in glimpse_cli::SUBCOMMANDS
        .iter()
        .chain(glimpse_cli::ALIASES)
        .chain(&["help", "-V", "--version"])
    {
        assert!(
            listed.iter().any(|w| w == name),
            "`{name}` is missing from the launcher's subcommand list, so it \
             would be read as a path inside a WSL shell"
        );
    }
    // And nothing the binary does not claim: a stray word here would shadow a
    // directory of that name, which is the launcher's other job.
    for word in &listed {
        assert!(
            glimpse_cli::claims(std::slice::from_ref(word)),
            "the launcher routes `{word}`, which the command line does not claim"
        );
    }
    // `-h` / `--help` are deliberately not routed — they are the launcher's own
    // (see the help test above) — so the two lists are not equal by design.
    assert!(
        !listed.iter().any(|w| w == "-h" || w == "--help"),
        "the launcher keeps its own help: {listed:?}"
    );
}
