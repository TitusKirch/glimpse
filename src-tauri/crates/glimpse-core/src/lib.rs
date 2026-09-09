//! glimpse's git engine, with no GUI toolkit attached.
//!
//! Everything here used to live inside the Tauri binary, which meant the only
//! way to reach a repository was to start a window. The three modules below are
//! the parts that never needed one:
//!
//! * [`git`] — the shell-out engine. A [`Repo`](git::Repo) is a resolved
//!   repository and every git operation is a method on it.
//! * [`platform`] — how to invoke `git` for a given repo (native, or a WSL
//!   distro's git on Windows). The single place platform differences live.
//! * [`changelist`] — the changelist model, ported from the frontend so the
//!   store on disk has one meaning whoever writes it.
//!
//! The crate carries **no Tauri dependency**, and that is a contract rather than
//! an accident: it is what lets the CLI ship as a plain console binary. See
//! `core_declares_no_tauri_dependency` below, and the `cargo tree` step in CI.

pub mod changelist;
pub mod git;
pub mod platform;

#[cfg(test)]
mod manifest_tests {
    /// The crate's own manifest must not name Tauri. A `cargo tree` in CI proves
    /// the *transitive* claim; this catches the direct one at the moment someone
    /// reaches for `tauri::` in here, which is when the mistake is cheap.
    #[test]
    fn core_declares_no_tauri_dependency() {
        let manifest = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/Cargo.toml"))
            .expect("read glimpse-core/Cargo.toml");
        let offenders: Vec<&str> = manifest
            .lines()
            .map(str::trim)
            .filter(|l| !l.starts_with('#') && l.contains("tauri"))
            .collect();
        assert!(
            offenders.is_empty(),
            "glimpse-core must stay Tauri-free, but its manifest names it: {offenders:?}"
        );
    }
}
