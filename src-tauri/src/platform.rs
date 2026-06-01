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
        cmd.args(&self.prefix_args);
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
    /// visible to the user instead of just git's bare stderr.
    pub fn describe(&self, args: &[&str]) -> String {
        let mut parts = vec![self.program.clone()];
        parts.extend(self.prefix_args.iter().cloned());
        parts.push("-C".into());
        parts.push(self.repo_arg.clone());
        parts.extend(args.iter().map(|a| a.to_string()));
        parts.join(" ")
    }

    /// Read a working-tree file's content (native fs, or `cat` inside WSL).
    pub fn read_file(&self, rel: &str) -> Option<String> {
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

/// Decide how to run `git` for `repo_path` on this platform.
pub fn resolve(repo_path: &str) -> GitTarget {
    // WSL interop only exists on Windows; everywhere else git is always native.
    #[cfg(windows)]
    if let Some((distro, linux_path)) = parse_wsl_path(repo_path) {
        return GitTarget {
            program: "wsl.exe".into(),
            // `--cd` pins the working dir to the repo so wsl.exe doesn't inherit
            // (and fail on) the untranslatable Windows cwd. `--exec` runs git
            // directly instead of through the WSL login shell, which would
            // otherwise glob-expand args like `--format=%(upstream)`
            // ("missing delimiter for 'u' glob qualifier").
            prefix_args: vec![
                "-d".into(),
                distro.clone(),
                "--cd".into(),
                linux_path.clone(),
                "--exec".into(),
                "git".into(),
            ],
            repo_arg: linux_path,
            flavor: "wsl",
            distro: Some(distro),
        };
    }

    GitTarget::native(repo_path)
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
    use super::parse_wsl_path;

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
