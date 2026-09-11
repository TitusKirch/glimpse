//! Instrumentation of the git seam: what ran, and what to do to it.
//!
//! glimpse shells out to the real git binary, which makes every interesting
//! thing the app does a subprocess nobody can see. Both halves of the answer
//! live here, and both hang off [`Repo::run`](super::Repo::run) — the single
//! place git actually starts:
//!
//! * the **command log**, an in-memory ring buffer of the invocations this
//!   process made (the exact argv, how long it took, whether it failed), read
//!   back by the `git_command_log` command for Settings → Developer →
//!   Diagnostics; and
//! * the **fault switches**, which make git calls slow or make them fail, so the
//!   loading and error paths can be walked deliberately instead of by breaking a
//!   repository on purpose.
//!
//! Two rules the buffer is built around:
//!
//! * **Nothing here is a secret store.** The command is [`describe`]d, which
//!   already redacts URL userinfo, and stderr goes through the same
//!   [`redact_credentials`](crate::platform::redact_credentials). Git's *stdout*
//!   is never recorded at all — it carries file contents, blobs and diffs, none
//!   of which belong in something built to be pasted into a bug report.
//! * **The log never takes git down.** A poisoned lock is recovered from rather
//!   than unwrapped: failing to record a call must not fail the call.
//!
//! The buffer lives in memory only — never written to disk, gone when the
//! process exits — and recording starts at process start rather than when dev
//! mode is switched on, because the call worth reading about is the one that
//! already happened.

use crate::platform::redact_credentials;
use serde::Serialize;
use std::collections::VecDeque;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Mutex, MutexGuard, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use ts_rs::TS;

/// How many invocations the buffer keeps. Fixed rather than tuned: a
/// `repo-changed` refresh costs several git calls, the WSL poller checks every
/// two seconds and auto-fetch runs on a minute timer, so the buffer turns over
/// fast — 500 carries roughly the last 30–60 refreshes, which is the window a
/// "what did it just do?" question actually reaches back into.
pub const CAP: usize = 500;

/// Longest stderr excerpt an entry keeps. A pathological failure (a conflict
/// listing every file in the tree) must not turn 500 entries into megabytes.
const MAX_ERROR: usize = 2000;

/// How long a simulated slow call sleeps before git runs. Long enough that a
/// spinner is unmistakably a spinner, short enough that the app stays usable
/// while the switch is on.
pub const SLOW_MS: u64 = 3000;

/// What an injected failure says. Deliberately shaped like git's own stderr
/// (lowercase, `fatal:`-prefixed) so it travels the real path: `run` appends the
/// invocation, `cleanGitError` strips the prefix, and the UI shows it exactly as
/// it would show a real one.
pub const INJECTED_FAILURE: &str = "fatal: glimpse simulated git failure";

/// One real git invocation.
#[derive(Clone, Debug, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct GitCommandEntry {
    /// Per-process counter, so the frontend has a stable key and a gap is
    /// visible when the buffer has dropped the oldest entries.
    pub seq: u32,
    /// Wall clock, milliseconds since the Unix epoch. Rendered by the frontend
    /// in the viewer's own locale rather than formatted here.
    pub at: f64,
    /// The invocation as [`GitTarget::describe`](crate::platform::GitTarget::describe)
    /// renders it — program, WSL prefix, flags and all, with URL credentials
    /// redacted.
    pub command: String,
    /// How long the subprocess took, start to finish.
    pub duration_ms: u32,
    pub ok: bool,
    /// Git's stderr when the call failed, redacted and truncated; empty when it
    /// succeeded. A failure line without git's own message is close to useless
    /// in the bug report this log exists to feed.
    pub error: String,
}

impl GitCommandEntry {
    /// The entry a finished invocation records. `command` arrives already
    /// redacted (it is `describe`'s output); `error` is git's raw stderr, so it
    /// is redacted here and bounded — it is the one field carrying text glimpse
    /// did not write itself.
    fn finished(
        seq: u32,
        at: f64,
        command: String,
        duration: Duration,
        ok: bool,
        error: &str,
    ) -> Self {
        let mut error = redact_credentials(error);
        if error.len() > MAX_ERROR {
            // Cut on a char boundary — stderr is arbitrary UTF-8.
            let end = (0..=MAX_ERROR)
                .rev()
                .find(|i| error.is_char_boundary(*i))
                .unwrap_or(0);
            error.truncate(end);
            error.push('…');
        }
        GitCommandEntry {
            seq,
            at,
            command,
            duration_ms: duration.as_millis().min(u128::from(u32::MAX)) as u32,
            ok,
            error,
        }
    }
}

/// The ring buffer itself, split from the process-wide instance so its
/// capacity and ordering are testable without a global anyone else is writing
/// to at the same time.
#[derive(Default)]
pub struct CommandLog {
    entries: VecDeque<GitCommandEntry>,
}

impl CommandLog {
    /// Append, dropping the oldest entry once the buffer is full.
    pub fn push(&mut self, entry: GitCommandEntry) {
        while self.entries.len() >= CAP {
            self.entries.pop_front();
        }
        self.entries.push_back(entry);
    }

    /// The buffer's contents, oldest first.
    pub fn entries(&self) -> Vec<GitCommandEntry> {
        self.entries.iter().cloned().collect()
    }
}

/// The Simulation page's git fault switches, as the git seam sees them.
///
/// Fault injection sits behind `Repo::run` rather than at the IPC seam so its
/// scope is git *by construction*: the updater, the app version, the CLI status,
/// the watcher and the external-open commands keep working whatever is switched
/// on, which means a switch can never take out the route to switching it off.
/// The accepted cost is that non-git IPC error paths stay untestable from that
/// page.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Faults {
    /// Every git call fails, with [`INJECTED_FAILURE`] as its stderr.
    pub fail: bool,
    /// Every git call takes [`SLOW_MS`] longer than it really does.
    pub slow: bool,
}

impl Faults {
    /// How long to sleep before git runs, or `None` to run it now. A real
    /// `thread::sleep`, not a faked timestamp: the point is to see what the app
    /// does while a call is genuinely outstanding.
    pub fn delay(self) -> Option<Duration> {
        self.slow.then(|| Duration::from_millis(SLOW_MS))
    }

    /// The stderr an injected failure produces, or `None` to really run git.
    pub fn injected_failure(self) -> Option<&'static str> {
        self.fail.then_some(INJECTED_FAILURE)
    }
}

/// Process-wide state. `static` rather than Tauri-managed state so `Repo::run`
/// — which has no `AppHandle` and never should — can reach it, and so the whole
/// thing is session-only by construction: it lives in this process and dies with
/// it, which is what the Simulation page's switches are required to be.
struct Shared {
    log: Mutex<CommandLog>,
    faults: Mutex<Faults>,
}

fn shared() -> &'static Shared {
    static SHARED: OnceLock<Shared> = OnceLock::new();
    SHARED.get_or_init(|| Shared {
        log: Mutex::new(CommandLog::default()),
        faults: Mutex::new(Faults::default()),
    })
}

/// Recover from a poisoned lock instead of unwrapping it: a panic somewhere else
/// must not turn the diagnostic buffer into a second failure, and there is no
/// invariant here a half-written entry could break.
fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Record one finished invocation. `command` is `describe`'s output (already
/// redacted); `error` is git's raw stderr, empty when the call succeeded.
pub fn record(command: String, duration: Duration, ok: bool, error: &str) {
    static SEQ: AtomicU32 = AtomicU32::new(0);
    let seq = SEQ.fetch_add(1, Ordering::Relaxed);
    let at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0.0, |d| d.as_millis() as f64);
    lock(&shared().log).push(GitCommandEntry::finished(
        seq, at, command, duration, ok, error,
    ));
}

/// The invocations recorded so far, oldest first.
pub fn entries() -> Vec<GitCommandEntry> {
    lock(&shared().log).entries()
}

/// What is currently bending git calls.
pub fn faults() -> Faults {
    *lock(&shared().faults)
}

/// Flip the switches. The frontend's simulation store is the source of truth and
/// re-asserts this at boot, so a webview reload can never leave a switch on with
/// nothing on screen saying so.
pub fn set_faults(faults: Faults) {
    *lock(&shared().faults) = faults;
}

#[cfg(test)]
mod tests {
    use super::{CommandLog, GitCommandEntry, CAP};

    fn entry(seq: u32) -> GitCommandEntry {
        GitCommandEntry {
            seq,
            at: 0.0,
            command: format!("git -C /repo status {seq}"),
            duration_ms: 1,
            ok: true,
            error: String::new(),
        }
    }

    #[test]
    fn faults_are_off_until_switched_on_and_compose() {
        use super::Faults;
        // Nothing bent: git runs, and it runs now.
        let off = Faults::default();
        assert_eq!(off.delay(), None);
        assert_eq!(off.injected_failure(), None);
        // Slow and failing are independent, and combine — "the call takes ages
        // and *then* fails" is its own path through the UI.
        let slow = Faults {
            slow: true,
            ..Faults::default()
        };
        assert_eq!(
            slow.delay(),
            Some(std::time::Duration::from_millis(super::SLOW_MS))
        );
        assert_eq!(slow.injected_failure(), None);
        let both = Faults {
            fail: true,
            slow: true,
        };
        assert_eq!(
            both.delay(),
            Some(std::time::Duration::from_millis(super::SLOW_MS))
        );
        // Shaped like git's own stderr, so it travels the real error path.
        assert_eq!(both.injected_failure(), Some(super::INJECTED_FAILURE));
        assert!(super::INJECTED_FAILURE.starts_with("fatal: "));
    }

    #[test]
    fn records_stderr_redacted_and_bounded() {
        // The failure message is the point of a failed entry — a bug report with
        // "it failed" and no reason is not a bug report — but it is also the one
        // field carrying text glimpse never wrote, so it goes through the same
        // redaction the invocation does and is bounded before it is kept.
        let stderr = format!(
            "fatal: unable to access 'https://u:tok@github.com/x.git/'\n{}",
            "x".repeat(super::MAX_ERROR)
        );
        let e = GitCommandEntry::finished(
            7,
            0.0,
            "git -C /repo fetch".into(),
            std::time::Duration::from_millis(1234),
            false,
            &stderr,
        );
        assert!(!e.error.contains("tok"), "credential kept: {}", e.error);
        assert!(e.error.contains("https://***@github.com/x.git/"));
        // Bounded to the cap plus the one character that says it was cut.
        assert!(
            e.error.chars().count() <= super::MAX_ERROR + 1,
            "unbounded error kept: {} chars",
            e.error.chars().count()
        );
        assert!(e.error.ends_with('…'), "a cut error must say it was cut");
        assert_eq!(e.duration_ms, 1234);
        assert!(!e.ok);
        // A call that worked has nothing to say, and says nothing.
        let ok = GitCommandEntry::finished(
            8,
            0.0,
            "git -C /repo status".into(),
            std::time::Duration::from_millis(3),
            true,
            "",
        );
        assert_eq!(ok.error, "");
    }

    #[test]
    fn keeps_the_most_recent_calls_and_drops_the_oldest() {
        let mut log = CommandLog::default();
        for seq in 0..(CAP as u32 + 10) {
            log.push(entry(seq));
        }
        let got = log.entries();
        assert_eq!(got.len(), CAP, "the buffer is capped");
        // Oldest first, and the ten oldest calls are the ones that went.
        assert_eq!(got.first().unwrap().seq, 10);
        assert_eq!(got.last().unwrap().seq, CAP as u32 + 9);
    }
}
