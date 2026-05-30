//! Platform-agnostic resolution of how to invoke `git` for a repository.
//!
//! glimpse never bundles git — it shells out to the system binary. This module
//! is the single place that knows about platform differences; everything built
//! on top of [`GitTarget`] is platform-independent.
//!
//! - **Linux / macOS / Windows:** run the native `git` found on `PATH`.
//! - **Windows + WSL (Windows-only):** a repo that lives in the WSL filesystem
//!   (`\\wsl$\<distro>\...` or `\\wsl.localhost\<distro>\...`) is driven through
//!   that distro's git via `wsl.exe -d <distro> -- git -C <linux-path>`.
//!
//! Adding a new platform means adding its arm to [`resolve`] / [`native_flavor`]
//! — callers never change.

use std::process::Command;

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
        cmd.args(&self.prefix_args);
        cmd.arg("-C").arg(&self.repo_arg);
        cmd.args(args);
        cmd
    }

    /// Read a working-tree file's content (native fs, or `cat` inside WSL).
    pub fn read_file(&self, rel: &str) -> Option<String> {
        if let Some(distro) = &self.distro {
            let path = format!("{}/{}", self.repo_arg, rel);
            let out = Command::new("wsl.exe")
                .args(["-d", distro, "--", "cat", &path])
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
    if let Some((distro, linux_path)) = wsl::parse_path(repo_path) {
        return GitTarget {
            program: "wsl.exe".into(),
            prefix_args: vec!["-d".into(), distro.clone(), "--".into(), "git".into()],
            repo_arg: linux_path,
            flavor: "wsl",
            distro: Some(distro),
        };
    }

    GitTarget::native(repo_path)
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

/// Windows-only WSL support.
#[cfg(windows)]
mod wsl {
    /// `\\wsl$\Ubuntu-22.04\home\u\repo` -> (`Ubuntu-22.04`, `/home/u/repo`).
    pub fn parse_path(path: &str) -> Option<(String, String)> {
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
}
