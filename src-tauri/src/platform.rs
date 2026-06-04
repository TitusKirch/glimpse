//! Platform-agnostic resolution of how to invoke `git` for a repository.
//!
//! glimpse never bundles git — it shells out to the system binary. This module
//! is the single place that knows about platform differences; everything built
//! on top of [`GitTarget`] is platform-independent.
//!
//! - **Linux / macOS / Windows:** run the native `git` found on `PATH`.
//! - **Windows + WSL (Windows-only):** a repo that lives in the WSL filesystem
//!   (`\\wsl$\<distro>\...` or `\\wsl.localhost\<distro>\...`) is driven through
//!   that distro's git via `wsl.exe -d <distro> --exec git -C <linux-path>`.
//!
//! Adding a new platform means adding its arm to [`resolve`] / [`native_flavor`]
//! — callers never change.

#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::process::Command;

/// Suppress the flashing console window a Windows console subprocess (git.exe,
/// wsl.exe) would otherwise spawn for every git call. No-op off Windows. Only
/// for internal commands — `open_in` deliberately shows a window.
fn no_window(cmd: &mut Command) -> &mut Command {
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    cmd
}

/// Short platform identifier surfaced to the frontend
/// (`"linux"`, `"macos"`, `"windows"`, `"wsl"`).
pub type Flavor = &'static str;

/// How to reach `git` for a specific repository on the current platform.
pub struct GitTarget {
    program: String,
    prefix_args: Vec<String>,
    /// Path passed to `git -C` (a Linux path inside the distro when via WSL).
    repo_arg: String,
    pub flavor: Flavor,
    pub distro: Option<String>,
}

impl GitTarget {
    /// The platform's null device, valid in the environment git runs in
    /// (`NUL` on native Windows, `/dev/null` on Linux/macOS and inside WSL).
    pub fn null_device(&self) -> &'static str {
        if self.flavor == "windows" {
            "NUL"
        } else {
            "/dev/null"
        }
    }

    /// Build a `Command` running `git <args...>` against this target's repo.
    pub fn command(&self, args: &[&str]) -> Command {
        let mut cmd = Command::new(&self.program);
        no_window(&mut cmd);
        // Keep read-only commands (notably the watcher's repeated `git status`)
        // from grabbing the *optional* index.lock, which would otherwise race a
        // concurrent write and fail with "Unable to create '…/index.lock':
        // File exists". Native git reads this from the host env; the WSL target
        // also injects it inside the distro via `env` (host env doesn't cross
        // the wsl.exe boundary), so set it here for the native case.
        cmd.env("GIT_OPTIONAL_LOCKS", "0");
        cmd.args(&self.prefix_args);
        // Defense in depth: a repository we merely inspect must not be able to
        // run code through its own config. `core.fsmonitor` would otherwise be
        // executed by `git status` (the command run on every open), turning
        // "open a repo" into code execution. A command-line `-c` overrides repo
        // and global config, and disabling fsmonitor has no correctness impact
        // on glimpse (it never relies on it). Diff/show additionally pass
        // `--no-ext-diff --no-textconv` at their call sites for the same reason.
        cmd.arg("-c").arg("core.fsmonitor=");
        cmd.arg("-C").arg(&self.repo_arg);
        cmd.args(args);
        cmd
    }

    /// Map a path git reports *inside* its environment back to a host path that
    /// [`resolve`] routes identically. For WSL the Linux toplevel (`/root/…`)
    /// becomes the `\\wsl.localhost\<distro>\…` UNC so it round-trips; native
    /// paths pass through. Without this a WSL repo's toplevel would resolve to
    /// native git on Windows ("cannot change to '/root/…'").
    pub fn host_path(&self, inner: &str) -> String {
        match &self.distro {
            Some(distro) => {
                let tail = inner.trim_start_matches('/').replace('/', "\\");
                format!("\\\\wsl.localhost\\{distro}\\{tail}")
            }
            None => inner.to_string(),
        }
    }

    /// The exact argv [`command`] would run, as a single string — appended to
    /// error messages so a failing invocation (especially the WSL path) is
    /// visible to the user instead of just git's bare stderr. Credentials
    /// embedded in a remote URL (`https://user:token@host/…`) are redacted so a
    /// failed `add_remote`/`fetch` doesn't echo a secret into a UI toast.
    pub fn describe(&self, args: &[&str]) -> String {
        let mut parts = vec![self.program.clone()];
        parts.extend(self.prefix_args.iter().cloned());
        parts.push("-C".into());
        parts.push(self.repo_arg.clone());
        parts.extend(args.iter().map(|a| redact_credentials(a)));
        parts.join(" ")
    }

    /// Read a working-tree file's content (native fs, or `cat` inside WSL).
    pub fn read_file(&self, rel: &str) -> Option<String> {
        // Stay inside the repository. An absolute `rel` would replace the base
        // in `Path::join` (reading e.g. `/etc/passwd`), and `..` segments would
        // traverse out — both turn this into an arbitrary-file-read primitive.
        // Same rule the git engine applies at the IPC seam (see git::is_unsafe_path).
        if rel.is_empty() || crate::git::is_unsafe_path(rel) {
            return None;
        }
        if let Some(distro) = &self.distro {
            let path = format!("{}/{}", self.repo_arg, rel);
            let mut cmd = Command::new("wsl.exe");
            no_window(&mut cmd);
            let out = cmd
                .args(["-d", distro, "--cd", &self.repo_arg, "--exec", "cat", &path])
                .output()
                .ok()?;
            return out
                .status
                .success()
                .then(|| String::from_utf8_lossy(&out.stdout).into_owned());
        }
        let path = std::path::Path::new(&self.repo_arg).join(rel);
        std::fs::read_to_string(path).ok()
    }

    /// Raw bytes of a working-tree file (native fs, or `cat` inside WSL) — the
    /// binary counterpart of [`read_file`], for images and other blobs.
    pub fn read_file_bytes(&self, rel: &str) -> Option<Vec<u8>> {
        if rel.is_empty() || crate::git::is_unsafe_path(rel) {
            return None;
        }
        if let Some(distro) = &self.distro {
            let path = format!("{}/{}", self.repo_arg, rel);
            let mut cmd = Command::new("wsl.exe");
            no_window(&mut cmd);
            let out = cmd
                .args(["-d", distro, "--cd", &self.repo_arg, "--exec", "cat", &path])
                .output()
                .ok()?;
            return out.status.success().then_some(out.stdout);
        }
        let path = std::path::Path::new(&self.repo_arg).join(rel);
        std::fs::read(path).ok()
    }

    /// Public SSH keys (`*.pub`) under `~/.ssh` in the environment git runs in —
    /// their contents (the lines pasted into a host). Best-effort; empty on error.
    pub fn ssh_public_keys(&self) -> Vec<String> {
        if let Some(distro) = &self.distro {
            let mut cmd = Command::new("wsl.exe");
            no_window(&mut cmd);
            return cmd
                .args([
                    "-d",
                    distro,
                    "--exec",
                    "sh",
                    "-c",
                    "cat ~/.ssh/*.pub 2>/dev/null",
                ])
                .output()
                .ok()
                .filter(|o| o.status.success())
                .map(|o| {
                    String::from_utf8_lossy(&o.stdout)
                        .lines()
                        .map(str::trim)
                        .filter(|l| !l.is_empty())
                        .map(str::to_string)
                        .collect()
                })
                .unwrap_or_default();
        }
        let Some(home) = home_dir() else {
            return Vec::new();
        };
        let mut keys = Vec::new();
        if let Ok(entries) = std::fs::read_dir(std::path::Path::new(&home).join(".ssh")) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().is_some_and(|e| e == "pub") {
                    if let Ok(content) = std::fs::read_to_string(&path) {
                        let trimmed = content.trim();
                        if !trimmed.is_empty() {
                            keys.push(trimmed.to_string());
                        }
                    }
                }
            }
        }
        keys
    }

    /// Generate an ed25519 key (no passphrase) at the default path if none exists,
    /// returning its public key. Errors if a default key is already present (so it
    /// never clobbers an existing one).
    pub fn generate_ssh_key(&self) -> Result<String, String> {
        if let Some(distro) = &self.distro {
            let script = "test -f ~/.ssh/id_ed25519 && { echo 'a key already exists' >&2; exit 1; }; \
                 mkdir -p ~/.ssh && ssh-keygen -t ed25519 -N '' -f ~/.ssh/id_ed25519 -q && cat ~/.ssh/id_ed25519.pub";
            let mut cmd = Command::new("wsl.exe");
            no_window(&mut cmd);
            let out = cmd
                .args(["-d", distro, "--exec", "sh", "-c", script])
                .output()
                .map_err(|e| e.to_string())?;
            if !out.status.success() {
                return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
            }
            return Ok(String::from_utf8_lossy(&out.stdout).trim().to_string());
        }
        let home = home_dir().ok_or("home directory not found")?;
        let ssh = std::path::Path::new(&home).join(".ssh");
        let key = ssh.join("id_ed25519");
        if key.exists() {
            return Err("an ed25519 key already exists".to_string());
        }
        std::fs::create_dir_all(&ssh).map_err(|e| e.to_string())?;
        let mut cmd = Command::new("ssh-keygen");
        no_window(&mut cmd);
        let status = cmd
            .args(["-t", "ed25519", "-N", "", "-q", "-f"])
            .arg(&key)
            .status()
            .map_err(|e| format!("ssh-keygen not available: {e}"))?;
        if !status.success() {
            return Err("ssh-keygen failed".to_string());
        }
        std::fs::read_to_string(key.with_extension("pub"))
            .map(|s| s.trim().to_string())
            .map_err(|e| e.to_string())
    }

    /// Native `git` on the host OS — the default on every platform.
    fn native(repo_path: &str) -> Self {
        GitTarget {
            program: "git".into(),
            prefix_args: Vec::new(),
            repo_arg: repo_path.to_string(),
            flavor: native_flavor(),
            distro: None,
        }
    }
}

/// The user's home directory (`$HOME`, or `%USERPROFILE%` on Windows).
fn home_dir() -> Option<String> {
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .ok()
}

/// Read the `glimpse.target` value from a git config blob. `auto`/empty/unknown
/// → None (use the automatic decision); `native` or an explicit git path → that
/// override. Pure so it is unit-testable.
fn parse_config_target(config: &str) -> Option<String> {
    let mut in_glimpse = false;
    for line in config.lines() {
        let t = line.trim();
        if let Some(section) = t.strip_prefix('[') {
            in_glimpse = section
                .trim_end_matches(']')
                .trim()
                .eq_ignore_ascii_case("glimpse");
            continue;
        }
        if in_glimpse {
            if let Some(rest) = t.strip_prefix("target") {
                let value = rest.trim_start().strip_prefix('=')?.trim();
                return (!value.is_empty()).then(|| value.to_string());
            }
        }
    }
    None
}

/// Per-repo git target override from `<repo>/.git/config` (`glimpse.target`).
/// `native` forces native git (even on a `\\wsl$` path); a value containing a
/// path separator is used as an explicit git binary. Best-effort: a missing or
/// unreadable config just means "no override".
fn target_override(repo_path: &str) -> Option<GitTarget> {
    let config = std::fs::read_to_string(format!("{repo_path}/.git/config")).ok()?;
    let value = parse_config_target(&config)?;
    match value.as_str() {
        "native" => Some(GitTarget::native(repo_path)),
        path if path.contains('/') || path.contains('\\') => Some(GitTarget {
            program: path.to_string(),
            prefix_args: Vec::new(),
            repo_arg: repo_path.to_string(),
            flavor: native_flavor(),
            distro: None,
        }),
        _ => None,
    }
}

/// Decide how to run `git` for `repo_path` on this platform.
pub fn resolve(repo_path: &str) -> GitTarget {
    // An explicit per-repo override wins over the automatic decision.
    if let Some(target) = target_override(repo_path) {
        return target;
    }
    // WSL interop only exists on Windows; everywhere else git is always native.
    #[cfg(windows)]
    if let Some((distro, linux_path)) = parse_wsl_path(repo_path) {
        return GitTarget {
            program: "wsl.exe".into(),
            // `--cd` pins the working dir to the repo so wsl.exe doesn't inherit
            // (and fail on) the untranslatable Windows cwd. `--exec` runs git
            // directly instead of through the WSL login shell, which would
            // otherwise glob-expand args like `--format=%(upstream)`
            // ("missing delimiter for 'u' glob qualifier"). `env
            // GIT_OPTIONAL_LOCKS=0` sets the var inside the distro (host env
            // doesn't cross wsl.exe) so read commands don't take index.lock;
            // `env` then execs git — still no login shell.
            prefix_args: vec![
                "-d".into(),
                distro.clone(),
                "--cd".into(),
                linux_path.clone(),
                "--exec".into(),
                "env".into(),
                "GIT_OPTIONAL_LOCKS=0".into(),
                "git".into(),
            ],
            repo_arg: linux_path,
            flavor: "wsl",
            distro: Some(distro),
        };
    }

    GitTarget::native(repo_path)
}

/// Installed WSL distro names (`wsl.exe -l -q`), for the per-repo target picker.
/// Empty off Windows or when WSL isn't present. `wsl.exe` emits UTF-16LE.
pub fn wsl_distros() -> Vec<String> {
    #[cfg(windows)]
    {
        let mut cmd = Command::new("wsl.exe");
        no_window(&mut cmd);
        let Ok(out) = cmd.args(["-l", "-q"]).output() else {
            return Vec::new();
        };
        if !out.status.success() {
            return Vec::new();
        }
        let utf16: Vec<u16> = out
            .stdout
            .chunks_exact(2)
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .collect();
        String::from_utf16_lossy(&utf16)
            .lines()
            .map(|l| l.trim().trim_matches('\0').trim().to_string())
            .filter(|l| !l.is_empty())
            .collect()
    }
    #[cfg(not(windows))]
    {
        Vec::new()
    }
}

/// Launch an external app rooted at the repo `path`. `app` is one of "files"
/// (file manager), "terminal", or "editor". Tries platform-appropriate
/// candidates in order and succeeds on the first that spawns; best-effort, so a
/// machine without (say) a terminal emulator just gets an error toast.
pub fn open_in(path: &str, app: &str) -> Result<(), String> {
    let candidates = open_candidates(app, path);
    if candidates.is_empty() {
        return Err(format!("unknown target: {app}"));
    }
    for argv in &candidates {
        let (program, args) = argv.split_first().expect("non-empty argv");
        if Command::new(program).args(args).spawn().is_ok() {
            return Ok(());
        }
    }
    Err(format!("could not open {app}"))
}

/// Per-OS list of full argv vectors to try for an open-in target.
fn open_candidates(app: &str, path: &str) -> Vec<Vec<String>> {
    let p = path.to_string();
    #[cfg(target_os = "macos")]
    {
        match app {
            "files" => vec![vec!["open".into(), p]],
            "terminal" => vec![vec!["open".into(), "-a".into(), "Terminal".into(), p]],
            "editor" => vec![vec!["code".into(), p.clone()], vec!["open".into(), p]],
            _ => vec![],
        }
    }
    #[cfg(target_os = "windows")]
    {
        match app {
            "files" => vec![vec!["explorer".into(), p]],
            "terminal" => vec![
                vec!["wt".into(), "-d".into(), p.clone()],
                vec![
                    "cmd".into(),
                    "/c".into(),
                    "start".into(),
                    "cmd".into(),
                    "/k".into(),
                    "cd".into(),
                    "/d".into(),
                    p,
                ],
            ],
            "editor" => vec![vec!["code".into(), p]],
            _ => vec![],
        }
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        match app {
            // wslview/explorer.exe land first under WSL; xdg-open on plain Linux.
            "files" => vec![
                vec!["xdg-open".into(), p.clone()],
                vec!["wslview".into(), p.clone()],
                vec!["explorer.exe".into(), p],
            ],
            "terminal" => vec![
                vec![
                    "x-terminal-emulator".into(),
                    "--working-directory".into(),
                    p.clone(),
                ],
                vec!["gnome-terminal".into(), format!("--working-directory={p}")],
                vec!["konsole".into(), "--workdir".into(), p.clone()],
                vec!["xfce4-terminal".into(), format!("--working-directory={p}")],
            ],
            "editor" => vec![
                vec!["code".into(), p.clone()],
                vec!["codium".into(), p.clone()],
                vec!["xdg-open".into(), p],
            ],
            _ => vec![],
        }
    }
}

/// Strip `user:token@` (or `user@`) userinfo from a URL so a credential
/// embedded in a remote URL never lands in a user-visible error string.
/// Non-URL arguments (paths, refs) pass through unchanged.
fn redact_credentials(s: &str) -> String {
    let Some(scheme_end) = s.find("://") else {
        return s.to_string();
    };
    let after = &s[scheme_end + 3..];
    match after.find('@') {
        // Only treat the part before '@' as userinfo when it is the authority
        // (no '/' yet) — otherwise a '@' in a path would be mangled.
        Some(at) if !after[..at].contains('/') => {
            format!("{}://***@{}", &s[..scheme_end], &after[at + 1..])
        }
        _ => s.to_string(),
    }
}

const fn native_flavor() -> Flavor {
    #[cfg(target_os = "windows")]
    {
        "windows"
    }
    #[cfg(target_os = "macos")]
    {
        "macos"
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        "linux"
    }
}

/// Translate a Windows WSL UNC path into `(distro, linux_path)`, or `None` if it
/// is not a `\\wsl$\…` / `\\wsl.localhost\…` path. Pure string logic — kept out
/// of the `#[cfg(windows)]` call site so it compiles and is tested on every OS
/// (it is the most test-worthy backend string code, see ARCHITECTURE.md §4/§9).
/// Only [`resolve`]'s *use* of it is Windows-gated.
///
/// `\\wsl$\Ubuntu-22.04\home\u\repo` -> (`Ubuntu-22.04`, `/home/u/repo`).
#[cfg_attr(not(windows), allow(dead_code))]
fn parse_wsl_path(path: &str) -> Option<(String, String)> {
    let normalized = path.replace('/', "\\");
    let rest = normalized
        .strip_prefix("\\\\wsl$\\")
        .or_else(|| normalized.strip_prefix("\\\\wsl.localhost\\"))?;
    let mut parts = rest.splitn(2, '\\');
    let distro = parts.next()?.to_string();
    let tail = parts.next().unwrap_or("");
    let linux_path = format!("/{}", tail.replace('\\', "/"));
    Some((distro, linux_path))
}

#[cfg(test)]
mod tests {
    use super::{parse_config_target, parse_wsl_path};

    #[test]
    fn parses_glimpse_target_override() {
        let cfg = "[core]\n\tbare = false\n[glimpse]\n\ttarget = native\n";
        assert_eq!(parse_config_target(cfg).as_deref(), Some("native"));
        // A path value survives intact.
        let cfg = "[glimpse]\ntarget = /opt/git/bin/git\n";
        assert_eq!(
            parse_config_target(cfg).as_deref(),
            Some("/opt/git/bin/git")
        );
        // No glimpse section, or no target, → None.
        assert_eq!(parse_config_target("[core]\n\tbare = false\n"), None);
        assert_eq!(parse_config_target("[glimpse]\n\tother = x\n"), None);
    }

    #[test]
    fn parses_wsl_unc_path() {
        let (distro, path) = parse_wsl_path("\\\\wsl$\\Ubuntu-22.04\\home\\titus\\repo").unwrap();
        assert_eq!(distro, "Ubuntu-22.04");
        assert_eq!(path, "/home/titus/repo");
    }

    #[test]
    fn parses_wsl_localhost_prefix() {
        let (distro, path) = parse_wsl_path("\\\\wsl.localhost\\Debian\\srv\\app").unwrap();
        assert_eq!(distro, "Debian");
        assert_eq!(path, "/srv/app");
    }

    #[test]
    fn accepts_forward_slashes() {
        // Pickers and IPC may hand us a slash-normalized UNC path.
        let (distro, path) = parse_wsl_path("//wsl$/Ubuntu/home/u").unwrap();
        assert_eq!(distro, "Ubuntu");
        assert_eq!(path, "/home/u");
    }

    #[test]
    fn distro_root_has_no_tail() {
        let (distro, path) = parse_wsl_path("\\\\wsl$\\Ubuntu").unwrap();
        assert_eq!(distro, "Ubuntu");
        assert_eq!(path, "/");
    }

    #[test]
    fn native_paths_are_not_wsl() {
        assert!(parse_wsl_path("C:\\dev\\repo").is_none());
        assert!(parse_wsl_path("/home/u/repo").is_none());
        assert!(parse_wsl_path("\\\\server\\share").is_none());
    }

    #[test]
    fn open_candidates_unknown_is_empty() {
        assert!(super::open_candidates("nope", "/x").is_empty());
    }

    #[test]
    fn redacts_url_credentials() {
        use super::redact_credentials;
        assert_eq!(
            redact_credentials("https://user:token@github.com/x.git"),
            "https://***@github.com/x.git"
        );
        assert_eq!(
            redact_credentials("https://token@github.com/x.git"),
            "https://***@github.com/x.git"
        );
        // No userinfo, a path '@', and non-URL args pass through unchanged.
        assert_eq!(
            redact_credentials("https://github.com/a@b"),
            "https://github.com/a@b"
        );
        assert_eq!(redact_credentials("origin"), "origin");
        assert_eq!(redact_credentials("/home/u/repo"), "/home/u/repo");
    }

    #[test]
    fn wsl_toplevel_round_trips_to_unc() {
        // A WSL target's git toplevel (a Linux path) must map back to a UNC that
        // parse_wsl_path routes to the same distro + path — otherwise re-opening
        // the repo falls through to native git and fails.
        let target = super::GitTarget {
            program: "wsl.exe".into(),
            prefix_args: Vec::new(),
            repo_arg: "/root/projects/x".into(),
            flavor: "wsl",
            distro: Some("Ubuntu-22.04".into()),
        };
        let host = target.host_path("/root/projects/comGithub/TitusKirch/glimpse");
        assert_eq!(
            host,
            "\\\\wsl.localhost\\Ubuntu-22.04\\root\\projects\\comGithub\\TitusKirch\\glimpse"
        );
        let (distro, path) = parse_wsl_path(&host).unwrap();
        assert_eq!(distro, "Ubuntu-22.04");
        assert_eq!(path, "/root/projects/comGithub/TitusKirch/glimpse");
    }

    #[test]
    fn native_toplevel_passes_through() {
        let target = super::GitTarget {
            program: "git".into(),
            prefix_args: Vec::new(),
            repo_arg: "C:\\dev\\x".into(),
            flavor: "windows",
            distro: None,
        };
        assert_eq!(target.host_path("C:\\dev\\x"), "C:\\dev\\x");
    }

    #[test]
    fn open_candidates_passes_path_through() {
        // Every candidate for a known app must reference the target path.
        for app in ["files", "terminal", "editor"] {
            let cands = super::open_candidates(app, "/repo/x");
            assert!(!cands.is_empty(), "no candidates for {app}");
            for argv in cands {
                assert!(
                    argv.iter().any(|a| a.contains("/repo/x")),
                    "{app} candidate missing path: {argv:?}"
                );
            }
        }
    }
}
