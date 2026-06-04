mod git;
mod platform;

use std::collections::HashMap;
use std::env;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use notify_debouncer_mini::notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_mini::{new_debouncer, DebounceEventResult, Debouncer};
use tauri::{AppHandle, Emitter, Manager, State};

/// Holds the active filesystem watcher so it stays alive (dropping it stops
/// watching). Only the most recently watched repo is tracked.
struct WatcherState(Mutex<Option<Debouncer<RecommendedWatcher>>>);

/// Per-repository write serialization. Every mutating git command takes its
/// repo's lock, so two never run at once and can't collide on `index.lock`
/// (e.g. an auto-refresh-triggered op racing a user merge). Keyed by the repo
/// path the frontend passes. Reads stay lock-free — `GIT_OPTIONAL_LOCKS=0`
/// already keeps them from taking the index lock at all.
#[derive(Default)]
struct RepoLocks(Mutex<HashMap<String, Arc<Mutex<()>>>>);

/// Run `f` while holding `path`'s write lock, serializing it against other
/// mutating commands on the same repo.
fn locked<T>(
    locks: &RepoLocks,
    path: &str,
    f: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    let lock = locks
        .0
        .lock()
        .unwrap()
        .entry(path.to_string())
        .or_default()
        .clone();
    let _guard = lock.lock().unwrap();
    f()
}

/// Current working directory — the frontend uses this as the default repo to open.
#[tauri::command]
async fn default_repo() -> Result<String, String> {
    env::current_dir()
        .map(|p| p.to_string_lossy().to_string())
        .map_err(|e| e.to_string())
}

/// A repo path passed on the command line at first launch (`glimpse <path>`),
/// held until the frontend consumes it once on mount. Unlike a deep link, the
/// CLI is a *trusted, local* entry point: the frontend opens this path without
/// the deep-link confirmation and accepts `\\wsl$` UNC paths (the WSL shim).
#[cfg(desktop)]
#[derive(Default)]
struct CliOpenState(Mutex<Option<String>>);

/// Turn a CLI path argument into an absolute path. Absolute paths (incl. a
/// `\\wsl.localhost\…` UNC from the WSL shim) pass through; a bare `.` becomes
/// `cwd`; any other relative path is joined onto `cwd`. `git -C` resolves the
/// rest, so no canonicalization is needed. A `scheme://` value is rejected: a
/// deep-link URL must never be treated as a trusted path (that would bypass the
/// deep-link confirmation), even when clap captures it as the positional.
#[cfg(desktop)]
fn resolve_cli_path(raw: &str, cwd: &str) -> Option<String> {
    let raw = raw.trim();
    if raw.is_empty() || raw.contains("://") {
        return None;
    }
    if raw == "." {
        return Some(cwd.to_string());
    }
    let p = Path::new(raw);
    let abs = if p.is_absolute() {
        p.to_path_buf()
    } else {
        Path::new(cwd).join(p)
    };
    Some(abs.to_string_lossy().into_owned())
}

/// First positional argument in a raw argv (skipping argv[0] and `-`/`--`
/// flags) — the repo path for a second-instance `glimpse <path>` launch, where
/// only the raw argv is available (not the CLI plugin's parsed matches).
#[cfg(desktop)]
fn first_path_arg(argv: &[String]) -> Option<&str> {
    argv.iter()
        .skip(1)
        .map(String::as_str)
        .find(|a| !a.starts_with('-'))
}

/// Resolve the repo path from a second-instance launch's raw argv + cwd.
#[cfg(desktop)]
fn resolve_cli_path_from_argv(argv: &[String], cwd: &str) -> Option<String> {
    resolve_cli_path(first_path_arg(argv)?, cwd)
}

/// Surface the existing window for a second `glimpse` launch — it should come to
/// the front, not open a tab silently behind whatever else is focused.
#[cfg(desktop)]
fn focus_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Hand the frontend the repo path passed on the CLI this launch, consuming it
/// so it opens only once. None thereafter, in the browser demo, and when the app
/// was launched without a path.
#[cfg(desktop)]
#[tauri::command]
fn take_cli_open_path(state: State<'_, CliOpenState>) -> Option<String> {
    state.0.lock().unwrap().take()
}

// Mobile has no CLI entry point; a no-op stub keeps the command set identical.
#[cfg(not(desktop))]
#[tauri::command]
fn take_cli_open_path() -> Option<String> {
    None
}

/// Install a `glimpse` launcher onto the user's PATH so a repo can be opened
/// from a terminal (`glimpse .`, like `code .`). Idempotent — re-running just
/// refreshes it. Returns the installed launcher path. See `install_cli_impl`.
#[cfg(desktop)]
#[tauri::command]
async fn install_cli() -> Result<String, String> {
    let exe = env::current_exe().map_err(|e| e.to_string())?;
    install_cli_impl(&exe)
}

/// Linux/macOS: a `glimpse` symlink onto PATH pointing at this executable.
/// Replaces an existing one (symlink_metadata also sees a stale/dangling link),
/// so re-installing is a no-op rather than an "already exists" error.
#[cfg(all(desktop, unix))]
fn install_symlink(bin_dir: &Path, exe: &Path) -> Result<std::path::PathBuf, String> {
    use std::os::unix::fs::symlink;
    std::fs::create_dir_all(bin_dir)
        .map_err(|e| format!("cannot create {}: {e}", bin_dir.display()))?;
    let link = bin_dir.join("glimpse");
    if std::fs::symlink_metadata(&link).is_ok() {
        std::fs::remove_file(&link)
            .map_err(|e| format!("cannot replace {}: {e}", link.display()))?;
    }
    symlink(exe, &link).map_err(|e| format!("cannot link {}: {e}", link.display()))?;
    Ok(link)
}

#[cfg(all(desktop, unix))]
fn install_cli_impl(exe: &Path) -> Result<String, String> {
    let home = env::var_os("HOME").ok_or("HOME is not set")?;
    // ~/.local/bin is on PATH by default on modern Linux; macOS uses /usr/local/bin.
    let bin_dir = if cfg!(target_os = "macos") {
        std::path::PathBuf::from("/usr/local/bin")
    } else {
        Path::new(&home).join(".local/bin")
    };
    Ok(install_symlink(&bin_dir, exe)?
        .to_string_lossy()
        .into_owned())
}

/// Linux/macOS: installed if the launcher symlink resolves to *this* executable
/// (a stray `glimpse` from something else doesn't count).
#[cfg(all(desktop, unix))]
fn cli_install_status_impl(exe: &Path) -> Option<String> {
    let home = env::var_os("HOME")?;
    let bin_dir = if cfg!(target_os = "macos") {
        std::path::PathBuf::from("/usr/local/bin")
    } else {
        Path::new(&home).join(".local/bin")
    };
    let link = bin_dir.join("glimpse");
    match std::fs::read_link(&link) {
        Ok(target) if target == exe => Some(link.to_string_lossy().into_owned()),
        _ => None,
    }
}

/// Decode `wsl.exe -l -q` output (UTF-16LE, CRLF-separated) into the installed
/// distro names, dropping blanks and the docker-desktop helper distros (no point
/// installing a launcher there). Pure, so it's tested off Windows; the live
/// enumeration that feeds it is Windows-only.
#[allow(dead_code)] // used by the Windows install path + the unit tests
fn parse_wsl_distros(utf16le: &[u8]) -> Vec<String> {
    let units: Vec<u16> = utf16le
        .chunks_exact(2)
        .map(|c| u16::from_le_bytes([c[0], c[1]]))
        .collect();
    String::from_utf16_lossy(&units)
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty() && !l.starts_with("docker-desktop"))
        .map(str::to_string)
        .collect()
}

/// Bake a fixed `GLIMPSE_EXE` into the WSL launcher so the installed copy locates
/// glimpse.exe without relying on the Windows PATH propagating into WSL — and so
/// it works in every shell, zsh included. Injected right after the shim's `set
/// -eu`; the `${GLIMPSE_EXE:-…}` form still lets an explicit env override win.
#[allow(dead_code)] // used by the Windows install path + the unit tests
fn bake_wsl_shim(shim: &str, exe_unix: &str) -> String {
    // Normalise to LF first: a Windows checkout can convert the embedded script's
    // line endings, and a `#!/bin/sh\r` shebang is rejected by Linux as a bad
    // interpreter (a trailing `\r` would also follow the baked anchor).
    let shim = shim.replace("\r\n", "\n");
    shim.replacen(
        "set -eu",
        &format!("set -eu\nGLIMPSE_EXE=\"${{GLIMPSE_EXE:-{exe_unix}}}\""),
        1,
    )
}

/// Normalise glimpse.exe's Windows path for a `wsl.exe -- wslpath -u <path>`
/// call. `wsl.exe` strips backslashes from the args it forwards, so a literal
/// `C:\Users\…` reaches `wslpath` as `C:Users…` and fails; the forward-slash
/// form survives the hop and `wslpath` accepts it. Pure, so it's tested off
/// Windows (the live `wsl.exe` round-trip that consumes it is Windows-only).
#[allow(dead_code)] // used by the Windows install path + the unit tests
fn wslpath_arg(win_exe: &str) -> String {
    win_exe.replace('\\', "/")
}

/// The WSL launcher script, embedded so the Windows build can drop it into each
/// distro (see `install_wsl_shims`). Kept byte-for-byte in sync with the repo's
/// `scripts/glimpse-wsl.sh`.
#[cfg(all(desktop, windows))]
const WSL_SHIM: &str = include_str!("../../scripts/glimpse-wsl.sh");

/// CREATE_NO_WINDOW — run a child without flashing a console window.
#[cfg(all(desktop, windows))]
const NO_WINDOW: u32 = 0x0800_0000;

/// Windows: add this executable's directory to the *user* PATH so `glimpse`
/// resolves to glimpse.exe. Uses PowerShell's Environment API — unlike `setx`
/// (1024-char truncation) or hand-editing the registry it writes the correct
/// value type and broadcasts the change. The directory is passed via an env var,
/// never interpolated into the script, so there is no command injection.
/// (Mechanism is the documented-safe one; verify in a Windows build.)
///
/// Then, best-effort, install the WSL launcher into each distro so `glimpse .`
/// also works from a WSL shell (it opens this same Windows GUI). WSL failures
/// never fail the Windows install — they just don't extend the returned summary.
#[cfg(all(desktop, windows))]
fn install_cli_impl(exe: &Path) -> Result<String, String> {
    use std::os::windows::process::CommandExt;
    let dir = exe
        .parent()
        .ok_or("cannot determine the install directory")?;
    let script = r#"$d = $env:GLIMPSE_BIN_DIR
$p = [Environment]::GetEnvironmentVariable('Path','User'); if ($null -eq $p) { $p = '' }
$parts = $p -split ';' | Where-Object { $_ -ne '' }
if ($parts -notcontains $d) { [Environment]::SetEnvironmentVariable('Path', ((@($parts) + $d) -join ';'), 'User') }"#;
    let out = std::process::Command::new("powershell")
        .creation_flags(NO_WINDOW)
        .env("GLIMPSE_BIN_DIR", dir)
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .output()
        .map_err(|e| format!("could not run PowerShell: {e}"))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    let win_path = dir.join("glimpse.exe").to_string_lossy().into_owned();
    let distros = install_wsl_shims(exe);
    Ok(if distros.is_empty() {
        win_path
    } else {
        format!("{win_path} (WSL: {})", distros.join(", "))
    })
}

/// Windows: installed if this exe's directory is on the user PATH.
#[cfg(all(desktop, windows))]
fn cli_install_status_impl(exe: &Path) -> Option<String> {
    use std::os::windows::process::CommandExt;
    let dir = exe.parent()?;
    let script = r#"$d = $env:GLIMPSE_BIN_DIR
$p = [Environment]::GetEnvironmentVariable('Path','User'); if ($null -eq $p) { $p = '' }
if (($p -split ';') -contains $d) { Write-Output 'yes' }"#;
    let out = std::process::Command::new("powershell")
        .creation_flags(NO_WINDOW)
        .env("GLIMPSE_BIN_DIR", dir)
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .output()
        .ok()?;
    (out.status.success() && String::from_utf8_lossy(&out.stdout).trim() == "yes")
        .then(|| dir.join("glimpse.exe").to_string_lossy().into_owned())
}

/// Drop the WSL launcher into every installed distro; returns the distros it
/// reached. Best-effort: a distro that errors is simply skipped.
#[cfg(all(desktop, windows))]
fn install_wsl_shims(exe: &Path) -> Vec<String> {
    use std::os::windows::process::CommandExt;
    let win_exe = exe.to_string_lossy().to_string();
    let listed = match std::process::Command::new("wsl.exe")
        .creation_flags(NO_WINDOW)
        .args(["-l", "-q"])
        .output()
    {
        Ok(o) if o.status.success() => o.stdout,
        _ => return Vec::new(),
    };
    parse_wsl_distros(&listed)
        .into_iter()
        .filter(|distro| install_wsl_shim_into(distro, &win_exe).is_ok())
        .collect()
}

/// Ask one distro to translate glimpse.exe's Windows path to its in-distro
/// `/mnt/…` form (via `wslpath -u`, with the path normalised so `wsl.exe`'s arg
/// forwarding doesn't eat the backslashes). Best-effort: returns None on any
/// failure, and the caller installs the launcher anyway.
#[cfg(all(desktop, windows))]
fn wsl_resolve_exe_path(distro: &str, win_exe: &str) -> Option<String> {
    use std::os::windows::process::CommandExt;
    let out = std::process::Command::new("wsl.exe")
        .creation_flags(NO_WINDOW)
        .args(["-d", distro, "--", "wslpath", "-u", &wslpath_arg(win_exe)])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let path = String::from_utf8_lossy(&out.stdout).trim().to_string();
    (!path.is_empty()).then_some(path)
}

/// Install the launcher as `/usr/local/bin/glimpse` inside one distro. That dir
/// is on PATH in every shell (zsh included), and WSL grants passwordless root
/// from the Windows side, so no prompt. glimpse.exe is resolved to its in-distro
/// `/mnt/…` path and baked in so the launcher needs no PATH/config to find it —
/// but resolving is best-effort: if it fails the launcher is still installed and
/// falls back to `glimpse.exe` on PATH at runtime.
#[cfg(all(desktop, windows))]
fn install_wsl_shim_into(distro: &str, win_exe: &str) -> Result<(), String> {
    use std::io::Write;
    use std::os::windows::process::CommandExt;
    let baked = match wsl_resolve_exe_path(distro, win_exe) {
        Some(exe_unix) => bake_wsl_shim(WSL_SHIM, &exe_unix),
        // Normalise to LF here too (bake_wsl_shim does it on the resolved path),
        // so an un-baked install can't ship a CRLF `#!/bin/sh\r` shebang.
        None => WSL_SHIM.replace("\r\n", "\n"),
    };
    let mut child = std::process::Command::new("wsl.exe")
        .creation_flags(NO_WINDOW)
        .args([
            "-d",
            distro,
            "-u",
            "root",
            "--",
            "sh",
            "-c",
            "cat > /usr/local/bin/glimpse && chmod 0755 /usr/local/bin/glimpse",
        ])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    child
        .stdin
        .take()
        .ok_or("no stdin for the WSL writer")?
        .write_all(baked.as_bytes())
        .map_err(|e| e.to_string())?;
    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(())
}

// Mobile has no PATH; a no-op stub keeps the command set identical.
#[cfg(not(desktop))]
#[tauri::command]
async fn install_cli() -> Result<String, String> {
    Err("the command-line launcher is not available on this platform".into())
}

/// Whether the `glimpse` launcher is already installed for this executable — its
/// path if so, else None. Lets the settings UI show an installed state and
/// disable the install action. (The best-effort WSL shim on Windows is not
/// probed here; this reflects the native launcher.)
#[cfg(desktop)]
#[tauri::command]
async fn cli_install_status() -> Option<String> {
    let exe = env::current_exe().ok()?;
    cli_install_status_impl(&exe)
}

#[cfg(not(desktop))]
#[tauri::command]
async fn cli_install_status() -> Option<String> {
    None
}

/// Watch `path` recursively and emit `repo-changed` (debounced) on any change,
/// so the frontend can live-refresh. Replaces any previous watcher. Best-effort
/// over `\\wsl$` shares — the on-focus refresh remains the fallback.
#[tauri::command]
async fn watch_repo(
    app: AppHandle,
    state: State<'_, WatcherState>,
    path: String,
) -> Result<(), String> {
    let handle = app.clone();
    let mut debouncer = new_debouncer(
        Duration::from_millis(400),
        move |res: DebounceEventResult| {
            if res.is_ok() {
                let _ = handle.emit("repo-changed", ());
            }
        },
    )
    .map_err(|e| e.to_string())?;
    debouncer
        .watcher()
        .watch(Path::new(&path), RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;
    *state.0.lock().unwrap() = Some(debouncer);
    Ok(())
}

#[tauri::command]
async fn repo_info(path: String) -> Result<git::RepoInfo, String> {
    git::Repo::open(&path).info()
}

/// Read a git config value. `global` selects `~/.gitconfig` over the repo's
/// local config; `path` still routes the call (native vs. WSL git).
#[tauri::command]
async fn get_config(path: String, key: String, global: bool) -> Result<String, String> {
    git::Repo::open(&path).config_get(&key, global)
}

/// Write a git config value (used for the user's `user.name` / `user.email`
/// identity). Touches a config file, not the index, so it needs no repo lock.
#[tauri::command]
async fn set_config(path: String, key: String, value: String, global: bool) -> Result<(), String> {
    git::Repo::open(&path).config_set(&key, &value, global)
}

#[tauri::command]
async fn git_log(path: String, limit: Option<u32>) -> Result<Vec<git::Commit>, String> {
    // Clamp the window: the frontend raises `limit` 200 at a time with no
    // ceiling, and the graph's lane assignment is super-linear, so an unbounded
    // value is a self-inflicted DoS on the async command path.
    git::Repo::open(&path).log(limit.unwrap_or(100).min(50_000))
}

#[tauri::command]
async fn git_status(path: String) -> Result<Vec<git::StatusEntry>, String> {
    git::Repo::open(&path).status()
}

#[tauri::command]
async fn file_diff(
    path: String,
    file: String,
    staged: bool,
    ignore_whitespace: bool,
    whole: bool,
) -> Result<Option<git::DiffData>, String> {
    git::Repo::open(&path).file_diff(&file, staged, ignore_whitespace, whole)
}

#[tauri::command]
async fn file_history(path: String, file: String) -> Result<Vec<git::Commit>, String> {
    git::Repo::open(&path).file_history(&file)
}

#[tauri::command]
async fn blame(path: String, file: String) -> Result<Vec<git::BlameLine>, String> {
    git::Repo::open(&path).blame(&file)
}

#[tauri::command]
async fn apply_hunk(
    locks: State<'_, RepoLocks>,
    path: String,
    file: String,
    hunk: String,
    reverse: bool,
) -> Result<(), String> {
    locked(&locks, &path, || {
        git::Repo::open(&path).apply_hunk(&file, &hunk, reverse)
    })
}

#[tauri::command]
async fn commit_body(path: String, hash: String) -> Result<String, String> {
    git::Repo::open(&path).commit_body(&hash)
}

#[tauri::command]
async fn commit_files(path: String, hash: String) -> Result<Vec<git::CommitFile>, String> {
    git::Repo::open(&path).commit_files(&hash)
}

#[tauri::command]
async fn commit_file_diff(
    path: String,
    hash: String,
    file: String,
    ignore_whitespace: bool,
    whole: bool,
) -> Result<Option<git::DiffData>, String> {
    git::Repo::open(&path).commit_file_diff(&hash, &file, ignore_whitespace, whole)
}

#[tauri::command]
async fn stage(locks: State<'_, RepoLocks>, path: String, file: String) -> Result<(), String> {
    locked(&locks, &path, || git::Repo::open(&path).stage(&file))
}

#[tauri::command]
async fn unstage(locks: State<'_, RepoLocks>, path: String, file: String) -> Result<(), String> {
    locked(&locks, &path, || git::Repo::open(&path).unstage(&file))
}

#[tauri::command]
async fn commit(
    locks: State<'_, RepoLocks>,
    path: String,
    message: String,
    amend: bool,
) -> Result<String, String> {
    locked(&locks, &path, || {
        git::Repo::open(&path).commit(&message, amend)
    })
}

#[tauri::command]
async fn head_message(path: String) -> Result<String, String> {
    git::Repo::open(&path).head_message()
}

#[tauri::command]
async fn discard(
    locks: State<'_, RepoLocks>,
    path: String,
    file: String,
    untracked: bool,
) -> Result<(), String> {
    locked(&locks, &path, || {
        git::Repo::open(&path).discard(&file, untracked)
    })
}

#[tauri::command]
async fn checkout_branch(
    locks: State<'_, RepoLocks>,
    path: String,
    branch: String,
) -> Result<(), String> {
    locked(&locks, &path, || {
        git::Repo::open(&path).checkout_branch(&branch)
    })
}

#[tauri::command]
async fn merge(
    locks: State<'_, RepoLocks>,
    path: String,
    branch: String,
) -> Result<String, String> {
    locked(&locks, &path, || git::Repo::open(&path).merge(&branch))
}

#[tauri::command]
async fn discard_all(locks: State<'_, RepoLocks>, path: String) -> Result<(), String> {
    locked(&locks, &path, || git::Repo::open(&path).discard_all())
}

#[tauri::command]
async fn push_tags(locks: State<'_, RepoLocks>, path: String) -> Result<String, String> {
    locked(&locks, &path, || git::Repo::open(&path).push_tags())
}

#[tauri::command]
async fn add_remote(
    locks: State<'_, RepoLocks>,
    path: String,
    name: String,
    url: String,
) -> Result<(), String> {
    locked(&locks, &path, || {
        git::Repo::open(&path).add_remote(&name, &url)
    })
}

#[tauri::command]
async fn remove_remote(
    locks: State<'_, RepoLocks>,
    path: String,
    name: String,
) -> Result<(), String> {
    locked(&locks, &path, || {
        git::Repo::open(&path).remove_remote(&name)
    })
}

#[tauri::command]
async fn rename_remote(
    locks: State<'_, RepoLocks>,
    path: String,
    old: String,
    new: String,
) -> Result<(), String> {
    locked(&locks, &path, || {
        git::Repo::open(&path).rename_remote(&old, &new)
    })
}

#[tauri::command]
async fn checkout_commit(
    locks: State<'_, RepoLocks>,
    path: String,
    hash: String,
) -> Result<(), String> {
    locked(&locks, &path, || {
        git::Repo::open(&path).checkout_commit(&hash)
    })
}

#[tauri::command]
async fn create_branch(
    locks: State<'_, RepoLocks>,
    path: String,
    name: String,
) -> Result<(), String> {
    locked(&locks, &path, || {
        git::Repo::open(&path).create_branch(&name)
    })
}

#[tauri::command]
async fn create_branch_at(
    locks: State<'_, RepoLocks>,
    path: String,
    name: String,
    hash: String,
) -> Result<(), String> {
    locked(&locks, &path, || {
        git::Repo::open(&path).create_branch_at(&name, &hash)
    })
}

#[tauri::command]
async fn delete_branch(
    locks: State<'_, RepoLocks>,
    path: String,
    name: String,
) -> Result<(), String> {
    locked(&locks, &path, || {
        git::Repo::open(&path).delete_branch(&name)
    })
}

#[tauri::command]
async fn revert(locks: State<'_, RepoLocks>, path: String, hash: String) -> Result<(), String> {
    locked(&locks, &path, || git::Repo::open(&path).revert(&hash))
}

#[tauri::command]
async fn cherry_pick(
    locks: State<'_, RepoLocks>,
    path: String,
    hash: String,
) -> Result<(), String> {
    locked(&locks, &path, || git::Repo::open(&path).cherry_pick(&hash))
}

#[tauri::command]
async fn reset(
    locks: State<'_, RepoLocks>,
    path: String,
    hash: String,
    mode: git::ResetMode,
) -> Result<(), String> {
    locked(&locks, &path, || git::Repo::open(&path).reset(&hash, mode))
}

#[tauri::command]
async fn rename_branch(
    locks: State<'_, RepoLocks>,
    path: String,
    old: String,
    new: String,
) -> Result<(), String> {
    locked(&locks, &path, || {
        git::Repo::open(&path).rename_branch(&old, &new)
    })
}

#[tauri::command]
async fn set_upstream(
    locks: State<'_, RepoLocks>,
    path: String,
    remote: String,
    branch: String,
) -> Result<(), String> {
    locked(&locks, &path, || {
        git::Repo::open(&path).set_upstream(&remote, &branch)
    })
}

#[tauri::command]
async fn create_tag(
    locks: State<'_, RepoLocks>,
    path: String,
    name: String,
    hash: String,
) -> Result<(), String> {
    locked(&locks, &path, || {
        git::Repo::open(&path).create_tag(&name, &hash)
    })
}

#[tauri::command]
async fn delete_tag(locks: State<'_, RepoLocks>, path: String, name: String) -> Result<(), String> {
    locked(&locks, &path, || git::Repo::open(&path).delete_tag(&name))
}

#[tauri::command]
async fn stash_save(
    locks: State<'_, RepoLocks>,
    path: String,
    message: String,
) -> Result<(), String> {
    locked(&locks, &path, || {
        git::Repo::open(&path).stash_save(&message)
    })
}

#[tauri::command]
async fn stash_pop(
    locks: State<'_, RepoLocks>,
    path: String,
    reference: String,
) -> Result<(), String> {
    locked(&locks, &path, || {
        git::Repo::open(&path).stash_pop(&reference)
    })
}

#[tauri::command]
async fn stash_apply(
    locks: State<'_, RepoLocks>,
    path: String,
    reference: String,
) -> Result<(), String> {
    locked(&locks, &path, || {
        git::Repo::open(&path).stash_apply(&reference)
    })
}

#[tauri::command]
async fn stash_drop(
    locks: State<'_, RepoLocks>,
    path: String,
    reference: String,
) -> Result<(), String> {
    locked(&locks, &path, || {
        git::Repo::open(&path).stash_drop(&reference)
    })
}

#[tauri::command]
async fn fetch(path: String) -> Result<String, String> {
    git::Repo::open(&path).fetch()
}

#[tauri::command]
async fn pull(
    locks: State<'_, RepoLocks>,
    path: String,
    strategy: String,
) -> Result<String, String> {
    locked(&locks, &path, || git::Repo::open(&path).pull(&strategy))
}

#[tauri::command]
async fn resolve_conflict(
    locks: State<'_, RepoLocks>,
    path: String,
    file: String,
    side: String,
) -> Result<(), String> {
    locked(&locks, &path, || {
        git::Repo::open(&path).resolve_conflict(&file, &side)
    })
}

#[tauri::command]
async fn push(
    locks: State<'_, RepoLocks>,
    path: String,
    set_upstream: bool,
    force: bool,
) -> Result<String, String> {
    locked(&locks, &path, || {
        git::Repo::open(&path).push(set_upstream, force)
    })
}

/// Open the repo folder in an external app: "files", "terminal", or "editor".
/// Best-effort and platform-specific; errors surface as a toast in the UI.
#[tauri::command]
async fn open_in(path: String, app: String) -> Result<(), String> {
    platform::open_in(&path, &app)
}

/// The experiment slug baked into this build at compile time
/// (`GLIMPSE_EXPERIMENT`, set by the experiment release workflow), or None for a
/// normal stable/beta/dev build. Drives the sidebar's experiment badge.
#[tauri::command]
fn experiment_name() -> Option<String> {
    option_env!("GLIMPSE_EXPERIMENT")
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

/// Update manifest URL for a release channel. Stable rides the GitHub `latest`
/// alias; beta uses a fixed, rolling `beta` release; an `experiment:<slug>`
/// channel points at that experiment's own rolling release.
#[cfg(desktop)]
fn updater_endpoint(channel: &str) -> Result<String, String> {
    if let Some(slug) = channel.strip_prefix("experiment:") {
        // The slug is interpolated into the release URL. It is persisted in
        // localStorage and only frontend-validated as a free string, so restrict
        // it here to the charset the experiment workflow actually produces
        // (`[a-z0-9-]`). Otherwise a tampered persisted channel could redirect
        // the updater to a different github.com release path (e.g. a downgrade).
        if slug.is_empty()
            || !slug
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        {
            return Err(format!("invalid experiment slug: {slug:?}"));
        }
        return Ok(format!(
            "https://github.com/TitusKirch/glimpse/releases/download/experiment-{slug}/latest.json"
        ));
    }
    Ok(match channel {
        "beta" => {
            "https://github.com/TitusKirch/glimpse/releases/download/beta/latest.json".to_string()
        }
        _ => {
            "https://github.com/TitusKirch/glimpse/releases/latest/download/latest.json".to_string()
        }
    })
}

/// Build an updater pointed at the given channel's manifest. The runtime
/// `endpoints` override is why channel switching needs Rust — the JS `check()`
/// can only read the static config endpoints.
#[cfg(desktop)]
fn channel_updater(
    app: &AppHandle,
    channel: &str,
    force: bool,
) -> Result<tauri_plugin_updater::Updater, String> {
    use tauri_plugin_updater::UpdaterExt;
    let url = updater_endpoint(channel)?
        .parse::<tauri::Url>()
        .map_err(|e| e.to_string())?;
    let mut builder = app
        .updater_builder()
        .endpoints(vec![url])
        .map_err(|e| e.to_string())?;
    // An experiment is chosen explicitly; a manual channel switch (`force`) is
    // too. Either way install the channel's build regardless of whether it is
    // "newer" — moving channel is a deliberate, possibly side/down-grade move
    // (e.g. beta → the latest stable), not an automatic update.
    if force || channel.starts_with("experiment:") {
        builder = builder.version_comparator(|_current, _update| true);
    }
    builder.build().map_err(|e| e.to_string())
}

/// True when SemVer version `b` outranks `a`. A release outranks its own
/// prereleases (0.2.0 > 0.2.0-beta.3) — this is what graduates beta users to a
/// shipped stable. An unparseable version sorts low, so a well-formed version
/// always outranks a malformed one; ties (and two unparseable versions) return
/// false, keeping the incumbent.
#[cfg(desktop)]
fn version_outranks(a: &str, b: &str) -> bool {
    use semver::Version;
    match (Version::parse(a), Version::parse(b)) {
        (Ok(va), Ok(vb)) => vb > va,
        (Err(_), Ok(_)) => true,
        _ => false,
    }
}

/// Pick the higher-versioned of two update candidates.
#[cfg(desktop)]
fn higher_update(
    a: tauri_plugin_updater::Update,
    b: tauri_plugin_updater::Update,
) -> tauri_plugin_updater::Update {
    if version_outranks(&a.version, &b.version) {
        b
    } else {
        a
    }
}

/// Resolve the update to offer for a channel. The beta channel *graduates* to
/// stable: it offers the highest version across *both* the beta and stable
/// feeds, so a beta user moves to the final release the moment it's out
/// (0.2.0-beta.3 → 0.2.0) instead of being offered a now-superseded prerelease
/// first. Checking the feeds in order and taking the first hit was wrong: it
/// surfaced the stale beta even when stable already carried a higher version.
/// Stable / experiment channels check only themselves.
#[cfg(desktop)]
async fn resolve_update(
    app: &AppHandle,
    channel: &str,
    force: bool,
) -> Result<Option<tauri_plugin_updater::Update>, String> {
    if channel != "beta" {
        let updater = channel_updater(app, channel, force)?;
        return updater.check().await.map_err(|e| e.to_string());
    }
    let mut best: Option<tauri_plugin_updater::Update> = None;
    for ch in ["beta", "stable"] {
        let updater = channel_updater(app, ch, force)?;
        if let Some(candidate) = updater.check().await.map_err(|e| e.to_string())? {
            best = Some(match best {
                Some(current) => higher_update(current, candidate),
                None => candidate,
            });
        }
    }
    Ok(best)
}

/// Check the given channel for an available update; returns its version string.
#[cfg(desktop)]
#[tauri::command]
async fn check_update(
    app: AppHandle,
    channel: String,
    force: bool,
) -> Result<Option<String>, String> {
    Ok(resolve_update(&app, &channel, force)
        .await?
        .map(|u| u.version))
}

/// Re-resolve the channel and, if an update exists, download and install it.
#[cfg(desktop)]
#[tauri::command]
async fn install_update(app: AppHandle, channel: String, force: bool) -> Result<(), String> {
    let Some(update) = resolve_update(&app, &channel, force).await? else {
        return Ok(());
    };
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|e| e.to_string())
}

// Mobile has no updater; no-op stubs keep the command set identical per target.
#[cfg(not(desktop))]
#[tauri::command]
async fn check_update(_channel: String, _force: bool) -> Result<Option<String>, String> {
    Ok(None)
}

#[cfg(not(desktop))]
#[tauri::command]
async fn install_update(_channel: String, _force: bool) -> Result<(), String> {
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .manage(WatcherState(Mutex::new(None)))
        .manage(RepoLocks::default());

    // Holds a repo path passed on the launch command line until the frontend
    // consumes it on mount (desktop-only — no CLI entry on mobile).
    #[cfg(desktop)]
    let builder = builder.manage(CliOpenState::default());

    // Single instance MUST be the first plugin: a second `glimpse <path>` launch
    // is funneled into the running window (focus + open in a new tab) instead of
    // spawning a duplicate process. A `glimpse://` deep link delivered to a
    // second instance (Linux/Windows route it via CLI args) is forwarded to the
    // running window's deep-link handling — with its confirmation — rather than
    // mistaken for a trusted path.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
        focus_main_window(app);
        if let Some(url) = argv.iter().skip(1).find(|a| a.starts_with("glimpse://")) {
            let _ = app.emit("deep-link-url", url.clone());
        } else if let Some(path) = resolve_cli_path_from_argv(&argv, &cwd) {
            let _ = app.emit("open-repo", path);
        }
    }));

    let builder = builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        // Persists window size/position/maximized state across restarts.
        // Restores on launch (before show) and saves on exit — handled natively.
        .plugin(tauri_plugin_window_state::Builder::default().build())
        // `glimpse://` deep links (see tauri.conf.json plugins.deep-link).
        .plugin(tauri_plugin_deep_link::init());

    // CLI argument parsing (the `glimpse <path>` positional) — desktop-only.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_cli::init());

    // Auto-update is desktop-only; the plugin needs a signing key + endpoint
    // configured in tauri.conf.json before it can actually fetch updates.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());

    builder
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            // Register the glimpse:// scheme at runtime (needed for dev/Linux);
            // a no-op once the installed bundle owns it.
            #[cfg(desktop)]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let _ = app.deep_link().register_all();
            }
            // A repo path on the launch command line (`glimpse <path>`) is stashed
            // for the frontend to open on mount (it calls take_cli_open_path). The
            // second-instance case is handled by the single-instance callback.
            #[cfg(desktop)]
            {
                use tauri_plugin_cli::CliExt;
                if let Ok(matches) = app.cli().matches() {
                    let resolved = matches
                        .args
                        .get("path")
                        .and_then(|arg| arg.value.as_str())
                        .and_then(|raw| {
                            let cwd = env::current_dir().ok()?;
                            resolve_cli_path(raw, &cwd.to_string_lossy())
                        });
                    if let Some(path) = resolved {
                        *app.state::<CliOpenState>().0.lock().unwrap() = Some(path);
                    }
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            default_repo,
            take_cli_open_path,
            install_cli,
            cli_install_status,
            watch_repo,
            repo_info,
            get_config,
            set_config,
            git_log,
            git_status,
            file_diff,
            commit_body,
            commit_files,
            commit_file_diff,
            file_history,
            blame,
            apply_hunk,
            stage,
            unstage,
            commit,
            head_message,
            discard,
            checkout_branch,
            checkout_commit,
            merge,
            discard_all,
            create_branch,
            create_branch_at,
            delete_branch,
            revert,
            cherry_pick,
            reset,
            rename_branch,
            set_upstream,
            create_tag,
            delete_tag,
            push_tags,
            add_remote,
            remove_remote,
            rename_remote,
            stash_save,
            stash_pop,
            stash_apply,
            stash_drop,
            fetch,
            pull,
            push,
            resolve_conflict,
            open_in,
            experiment_name,
            check_update,
            install_update
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(all(test, desktop))]
mod tests {
    use super::{
        bake_wsl_shim, first_path_arg, parse_wsl_distros, resolve_cli_path, version_outranks,
        wslpath_arg,
    };

    fn argv(parts: &[&str]) -> Vec<String> {
        parts.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn first_path_arg_skips_program_and_flags() {
        assert_eq!(first_path_arg(&argv(&["glimpse", "."])), Some("."));
        assert_eq!(first_path_arg(&argv(&["glimpse"])), None);
        assert_eq!(
            first_path_arg(&argv(&["glimpse", "--new", "/r"])),
            Some("/r")
        );
        assert_eq!(first_path_arg(&argv(&["glimpse", "-n"])), None);
    }

    #[test]
    fn resolve_cli_path_rejects_empty_and_urls() {
        // A deep-link URL captured as the positional must never become a trusted
        // path — that would bypass the deep-link confirmation gate.
        assert_eq!(resolve_cli_path("", "/cwd"), None);
        assert_eq!(resolve_cli_path("   ", "/cwd"), None);
        assert_eq!(resolve_cli_path("glimpse://open?path=/x", "/cwd"), None);
    }

    #[test]
    fn resolve_cli_path_dot_is_cwd() {
        assert_eq!(
            resolve_cli_path(".", "/home/u/p"),
            Some("/home/u/p".to_string())
        );
    }

    #[cfg(unix)]
    #[test]
    fn resolve_cli_path_unix_absolute_and_relative() {
        assert_eq!(
            resolve_cli_path("/abs/x", "/cwd"),
            Some("/abs/x".to_string())
        );
        assert_eq!(
            resolve_cli_path("sub/dir", "/cwd"),
            Some("/cwd/sub/dir".to_string())
        );
    }

    #[cfg(unix)]
    #[test]
    fn install_symlink_points_at_exe_and_is_idempotent() {
        use super::install_symlink;
        let base = std::env::temp_dir().join(format!("glimpse-cli-{}", std::process::id()));
        let bin = base.join("bin");
        let exe = base.join("glimpse-bin");
        std::fs::create_dir_all(&base).unwrap();
        std::fs::write(&exe, b"x").unwrap();
        let link = install_symlink(&bin, &exe).unwrap();
        assert_eq!(std::fs::read_link(&link).unwrap(), exe);
        // Re-running over an existing link replaces it instead of erroring.
        let again = install_symlink(&bin, &exe).unwrap();
        assert_eq!(again, link);
        assert_eq!(std::fs::read_link(&again).unwrap(), exe);
        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn parse_wsl_distros_decodes_and_filters() {
        // `wsl.exe -l -q` emits UTF-16LE, CRLF-separated; docker-desktop helper
        // distros and blank lines are dropped.
        let mut bytes = Vec::new();
        for line in ["docker-desktop\r\n", "Ubuntu-22.04\r\n", "\r\n"] {
            for u in line.encode_utf16() {
                bytes.extend_from_slice(&u.to_le_bytes());
            }
        }
        assert_eq!(parse_wsl_distros(&bytes), vec!["Ubuntu-22.04".to_string()]);
        assert!(parse_wsl_distros(&[]).is_empty());
    }

    #[test]
    fn bake_wsl_shim_injects_exe_once_after_set_eu() {
        let shim = "#!/bin/sh\nset -eu\necho hi\n";
        let out = bake_wsl_shim(shim, "/mnt/c/glimpse.exe");
        assert!(out.starts_with(
            "#!/bin/sh\nset -eu\nGLIMPSE_EXE=\"${GLIMPSE_EXE:-/mnt/c/glimpse.exe}\"\n"
        ));
        // The `${GLIMPSE_EXE:-…}` default leaves an explicit env override able to
        // win, and the injection happens exactly once.
        assert_eq!(out.matches("GLIMPSE_EXE=").count(), 1);
    }

    #[test]
    fn bake_wsl_shim_normalises_crlf_to_lf() {
        // A Windows checkout can embed the shim with CRLF; the installed copy must
        // be LF or `#!/bin/sh` becomes `#!/bin/sh\r` — rejected as a bad interpreter.
        let crlf = "#!/bin/sh\r\nset -eu\r\necho hi\r\n";
        let out = bake_wsl_shim(crlf, "/mnt/c/glimpse.exe");
        assert!(!out.contains('\r'), "all CRs must be stripped");
        assert!(out.starts_with(
            "#!/bin/sh\nset -eu\nGLIMPSE_EXE=\"${GLIMPSE_EXE:-/mnt/c/glimpse.exe}\"\n"
        ));
    }

    #[test]
    fn wslpath_arg_uses_forward_slashes() {
        // wsl.exe eats backslashes from forwarded args, so the path handed to
        // `wslpath -u` must use forward slashes (verified live: the `C:\…` form
        // arrives mangled and wslpath exits 1; the `C:/…` form resolves).
        assert_eq!(
            wslpath_arg(r"C:\Users\titus\AppData\Local\glimpse\glimpse.exe"),
            "C:/Users/titus/AppData/Local/glimpse/glimpse.exe"
        );
        // A path with no backslashes is left untouched.
        assert_eq!(wslpath_arg("/mnt/c/glimpse.exe"), "/mnt/c/glimpse.exe");
    }

    #[test]
    fn newer_version_outranks() {
        assert!(version_outranks("0.2.0", "0.3.0"));
        assert!(version_outranks("0.2.0-beta.1", "0.2.0-beta.2"));
        assert!(version_outranks("0.2.0", "0.3.0-beta.1"));
    }

    #[test]
    fn release_outranks_its_own_prerelease() {
        // The bug: a beta user offered the stale 0.2.0-beta.3 even though the
        // 0.2.0 release already shipped. Stable must win so they graduate to it.
        assert!(version_outranks("0.2.0-beta.3", "0.2.0"));
        assert!(!version_outranks("0.2.0", "0.2.0-beta.3"));
    }

    #[test]
    fn ties_and_downgrades_keep_incumbent() {
        assert!(!version_outranks("0.2.0", "0.2.0"));
        assert!(!version_outranks("0.3.0", "0.2.0"));
        assert!(!version_outranks("0.2.0-beta.2", "0.2.0-beta.1"));
    }

    #[test]
    fn malformed_versions_sort_low() {
        // A well-formed candidate beats garbage; garbage never beats a real one.
        assert!(version_outranks("not-a-version", "0.2.0"));
        assert!(!version_outranks("0.2.0", "not-a-version"));
        assert!(!version_outranks("nonsense", "also-nonsense"));
    }
}
