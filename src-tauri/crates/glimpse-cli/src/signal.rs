//! Telling a running glimpse window that a headless write happened.
//!
//! The CLI runs **standalone** — it never requires a window, and never waits for
//! one. But when a window *is* open on the same repository, it would otherwise
//! learn about a `glimpse stage` only through its debounced filesystem watcher:
//! 400ms at best, and a couple of seconds over the `\\wsl$` share, where the
//! watcher has to poll because native events do not cross the bridge.
//!
//! So a successful write leaves a receipt in the repository's own git dir
//! ([`Repo::write_receipt`]) and the window watches that single small file
//! directly, refreshing at once.
//!
//! # The one rule
//!
//! **A failed notification never fails a successful command.** The write already
//! happened; reporting a non-zero exit because a courtesy file could not be
//! written would tell the caller — a script, CI, an agent — that their commit
//! did not land, which is a lie with consequences. This matches the posture the
//! rest of the repo already takes for best-effort side work: the FS watcher, the
//! WSL shim install and the PATH install all degrade silently rather than
//! failing the thing the user asked for.
//!
//! That is also why this module exposes no `Result`: there is no failure here
//! for a caller to handle, by design, and a signature that offered one would
//! invite a caller to start handling it.

use glimpse_core::git::{Repo, WriteReceipt};

/// Record a completed write for a running GUI. Best-effort, infallible by
/// contract — every error is deliberately dropped.
///
/// Call this **only after** the write itself has succeeded: a receipt for an
/// action that was refused would make the window reload for nothing, and worse,
/// would report a change that never happened.
pub(crate) fn notify_gui(repo: &Repo, action: &str, paths: &[String]) {
    let _ = repo.write_receipt(&WriteReceipt::new(action, paths.to_vec()));
}
