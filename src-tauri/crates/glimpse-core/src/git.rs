//! Git engine. A [`Repo`] is a resolved repository: the platform decision
//! (native git vs. WSL git) is made once in [`Repo::open`], then every git
//! operation is a method on the handle. Output is decoded by the pure
//! [`parse`] module into serde structs that mirror the frontend's store shapes.

use crate::platform::{self, GitTarget};
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::process::Stdio;
use std::time::Instant;
use ts_rs::TS;

mod parse;
pub mod trace;

const US: char = '\u{1f}'; // unit separator, safe field delimiter

// `git log` date rendering for commit lists shown in the UI (graph history,
// search, file history, commit detail): date + local time so the day *and*
// HH:MM:SS are visible, not just the day. Repository stats keep `--date=short`
// because they aggregate commits by day.
const LOG_DATE: &str = "--date=format:%Y-%m-%d %H:%M:%S";

fn lines(s: &str) -> impl Iterator<Item = &str> {
    s.lines().filter(|l| !l.trim().is_empty())
}

/// Reject a value git could misread as a command-line option. Applied to every
/// ref / branch / tag / hash / remote-name / stash-ref / URL before it reaches
/// git. This is the backend's own authoritative guard, independent of the
/// frontend's zod (which only runs in the browser layer and is bypassed by a
/// direct IPC call, XSS, or attacker-controlled ref names coming back from a
/// malicious repository). A leading `-` is the option-injection vector; control
/// characters can't appear in a valid ref anyway.
fn reject_option(v: &str) -> Result<(), String> {
    if v.is_empty() || v.starts_with('-') || v.bytes().any(|b| b < 0x20) {
        return Err(format!("rejected unsafe argument: {v:?}"));
    }
    Ok(())
}

/// Reject a working-tree path that escapes the repository (absolute path or
/// `..` traversal) or that could inject extra headers into an interpolated
/// patch (CR/LF/NUL). Used for every file path an IPC command passes through.
fn reject_unsafe_path(v: &str) -> Result<(), String> {
    if v.is_empty() || is_unsafe_path(v) {
        return Err(format!("rejected unsafe path: {v:?}"));
    }
    Ok(())
}

/// Reject a hunk body that isn't pure hunk content. Every line of a real hunk
/// begins with a hunk-header (`@`) or a context / add / remove / no-newline
/// marker (` `, `+`, `-`, `\`). A line starting with anything else terminates
/// the hunk in `git apply`'s parser, which would let an attacker smuggle a
/// SECOND file section (e.g. `diff --git a/other …`) and stage content into a
/// different in-repo path. The body is interpolated raw into the patch, so it
/// must be validated as tightly as the file path.
fn reject_unsafe_hunk(hunk: &str) -> Result<(), String> {
    for line in hunk.lines() {
        let valid =
            line.is_empty() || matches!(line.as_bytes()[0], b'@' | b' ' | b'+' | b'-' | b'\\');
        if !valid {
            return Err(format!("rejected unsafe hunk line: {line:?}"));
        }
    }
    Ok(())
}

/// True if `v` escapes the repository or could inject into an interpolated
/// patch. Detects Unix-absolute (`/…`), UNC (`\\…`), and Windows-drive
/// (`C:\…`) paths regardless of the build target — the WSL path runs on Windows
/// where these all matter — plus `..` traversal and CR/LF/NUL. Shared so the
/// native `read_file` sink applies the exact same rule.
pub fn is_unsafe_path(v: &str) -> bool {
    let bytes = v.as_bytes();
    let win_drive = bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':';
    v.starts_with('/')
        || v.starts_with('\\')
        || std::path::Path::new(v).is_absolute()
        || win_drive
        || v.split(['/', '\\']).any(|c| c == "..")
        || v.bytes().any(|b| b == b'\n' || b == b'\r' || b == 0)
}

/// Reduce a unified-diff hunk to only the user-selected `+`/`-` lines, for
/// line-level (sub-hunk) staging. `selected` holds 0-based indices into the hunk
/// body — every context / add / remove line counts; the `@@` header and any
/// `\ No newline` marker do not. The transform is direction-dependent:
///
/// * Staging (`reverse == false`, forward `git apply --cached`): keep context
///   and selected lines; **drop** unselected additions (they must not land in
///   the index) and demote unselected removals to context (the line still exists
///   on the index/old side, so it stays).
/// * Unstaging (`reverse == true`, `git apply --cached --reverse`): the patch is
///   applied backwards, so the roles flip — demote unselected additions to
///   context (they stay staged) and **drop** unselected removals.
///
/// The `@@` line counts are left as-is and recomputed by `git apply --recount`;
/// only the start offsets matter and those are unchanged by the reduction.
fn build_partial_hunk(hunk: &str, selected: &[u32], reverse: bool) -> String {
    let mut out = String::new();
    let mut body: u32 = 0;
    for (i, line) in hunk.lines().enumerate() {
        if i == 0 {
            out.push_str(line);
            out.push('\n');
            continue;
        }
        let Some(&marker) = line.as_bytes().first() else {
            continue; // a blank separator line carries no diff content
        };
        if marker == b'\\' {
            // "\ No newline at end of file" — metadata for the preceding line.
            out.push_str(line);
            out.push('\n');
            continue;
        }
        let rest = &line[1..];
        let idx = body;
        body += 1;
        let keep = selected.contains(&idx);
        let mut push = |m: char| {
            out.push(m);
            out.push_str(rest);
            out.push('\n');
        };
        match marker {
            b' ' => push(' '),
            b'+' => {
                if keep {
                    push('+');
                } else if reverse {
                    push(' ');
                }
            }
            b'-' => {
                if keep {
                    push('-');
                } else if !reverse {
                    push(' ');
                }
            }
            _ => {}
        }
    }
    out
}

/// Parse `git check-attr --stdin -z filter` output into the set of paths whose
/// `filter` attribute is `lfs`. The `-z` stream is flat NUL-separated fields in
/// `path\0 attr\0 value\0` triplets.
fn lfs_from_check_attr(out: &str) -> std::collections::HashSet<String> {
    let fields: Vec<&str> = out.split('\u{0}').collect();
    let mut set = std::collections::HashSet::new();
    let mut i = 0;
    while i + 2 < fields.len() {
        if fields[i + 1] == "filter" && fields[i + 2] == "lfs" {
            set.insert(fields[i].to_string());
        }
        i += 3;
    }
    set
}

/// Build a `git rebase -i` todo list from a plan, plus the message files it
/// references. `reword` becomes a `pick` and `squash`/`reword` with a new message
/// get an `exec git commit --amend --file=<path>` line right after, so the
/// message is applied from a file (no shell-quoting of free text) and no editor
/// opens. `msg_prefix` is the absolute path stem of those files *as git sees it*
/// (a Linux path inside WSL). Returns the todo and the `(path, message)` pairs
/// the caller must write. An unknown action is treated as `pick`.
fn build_rebase_todo(steps: &[RebaseStep], msg_prefix: &str) -> (String, Vec<(String, String)>) {
    let mut todo = String::new();
    let mut msgs = Vec::new();
    for (i, step) in steps.iter().enumerate() {
        let action = match step.action.as_str() {
            "drop" => "drop",
            "squash" => "squash",
            "fixup" => "fixup",
            // `reword` is realised as pick + exec-amend; anything else is a pick.
            _ => "pick",
        };
        todo.push_str(&format!("{action} {}\n", step.hash));
        if matches!(step.action.as_str(), "reword" | "squash") {
            if let Some(message) = &step.message {
                let path = format!("{msg_prefix}{i}");
                todo.push_str(&format!("exec git commit --amend --file=\"{path}\"\n"));
                msgs.push((path, message.clone()));
            }
        }
    }
    (todo, msgs)
}

/// How many base64 characters `len` bytes encode to: four per three bytes, the
/// last group padded out with `=`. The ~33% by which an encoded image exceeds
/// the raw one, in other words.
const fn base64_len(len: usize) -> usize {
    len.div_ceil(3) * 4
}

/// Standard base64 (with `=` padding), appended to `out` rather than returned in
/// a buffer of its own — see [`data_url`], which is why the shape matters.
/// Dependency-free so the careful dep policy stays intact.
fn base64_encode_into(input: &[u8], out: &mut String) {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    out.reserve(base64_len(input.len()));
    for chunk in input.chunks(3) {
        let b1 = chunk.get(1).copied().unwrap_or(0);
        let b2 = chunk.get(2).copied().unwrap_or(0);
        let n = ((chunk[0] as u32) << 16) | ((b1 as u32) << 8) | b2 as u32;
        out.push(T[((n >> 18) & 63) as usize] as char);
        out.push(T[((n >> 12) & 63) as usize] as char);
        out.push(if chunk.len() > 1 {
            T[((n >> 6) & 63) as usize] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            T[(n & 63) as usize] as char
        } else {
            '='
        });
    }
}

/// An image's `data:` URL, built in a single buffer sized up front.
///
/// The encoding is written straight into the URL's own string on purpose.
/// Encoding into a base64 `String` and then formatting that into the URL would
/// hold a third copy of the image at the peak — the raw bytes, the encoding, and
/// the URL it is copied into — and two of those three are the larger, encoded
/// size.
fn data_url(mime: &str, bytes: &[u8]) -> String {
    const PREFIX: &str = "data:";
    const INFIX: &str = ";base64,";
    let mut url =
        String::with_capacity(PREFIX.len() + mime.len() + INFIX.len() + base64_len(bytes.len()));
    url.push_str(PREFIX);
    url.push_str(mime);
    url.push_str(INFIX);
    base64_encode_into(bytes, &mut url);
    url
}

/// Map a file extension to an image MIME type, or `None` for non-images.
fn image_mime(file: &str) -> Option<&'static str> {
    match file
        .rsplit('.')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "avif" => Some("image/avif"),
        "bmp" => Some("image/bmp"),
        "ico" => Some("image/x-icon"),
        "svg" => Some("image/svg+xml"),
        _ => None,
    }
}

/// Aggregate `git log` author/date lines (`name US email US date`) into the total
/// commit count, contributors (by commit count, desc) and per-day activity (by
/// date, asc). Pure so it is unit-testable; map order is non-deterministic but the
/// outputs are sorted.
fn aggregate_stats(raw: &str) -> (u32, Vec<Contributor>, Vec<ActivityPoint>) {
    use std::collections::HashMap;
    let mut total = 0u32;
    let mut authors: HashMap<(String, String), u32> = HashMap::new();
    let mut days: HashMap<String, u32> = HashMap::new();
    for line in raw.lines() {
        let mut f = line.split(US);
        let (Some(name), Some(email), Some(date)) = (f.next(), f.next(), f.next()) else {
            continue;
        };
        total += 1;
        *authors
            .entry((name.to_string(), email.to_string()))
            .or_default() += 1;
        *days.entry(date.to_string()).or_default() += 1;
    }
    let mut contributors: Vec<Contributor> = authors
        .into_iter()
        .map(|((name, email), commits)| Contributor {
            name,
            email,
            commits,
        })
        .collect();
    contributors.sort_by(|a, b| b.commits.cmp(&a.commits).then(a.name.cmp(&b.name)));
    let mut activity: Vec<ActivityPoint> = days
        .into_iter()
        .map(|(date, count)| ActivityPoint { date, count })
        .collect();
    activity.sort_by(|a, b| a.date.cmp(&b.date));
    (total, contributors, activity)
}

/// Count file occurrences across `git log --name-only` output, returning the
/// `top` most-changed paths (desc). Pure / unit-testable.
fn aggregate_churn(raw: &str, top: usize) -> Vec<FileChurn> {
    use std::collections::HashMap;
    let mut counts: HashMap<&str, u32> = HashMap::new();
    for line in raw.lines() {
        let path = line.trim();
        if !path.is_empty() {
            *counts.entry(path).or_default() += 1;
        }
    }
    let mut churn: Vec<FileChurn> = counts
        .into_iter()
        .map(|(path, changes)| FileChurn {
            path: path.to_string(),
            changes,
        })
        .collect();
    churn.sort_by(|a, b| b.changes.cmp(&a.changes).then(a.path.cmp(&b.path)));
    churn.truncate(top);
    churn
}

/// Derive the directory `git clone` creates from a remote URL — git's "humanish"
/// name: the last path segment with a trailing `.git` removed.
/// `https://host/u/repo.git` and `git@host:u/repo.git` both yield `repo`.
fn clone_dir_name(url: &str) -> &str {
    let trimmed = url.trim_end_matches('/');
    let last = trimmed.rsplit(['/', ':']).next().unwrap_or(trimmed);
    last.strip_suffix(".git").unwrap_or(last)
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Commit {
    pub hash: String,
    pub subject: String,
    pub author: String,
    pub date: String,
    pub refs: Vec<String>,
    pub parents: Vec<String>,
    pub lane: u32,
    /// GPG/SSH signature verification status from `%G?`: `G` good, `U` good but
    /// of unknown validity, `B` bad, `X`/`Y`/`R` expired/revoked, `E` cannot
    /// check, `N` unsigned (empty when git reports nothing).
    pub signature_status: String,
    /// Signer name (`%GS`) when the commit is signed, else empty.
    pub signer_name: String,
    /// Signing key / fingerprint (`%GK`) when available, else empty.
    pub signer_key: String,
}

/// The note a headless write leaves behind for a running glimpse window: what
/// changed, and when. Written by the CLI after a successful write action, read
/// by the GUI's watcher so it can refresh immediately (see
/// [`Repo::write_receipt`]).
///
/// Deliberately **not** a `ts-rs` type: it never crosses the IPC boundary to the
/// frontend. The GUI consumes it in Rust and emits the `repo-changed` event the
/// frontend already listens to, so the frontend learns nothing new about it.
#[derive(Serialize, Deserialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WriteReceipt {
    /// The subcommand that ran, e.g. `stage` or `commit`.
    pub action: String,
    /// The paths it touched, where the action's subject is paths at all.
    #[serde(default)]
    pub paths: Vec<String>,
    /// Unix milliseconds, so a reader can order two receipts and ignore a stale
    /// one left by a process that died before the window opened.
    pub at: u64,
}

impl WriteReceipt {
    pub fn new(action: &str, paths: Vec<String>) -> Self {
        Self {
            action: action.to_string(),
            paths,
            at: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis() as u64)
                // A clock before the epoch is not worth an error path; 0 simply
                // reads as "unknown, treat as stale".
                .unwrap_or(0),
        }
    }
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Branch {
    pub name: String,
    /// Commits ahead of / behind the configured upstream (0 if none).
    pub ahead: u32,
    pub behind: u32,
    /// True when the branch has a live upstream (it exists on a remote). False
    /// for a purely local branch — never pushed, or its remote ref is `gone`.
    pub published: bool,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct StashEntry {
    /// Stash ref, e.g. `stash@{0}` — used for pop/apply/drop.
    pub reference: String,
    pub message: String,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct RepoInfo {
    pub toplevel: String,
    pub current_branch: String,
    pub branches: Vec<Branch>,
    pub remote_branches: Vec<String>,
    pub remotes: Vec<String>,
    pub tags: Vec<String>,
    pub stashes: Vec<StashEntry>,
    /// True when a rebase is paused (e.g. on a conflict) awaiting
    /// continue / skip / abort.
    pub rebase_in_progress: bool,
    /// True when a `git bisect` session is active.
    pub bisect_in_progress: bool,
    pub flavor: String,
    pub distro: Option<String>,
}

/// Ceiling on each side of a diff's full file content, in bytes.
///
/// The contents are loaded so the viewer can highlight whole-file, which keeps
/// the cross-line context per-line highlighting cannot reconstruct. But each
/// side then exists three times at once: the Rust `String`, the JSON crossing
/// IPC, and the JavaScript string the repo store holds for as long as that tab
/// is open. One generated bundle, lockfile or checked-in log therefore costs
/// several times its own size, and merely selecting the file is what triggers
/// it. Past this ceiling the hunks travel alone.
///
/// Bytes rather than lines, because bytes are what those three copies cost; a
/// line count bounds nothing. The value sits far above any hand-written source
/// file, so what it excludes is the file the viewer could not usefully render
/// line by line anyway.
const MAX_DIFF_CONTENT_BYTES: usize = 2 * 1024 * 1024;

/// Ceiling on each side of an image diff, in raw bytes.
///
/// Derived from [`MAX_DIFF_CONTENT_BYTES`] rather than picked separately, so
/// there is one ceiling in this file and not two: an image travels as a base64
/// `data:` URL, four characters per three bytes, so this is the raw size whose
/// encoded form lands exactly on the per-side payload ceiling the text diff
/// already lives under. Capping the raw bytes at 2 MiB instead would quietly
/// grant images a ~2.7 MiB string — in the one path that is also holding the
/// raw bytes while it builds it.
const MAX_IMAGE_BYTES: usize = MAX_DIFF_CONTENT_BYTES / 4 * 3;

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct DiffData {
    pub file_name: String,
    pub old_content: String,
    pub new_content: String,
    pub hunks: Vec<String>,
    /// The file is tracked by Git LFS: the hunks show the small text *pointer*
    /// (version / oid / size), not the real binary. The viewer frames it as an
    /// LFS object instead of rendering it as source, and `old_content` /
    /// `new_content` are left empty so the smudged binary is never shipped.
    pub is_lfs: bool,
    /// A side of this file is past the per-side content ceiling
    /// ([`MAX_DIFF_CONTENT_BYTES`], 2 MiB), so `old_content` and `new_content`
    /// are both empty and only the hunks were shipped. The viewer has to say
    /// so — the same way it frames an LFS object — because a diff that quietly
    /// showed less than the file reads as broken, which is worse than one that
    /// admits it is capped.
    pub contents_omitted: bool,
    /// The whole-file view was asked for and declined: the file's full text is
    /// past [`MAX_DIFF_CONTENT_BYTES`], so `--unified=100000` was dropped and
    /// these hunks are the ordinary unified diff instead.
    ///
    /// Distinct from `contents_omitted`, and the two occur independently: that
    /// one says the side-car text was withheld while the diff stayed whole,
    /// this one says the diff is a narrower one than the user's mode asked
    /// for. Refusing the mode keeps every diff complete — a truncated
    /// whole-file diff would show less of the change than the file holds, and
    /// be harder to read than the shorter complete diff it replaced.
    pub whole_refused: bool,
}

impl DiffData {
    /// Attach both sides' full contents, unless either side is past
    /// [`MAX_DIFF_CONTENT_BYTES`] — then neither is attached and
    /// `contents_omitted` is set instead.
    ///
    /// The sides arrive as closures because the whole point is to not have the
    /// file in memory: an oversized first side means the second is never even
    /// read, so a huge file's two halves are never resident at once, and the
    /// one string that was read is dropped here rather than travelling on to
    /// the IPC payload and the store's copy of it.
    ///
    /// It is both sides or neither. Shipping the small side alone would render
    /// the other as an empty file — "everything was deleted" rather than "this
    /// is too large to show in full".
    fn attach_contents(&mut self, old: impl FnOnce() -> String, new: impl FnOnce() -> String) {
        let old = old();
        if old.len() > MAX_DIFF_CONTENT_BYTES {
            self.contents_omitted = true;
            return;
        }
        let new = new();
        if new.len() > MAX_DIFF_CONTENT_BYTES {
            self.contents_omitted = true;
            return;
        }
        self.old_content = old;
        self.new_content = new;
    }
}

/// The two sides of an image file's change, each a `data:` URL (or null when the
/// file is added / deleted), so the viewer can render them visually.
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ImageDiff {
    pub mime: String,
    /// The committed (HEAD) image; null when the file is newly added.
    pub old: Option<String>,
    /// The working-tree image; null when the file was deleted.
    pub new: Option<String>,
    /// A side of this image is past [`MAX_IMAGE_BYTES`], so neither side was
    /// embedded and `old` / `new` are both null. The viewer has to say so:
    /// null otherwise means "not present on this side", so a silent decline
    /// would read as an image that was added or deleted.
    pub contents_omitted: bool,
}

/// One side of an image diff, as fetching it turned out.
enum ImageSide {
    /// The file is not on this side — newly added, or deleted.
    Absent,
    /// The side's bytes, within [`MAX_IMAGE_BYTES`].
    Bytes(Vec<u8>),
    /// The side exists but is past [`MAX_IMAGE_BYTES`]. It carries no bytes
    /// because the committed side's size is read before its contents are, so
    /// an oversized blob is never loaded merely to be dropped again.
    TooLarge,
}

impl ImageDiff {
    /// Attach both sides as `data:` URLs, unless either is past
    /// [`MAX_IMAGE_BYTES`] — then neither is attached and `contents_omitted`
    /// is set instead.
    ///
    /// The sides arrive as closures for the reason
    /// [`DiffData::attach_contents`] takes them, and one more. An oversized
    /// first side means the second is never fetched. And each side is encoded
    /// before the next is fetched, so the two images' raw bytes are never
    /// resident together: the peak is one raw image plus the URLs, not both raw
    /// images plus both URLs.
    ///
    /// It is both sides or neither, as with the text diff. Shipping the small
    /// side alone would leave the other null, which the viewer renders as "not
    /// present" — reporting an add or a delete instead of the change the user
    /// asked to see.
    fn attach_sides(&mut self, old: impl FnOnce() -> ImageSide, new: impl FnOnce() -> ImageSide) {
        let old_url = match old() {
            ImageSide::TooLarge => {
                self.contents_omitted = true;
                return;
            }
            ImageSide::Absent => None,
            ImageSide::Bytes(bytes) => Some(data_url(&self.mime, &bytes)),
        };
        let new_url = match new() {
            ImageSide::TooLarge => {
                self.contents_omitted = true;
                return;
            }
            ImageSide::Absent => None,
            ImageSide::Bytes(bytes) => Some(data_url(&self.mime, &bytes)),
        };
        self.old = old_url;
        self.new = new_url;
    }
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct CommitFile {
    pub path: String,
    /// Single-letter change status: M, A, D, R, C.
    pub status: String,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Contributor {
    pub name: String,
    pub email: String,
    pub commits: u32,
}

/// Commits authored on a given `YYYY-MM-DD` day.
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ActivityPoint {
    pub date: String,
    pub count: u32,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct FileChurn {
    pub path: String,
    pub changes: u32,
}

/// Repository insights derived from `git log` (read-only, no heavy deps).
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct RepoStats {
    pub total_commits: u32,
    /// Authors by commit count, descending.
    pub contributors: Vec<Contributor>,
    /// Commits per day, ascending by date.
    pub activity: Vec<ActivityPoint>,
    /// Most-changed files, descending (top 20).
    pub churn: Vec<FileChurn>,
}

/// A public SSH key discovered under `~/.ssh`, with the path of its private
/// half so a caller can point `core.sshCommand` (`ssh -i <path>`) at it.
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct SshKey {
    /// Absolute path to the private key (the `.pub` path with the extension
    /// dropped), in the form the repo's git environment expects (a Linux path
    /// for a WSL repo, a host path otherwise).
    pub path: String,
    /// The public key line (`<type> <base64> [comment]`).
    pub public_key: String,
}

/// SSH / credential setup for the repo's git environment.
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct SshStatus {
    /// The configured `credential.helper`, or empty when none is set.
    pub helper: String,
    /// Public SSH keys found under `~/.ssh` (path + contents).
    pub public_keys: Vec<SshKey>,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct BlameLine {
    pub line: u32,
    /// Abbreviated commit hash that last touched this line.
    pub hash: String,
    pub author: String,
    pub date: String,
    pub content: String,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct StatusEntry {
    pub path: String,
    /// Index (staged) status char, e.g. "M", "A", "D", "?".
    pub x: String,
    /// Worktree (unstaged) status char.
    pub y: String,
    pub staged: bool,
    pub unstaged: bool,
    pub untracked: bool,
    /// Unmerged (merge-conflict) entry — shown in its own section.
    pub conflicted: bool,
    /// Path is managed by Git LFS (its `filter` attribute is `lfs`) — surfaced
    /// as a badge so a pointer change isn't mistaken for a tiny text edit.
    pub is_lfs: bool,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ReflogEntry {
    /// Reflog selector, e.g. `HEAD@{0}`.
    pub selector: String,
    /// Abbreviated commit hash the entry points at.
    pub hash: String,
    /// Reflog subject, e.g. `reset: moving to HEAD~1`.
    pub subject: String,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Worktree {
    pub path: String,
    /// Short branch name, or empty when detached/bare.
    pub branch: String,
    /// Abbreviated HEAD hash (empty for a bare worktree).
    pub head: String,
    pub bare: bool,
    pub detached: bool,
    pub locked: bool,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Submodule {
    pub path: String,
    /// Abbreviated checked-out commit.
    pub sha: String,
    /// `git submodule status` prefix: " " in sync, "+" needs update,
    /// "-" uninitialised, "U" merge conflicts.
    pub state: String,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct SparseStatus {
    /// Whether sparse-checkout is active for this worktree.
    pub enabled: bool,
    /// The included path patterns (cone-mode directories), empty when disabled.
    pub patterns: Vec<String>,
}

/// One line of an interactive-rebase plan sent from the frontend, in apply order
/// (oldest first). `action` is `pick` | `reword` | `squash` | `fixup` | `drop`;
/// `message` carries the new message for a `reword` (and an overridden combined
/// message for a `squash`), applied without opening an editor.
#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct RebaseStep {
    pub action: String,
    pub hash: String,
    pub message: Option<String>,
}

/// How far `git reset` rewinds. Deserialized from the frontend's
/// `'soft' | 'mixed' | 'hard'` union, so an unknown value is rejected at the IPC
/// seam instead of silently falling back to `--mixed`.
#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ResetMode {
    Soft,
    Mixed,
    Hard,
}

/// A repository with its `git` invocation resolved once. All operations run
/// against the same [`GitTarget`], so the platform seam is touched in one place.
pub struct Repo {
    target: GitTarget,
}

impl Repo {
    /// Resolve how to reach `git` for `repo_path` (native, or WSL on Windows).
    pub fn open(repo_path: &str) -> Self {
        Repo {
            target: platform::resolve(repo_path),
        }
    }

    /// Run `git <args>` against this repo, returning stdout or trimmed stderr.
    ///
    /// This is the one place git actually starts, which makes it the one place
    /// that can say what ran — so it is also where the [`trace`] command log is
    /// written and where the Simulation page's fault switches are applied. Both
    /// belong here rather than at the IPC seam: an IPC call is not a git call
    /// (`status()` runs `git status` *and* `lfs_paths()`), so a seam in the
    /// frontend would log one `git_status` line and still leave a mis-routed git
    /// target invisible.
    ///
    /// [`run_diff`](Self::run_diff), [`run_bytes`](Self::run_bytes) and
    /// [`run_stdin`](Self::run_stdin) deliberately stay outside both: they are
    /// narrow specialisations whose callers already go through here for the
    /// surrounding work, and neither an injected failure nor a log line has
    /// anywhere useful to land in a path that swallows its own errors.
    fn run(&self, args: &[&str]) -> Result<String, String> {
        self.run_with(args, trace::faults())
    }

    /// [`run`](Self::run) with the fault switches passed in rather than read off
    /// the process-wide state — the seam a test can drive without flipping a
    /// global the rest of the suite is running git against.
    fn run_with(&self, args: &[&str], faults: trace::Faults) -> Result<String, String> {
        // Started before the injected delay on purpose: the logged duration is
        // what the app waited, not what git took. While a fault switch is on the
        // app is bent and says so; a log that under-reported the wait would be
        // reporting on a session that did not happen.
        let started = Instant::now();
        // A simulated slow call is a real sleep, and it happens before the
        // failure check so "slow, and *then* fails" is a walkable path too.
        if let Some(delay) = faults.delay() {
            std::thread::sleep(delay);
        }
        // Rendered once per call rather than only on failure now that the log
        // wants it — a string build against a subprocess spawn.
        let described = self.target.describe(args);
        let fail = |message: &str| {
            trace::record(described.clone(), started.elapsed(), false, message);
            format!("{message}\n\n$ {described}")
        };
        if let Some(injected) = faults.injected_failure() {
            return Err(fail(injected));
        }
        match self.target.command(args).output() {
            Err(e) => Err(fail(&format!("failed to run git: {e}"))),
            Ok(output) if !output.status.success() => {
                Err(fail(String::from_utf8_lossy(&output.stderr).trim()))
            }
            Ok(output) => {
                trace::record(described, started.elapsed(), true, "");
                Ok(String::from_utf8_lossy(&output.stdout).to_string())
            }
        }
    }

    /// Like [`run`], but treats exit code 1 as success — `git diff --no-index`
    /// (used to diff an untracked file against /dev/null) exits 1 whenever the
    /// files differ, which for a new file is always.
    fn run_diff(&self, args: &[&str]) -> String {
        match self.target.command(args).output() {
            Ok(out) if out.status.success() || out.status.code() == Some(1) => {
                String::from_utf8_lossy(&out.stdout).to_string()
            }
            _ => String::new(),
        }
    }

    /// Run a diff-producing command, adding the whole-file context flag when
    /// the user's `whole` mode is on — and dropping it again when the diff it
    /// produced is past [`MAX_DIFF_CONTENT_BYTES`]. Returns the raw diff and
    /// whether the mode was refused.
    ///
    /// In `whole` mode the hunks *are* the whole file, so the per-side content
    /// cap buys nothing: the same megabytes cross IPC through `hunks` instead,
    /// and the payload even reports `contents_omitted` while shipping them. The
    /// mode gives way rather than the content: a truncated whole-file diff
    /// would show less of the change than was asked for, whereas the ordinary
    /// unified diff is complete, merely narrower.
    ///
    /// The size is measured after the fact, at the cost of a second `git diff`
    /// for an oversized file. Estimating it from the file's size beforehand (as
    /// [`Repo::image_diff`] does with `cat-file -s`) would guess at the diff's
    /// size and refuse the mode for files that would have fitted; this way the
    /// extra call lands only on the files that are actually over.
    ///
    /// The flag goes in right after the subcommand, before any revision or
    /// `--` separator, so one insertion point serves every caller's arg order.
    fn run_whole_diff(&self, args: &[&str], whole: bool) -> Result<(String, bool), String> {
        if !whole {
            return self.run(args).map(|raw| (raw, false));
        }
        let mut whole_args = Vec::with_capacity(args.len() + 1);
        whole_args.push(args[0]);
        whole_args.push("--unified=100000");
        whole_args.extend_from_slice(&args[1..]);
        let raw = self.run(&whole_args)?;
        if raw.len() <= MAX_DIFF_CONTENT_BYTES {
            return Ok((raw, false));
        }
        // Free the oversized diff before asking for the smaller one, so the two
        // are never resident together — the peak is what the ceiling promises,
        // not twice it.
        drop(raw);
        self.run(args).map(|raw| (raw, true))
    }

    /// Like [`run`], but returns raw stdout bytes — for binary blobs (e.g. an
    /// image's committed contents) that must not go through lossy UTF-8 decoding.
    fn run_bytes(&self, args: &[&str]) -> Result<Vec<u8>, String> {
        let output = self
            .target
            .command(args)
            .output()
            .map_err(|e| format!("failed to run git: {e}"))?;
        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
        }
        Ok(output.stdout)
    }

    /// Run `git <args>` feeding `input` on stdin (used to pipe a patch into
    /// `git apply`). Returns stdout, or trimmed stderr on failure.
    fn run_stdin(&self, args: &[&str], input: &str) -> Result<String, String> {
        let mut child = self
            .target
            .command(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("failed to run git: {e}"))?;
        child
            .stdin
            .as_mut()
            .ok_or("failed to open git stdin")?
            .write_all(input.as_bytes())
            .map_err(|e| e.to_string())?;
        let output = child.wait_with_output().map_err(|e| e.to_string())?;
        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
        }
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    }

    /// Full content of a git object (`git show <spec>`); empty on error (e.g.
    /// the file did not exist on that side of the diff).
    fn content(&self, spec: &str) -> String {
        self.run(&["show", spec]).unwrap_or_default()
    }

    /// `git --version` from the git this repo resolves to. Routed through the
    /// same [`GitTarget`] as every other call, so a WSL repo reports the distro's
    /// git rather than the host's — "it works on my machine" and "it works
    /// through my distro's git" are the two answers a bug report has to tell
    /// apart. Needs no repository, so an empty path answers for the plain
    /// native git when nothing is open.
    pub fn version(&self) -> Result<String, String> {
        Ok(self.run(&["--version"])?.trim().to_string())
    }

    /// This repository's root directory, as a **host** path.
    ///
    /// git reports its toplevel from inside its own environment (a Linux path
    /// under WSL), so it is mapped back through [`GitTarget::host_path`]: the
    /// result is a spelling [`Repo::open`] routes identically. Without that a
    /// WSL repo's root would resolve to native git on Windows ("cannot change
    /// to '/root/…'").
    ///
    /// Fails when the directory is not inside a repository at all, which is
    /// what makes it usable as a probe.
    pub fn toplevel(&self) -> Result<String, String> {
        let raw = self.run(&["rev-parse", "--show-toplevel"])?;
        Ok(self.target.host_path(raw.trim()))
    }

    pub fn info(&self) -> Result<RepoInfo, String> {
        let toplevel = self.toplevel()?;
        // `rev-parse --abbrev-ref HEAD` resolves a branch name (or "HEAD" when
        // detached), but fails on a freshly-initialised repo whose branch is
        // still unborn — fall back to the symbolic ref so empty repos open.
        let current_branch = self
            .run(&["rev-parse", "--abbrev-ref", "HEAD"])
            .or_else(|_| self.run(&["symbolic-ref", "--short", "HEAD"]))
            .map(|s| s.trim().to_string())
            .unwrap_or_default();
        // Per-branch ahead/behind comes from %(upstream:track), e.g.
        // "[ahead 2, behind 1]".
        let branch_fmt = format!("--format=%(refname:short){US}%(upstream:track){US}%(upstream)");
        let branches = parse::branches(&self.run(&["for-each-ref", &branch_fmt, "refs/heads"])?);
        // Remote-tracking branches (e.g. `origin/main`), minus the `origin/HEAD`
        // symbolic pointer.
        let remote_branches =
            lines(&self.run(&["for-each-ref", "--format=%(refname:short)", "refs/remotes"])?)
                .filter(|b| !b.ends_with("/HEAD"))
                .map(str::to_string)
                .collect();
        let remotes = lines(&self.run(&["remote"])?).map(str::to_string).collect();
        let tags = lines(&self.run(&["tag", "--sort=-creatordate"])?)
            .take(50)
            .map(str::to_string)
            .collect();
        let stashes = self.stash_list()?;
        // A rebase is paused (e.g. stopped on a conflict) when REBASE_HEAD exists.
        let rebase_in_progress = self
            .target
            .command(&["rev-parse", "--verify", "--quiet", "REBASE_HEAD"])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);
        // `git bisect log` succeeds only while a bisect session is active.
        let bisect_in_progress = self
            .target
            .command(&["bisect", "log"])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);

        Ok(RepoInfo {
            toplevel,
            current_branch,
            branches,
            remote_branches,
            remotes,
            tags,
            stashes,
            rebase_in_progress,
            bisect_in_progress,
            flavor: self.target.flavor.to_string(),
            distro: self.target.distro.clone(),
        })
    }

    pub fn log(&self, limit: u32) -> Result<Vec<Commit>, String> {
        // A freshly-initialised repo has no commits yet; `git log` would fail
        // hard, so short-circuit to an empty history when there are no refs.
        if self.run(&["rev-parse", "--all"])?.trim().is_empty() {
            return Ok(Vec::new());
        }
        // `%G?`/`%GS`/`%GK` carry the signature verification status, signer name
        // and signing key so the graph can badge signed commits. Trailing fields
        // stay optional in the parser, so other callers (file history) that use
        // the shorter format decode fine.
        let fmt =
            format!("--pretty=format:%H{US}%P{US}%an{US}%ad{US}%D{US}%s{US}%G?{US}%GS{US}%GK");
        let n = format!("-n{limit}");
        // `--all` so every branch/remote/tag tip shows as its own parallel lane;
        // `--topo-order` keeps a branch's commits contiguous for a clean graph.
        let out = self.run(&["log", "--all", "--topo-order", LOG_DATE, &fmt, &n])?;
        Ok(parse::log(&out))
    }

    /// Pickaxe history search: commits that change the number of occurrences of
    /// `query` (`-S`), or — when `regex` — whose diff has a line matching it as a
    /// regex (`-G`). `query` is concatenated onto the flag so it is always the
    /// search value, never a separate option. Capped and newest-first.
    pub fn search_commits(&self, query: &str, regex: bool) -> Result<Vec<Commit>, String> {
        if query.is_empty() {
            return Ok(Vec::new());
        }
        let flag = if regex {
            format!("-G{query}")
        } else {
            format!("-S{query}")
        };
        let fmt =
            format!("--pretty=format:%H{US}%P{US}%an{US}%ad{US}%D{US}%s{US}%G?{US}%GS{US}%GK");
        let out = self.run(&["log", "--all", LOG_DATE, "-n200", &fmt, &flag])?;
        Ok(parse::log(&out))
    }

    /// Write a commit as a `.patch` (mailbox) file to `dest` (an absolute path
    /// the user picked in a native dialog — not an in-repo path, so the in-repo
    /// guard does not apply). `git format-patch -1 --stdout`.
    pub fn export_patch(&self, hash: &str, dest: &str) -> Result<(), String> {
        reject_option(hash)?;
        let content = self.run(&["format-patch", "-1", "--stdout", hash])?;
        std::fs::write(dest, content).map_err(|e| format!("failed to write patch: {e}"))
    }

    /// Apply a patch file picked by the user. `am` (`--3way`) recreates commits
    /// from a mailbox; `apply` patches only the working tree.
    pub fn apply_patch(&self, src: &str, mode: &str) -> Result<String, String> {
        let content =
            std::fs::read_to_string(src).map_err(|e| format!("failed to read patch: {e}"))?;
        let args: &[&str] = if mode == "apply" {
            &["apply", "--whitespace=nowarn"]
        } else {
            &["am", "--3way"]
        };
        self.run_stdin(args, &content)
    }

    /// SSH key + credential-helper status for this repo's git environment.
    pub fn ssh_status(&self) -> SshStatus {
        let helper = self
            .run(&["config", "--get", "credential.helper"])
            .unwrap_or_default()
            .trim()
            .to_string();
        SshStatus {
            helper,
            public_keys: self.target.ssh_public_keys(),
        }
    }

    /// Generate an ed25519 SSH key in this environment (errors if one exists).
    pub fn generate_ssh_key(&self) -> Result<String, String> {
        self.target.generate_ssh_key()
    }

    /// All tracked file paths (`git ls-files`) — the corpus for the quick-open
    /// fuzzy finder.
    pub fn list_files(&self) -> Result<Vec<String>, String> {
        Ok(lines(&self.run(&["ls-files"])?)
            .map(|s| s.to_string())
            .collect())
    }

    /// Repository insights: total commits, contributors, per-day activity and the
    /// most-changed files. All derived from two `git log` passes (no extra deps).
    pub fn repo_stats(&self) -> Result<RepoStats, String> {
        if self.run(&["rev-parse", "--all"])?.trim().is_empty() {
            return Ok(RepoStats {
                total_commits: 0,
                contributors: Vec::new(),
                activity: Vec::new(),
                churn: Vec::new(),
            });
        }
        let fmt = format!("--format=%an{US}%ae{US}%ad");
        let log = self.run(&["log", "--all", "--date=short", &fmt])?;
        let (total_commits, contributors, activity) = aggregate_stats(&log);
        let names = self
            .run(&["log", "--all", "--format=", "--name-only"])
            .unwrap_or_default();
        let churn = aggregate_churn(&names, 20);
        Ok(RepoStats {
            total_commits,
            contributors,
            activity,
            churn,
        })
    }

    /// Read the HEAD reflog — the recovery trail for resets/rebases/commits.
    pub fn reflog(&self, limit: u32) -> Result<Vec<ReflogEntry>, String> {
        let fmt = format!("--format=%gd{US}%h{US}%gs");
        let n = format!("-n{limit}");
        let raw = self.run(&["reflog", &fmt, &n])?;
        Ok(parse::reflog(&raw))
    }

    /// Which of `files` Git LFS manages — their `filter` attribute resolves to
    /// `lfs`. One `git check-attr` pass over NUL-separated paths on stdin (its
    /// `-z` output is `path\0 filter\0 value\0` triplets). Detection reads
    /// `.gitattributes` only, so it works even without the `git-lfs` binary
    /// installed; it is best-effort and returns empty on any error so a stray
    /// failure never breaks status or diff.
    fn lfs_paths(&self, files: &[String]) -> std::collections::HashSet<String> {
        if files.is_empty() {
            return std::collections::HashSet::new();
        }
        let input = files.join("\u{0}");
        let Ok(out) = self.run_stdin(&["check-attr", "--stdin", "-z", "filter"], &input) else {
            return std::collections::HashSet::new();
        };
        lfs_from_check_attr(&out)
    }

    pub fn status(&self) -> Result<Vec<StatusEntry>, String> {
        let raw = self.run(&["status", "--porcelain=v1", "--untracked-files=all", "-z"])?;
        let mut entries = parse::status(&raw);
        let files: Vec<String> = entries.iter().map(|e| e.path.clone()).collect();
        let lfs = self.lfs_paths(&files);
        for entry in &mut entries {
            entry.is_lfs = lfs.contains(&entry.path);
        }
        Ok(entries)
    }

    /// Diff of a single file, either the staged version or the working-tree
    /// change. Both file contents are included so the viewer has full context.
    pub fn file_diff(
        &self,
        file: &str,
        staged: bool,
        ignore_whitespace: bool,
        whole: bool,
    ) -> Result<Option<DiffData>, String> {
        reject_unsafe_path(file)?;
        // `--no-ext-diff --no-textconv`: never let a malicious repo's configured
        // external-diff / textconv driver run while we inspect it (we render the
        // diff ourselves from the raw content anyway).
        let mut args = vec!["diff", "--no-color", "--no-ext-diff", "--no-textconv"];
        if staged {
            args.push("--staged");
        }
        if ignore_whitespace {
            args.push("-w");
        }
        args.push("--");
        args.push(file);
        // Whole-file view: a huge context turns the diff into one hunk spanning
        // the entire file (every line shown, changes still marked) — unless the
        // result is past the ceiling, in which case the mode is refused.
        let (mut raw, whole_refused) = self.run_whole_diff(&args, whole)?;

        // Untracked files have no diff target; diff against the null device so
        // the whole file shows up as additions. --no-index exits 1 on any
        // difference, so use run_diff which tolerates that.
        if raw.trim().is_empty() && !staged {
            let null = self.target.null_device();
            raw = self.run_diff(&[
                "diff",
                "--no-color",
                "--no-ext-diff",
                "--no-textconv",
                "--no-index",
                "--",
                null,
                file,
            ]);
        }

        let Some(mut diff) = parse::diff(&raw) else {
            return Ok(None);
        };
        diff.whole_refused = whole_refused;
        // For an LFS file the hunks already hold the small text pointer; flag it
        // and skip loading full contents — the working side is the smudged binary
        // and shipping it would be wasteful and unrenderable.
        if self.lfs_paths(&[file.to_string()]).contains(file) {
            diff.is_lfs = true;
            return Ok(Some(diff));
        }
        if staged {
            diff.attach_contents(
                || self.content(&format!("HEAD:{file}")),
                || self.content(&format!(":{file}")),
            );
        } else {
            diff.attach_contents(
                || self.content(&format!(":{file}")),
                || self.target.read_file(file).unwrap_or_default(),
            );
        }
        Ok(Some(diff))
    }

    /// Both sides of an image file as `data:` URLs: the committed (HEAD) blob and
    /// the current working-tree file. Either side is null when absent (added or
    /// deleted), so the viewer can show them visually instead of "no text diff".
    pub fn image_diff(&self, file: &str) -> Result<ImageDiff, String> {
        reject_unsafe_path(file)?;
        let mut diff = ImageDiff {
            mime: image_mime(file)
                .unwrap_or("application/octet-stream")
                .to_string(),
            old: None,
            new: None,
            contents_omitted: false,
        };
        diff.attach_sides(
            || self.committed_image(file),
            // The working tree has no counterpart to `cat-file -s`: reading the
            // file is the only way to learn its size, native or over `wsl.exe
            // cat`. So an oversized working-tree image is read once and dropped
            // here — one transient buffer, rather than one that goes on to be
            // encoded, crosses IPC and is parked in the webview.
            || match self.target.read_file_bytes(file) {
                None => ImageSide::Absent,
                Some(bytes) if bytes.len() > MAX_IMAGE_BYTES => ImageSide::TooLarge,
                Some(bytes) => ImageSide::Bytes(bytes),
            },
        );
        Ok(diff)
    }

    /// The committed (HEAD) image, sized before it is read: `cat-file -s`
    /// reports the blob's size without materialising it, so an image past
    /// [`MAX_IMAGE_BYTES`] costs a number rather than a buffer — the one side
    /// where the size is knowable in advance, and the side whose history can
    /// hold something far larger than anything in the working tree.
    ///
    /// Anything unexpected — no HEAD, the path not committed, output that does
    /// not parse — is [`ImageSide::Absent`]: the side genuinely has no image to
    /// show, and guessing at a size would be the one mistake that matters here.
    fn committed_image(&self, file: &str) -> ImageSide {
        let spec = format!("HEAD:{file}");
        let Ok(size) = self.run(&["cat-file", "-s", &spec]) else {
            return ImageSide::Absent;
        };
        match size.trim().parse::<usize>() {
            Ok(n) if n > MAX_IMAGE_BYTES => ImageSide::TooLarge,
            Ok(n) if n > 0 => self
                .run_bytes(&["show", &spec])
                .ok()
                .filter(|b| !b.is_empty())
                .map_or(ImageSide::Absent, ImageSide::Bytes),
            _ => ImageSide::Absent,
        }
    }

    /// Resolve a revision — `HEAD`, a branch, a tag, a short hash — to the full
    /// commit hash it names.
    ///
    /// `^{commit}` makes an annotated tag resolve to the commit it points at
    /// rather than to the tag object, and makes a ref that names a tree or blob
    /// an error instead of a hash that later commands would choke on. A caller
    /// that resolves first gets one clear failure here rather than the same
    /// bad revision reported separately by every command it is passed to.
    pub fn resolve_commit(&self, rev: &str) -> Result<String, String> {
        reject_option(rev)?;
        let spec = format!("{rev}^{{commit}}");
        let hash = self
            .run(&["rev-parse", "--verify", &spec])?
            .trim()
            .to_string();
        if hash.is_empty() {
            return Err(format!("not a commit: {rev}"));
        }
        Ok(hash)
    }

    /// Full commit message (subject + body) for the detail panel.
    pub fn commit_body(&self, hash: &str) -> Result<String, String> {
        reject_option(hash)?;
        Ok(self
            .run(&["show", "-s", "--format=%B", hash])?
            .trim()
            .to_string())
    }

    /// List of files changed by a commit (path + single-letter status).
    pub fn commit_files(&self, hash: &str) -> Result<Vec<CommitFile>, String> {
        reject_option(hash)?;
        let raw = self.run(&["show", "--name-status", "--format=", hash])?;
        Ok(parse::commit_files(&raw))
    }

    /// Diff of a single file as introduced by a commit, with both contents.
    pub fn commit_file_diff(
        &self,
        hash: &str,
        file: &str,
        ignore_whitespace: bool,
        whole: bool,
    ) -> Result<Option<DiffData>, String> {
        reject_option(hash)?;
        reject_unsafe_path(file)?;
        let mut args = vec![
            "show",
            "--no-color",
            "--no-ext-diff",
            "--no-textconv",
            "--format=",
        ];
        if ignore_whitespace {
            args.push("-w");
        }
        args.extend([hash, "--", file]);
        let (raw, whole_refused) = self.run_whole_diff(&args, whole)?;
        let Some(mut diff) = parse::diff(&raw) else {
            return Ok(None);
        };
        diff.whole_refused = whole_refused;
        diff.attach_contents(
            || self.content(&format!("{hash}^:{file}")),
            || self.content(&format!("{hash}:{file}")),
        );
        Ok(Some(diff))
    }

    pub fn stage(&self, file: &str) -> Result<(), String> {
        reject_unsafe_path(file)?;
        self.run(&["add", "--", file]).map(|_| ())
    }

    pub fn unstage(&self, file: &str) -> Result<(), String> {
        reject_unsafe_path(file)?;
        self.run(&["restore", "--staged", "--", file]).map(|_| ())
    }

    /// Stage (or, with `reverse`, unstage) a single hunk by piping a minimal
    /// one-file patch into `git apply --cached`. `--recount` lets git fix the
    /// `@@` line counts, so the rendered hunk text doesn't need to be exact.
    /// Files changed between two refs (branch/tag/commit) — for the compare view.
    pub fn compare_files(&self, from: &str, to: &str) -> Result<Vec<CommitFile>, String> {
        reject_option(from)?;
        reject_option(to)?;
        let raw = self.run(&["diff", "--name-status", from, to])?;
        Ok(parse::commit_files(&raw))
    }

    /// Per-file diff between two refs (compare view).
    pub fn compare_file_diff(
        &self,
        from: &str,
        to: &str,
        file: &str,
        ignore_whitespace: bool,
        whole: bool,
    ) -> Result<Option<DiffData>, String> {
        reject_option(from)?;
        reject_option(to)?;
        reject_unsafe_path(file)?;
        let mut args = vec!["diff", "--no-color", "--no-ext-diff", "--no-textconv"];
        if ignore_whitespace {
            args.push("-w");
        }
        args.push(from);
        args.push(to);
        args.push("--");
        args.push(file);
        let (raw, whole_refused) = self.run_whole_diff(&args, whole)?;
        let Some(mut diff) = parse::diff(&raw) else {
            return Ok(None);
        };
        diff.whole_refused = whole_refused;
        diff.attach_contents(
            || self.content(&format!("{from}:{file}")),
            || self.content(&format!("{to}:{file}")),
        );
        Ok(Some(diff))
    }

    pub fn apply_hunk(&self, file: &str, hunk: &str, reverse: bool) -> Result<(), String> {
        // Reject CR/LF/`..`/absolute in the file path: it is interpolated raw
        // into the patch headers below, so a newline could inject extra
        // `+++ b/…` headers and redirect the write outside the intended file.
        reject_unsafe_path(file)?;
        // And reject a hunk body that smuggles a second file section, which would
        // otherwise stage content into a different in-repo path.
        reject_unsafe_hunk(hunk)?;
        let patch = format!("diff --git a/{file} b/{file}\n--- a/{file}\n+++ b/{file}\n{hunk}\n");
        let mut args = vec!["apply", "--cached", "--recount", "--whitespace=nowarn"];
        if reverse {
            args.push("--reverse");
        }
        self.run_stdin(&args, &patch).map(|_| ())
    }

    /// Discard a single hunk from the working tree by reverse-applying it — the
    /// worktree counterpart of unstaging a hunk (`apply_hunk` targets the index).
    pub fn discard_hunk(&self, file: &str, hunk: &str) -> Result<(), String> {
        reject_unsafe_path(file)?;
        reject_unsafe_hunk(hunk)?;
        let patch = format!("diff --git a/{file} b/{file}\n--- a/{file}\n+++ b/{file}\n{hunk}\n");
        self.run_stdin(
            &["apply", "--reverse", "--recount", "--whitespace=nowarn"],
            &patch,
        )
        .map(|_| ())
    }

    /// Stage or unstage only the user-selected lines within a single hunk
    /// (line-level / sub-hunk staging). `lines` are 0-based indices into the
    /// hunk body; the reduced hunk is built by [`build_partial_hunk`] and applied
    /// to the index exactly like [`apply_hunk`] (`--reverse` unstages).
    pub fn apply_lines(
        &self,
        file: &str,
        hunk: &str,
        lines: &[u32],
        reverse: bool,
    ) -> Result<(), String> {
        reject_unsafe_path(file)?;
        reject_unsafe_hunk(hunk)?;
        if lines.is_empty() {
            return Err("no lines selected".to_string());
        }
        let partial = build_partial_hunk(hunk, lines, reverse);
        let patch = format!("diff --git a/{file} b/{file}\n--- a/{file}\n+++ b/{file}\n{partial}");
        let mut args = vec!["apply", "--cached", "--recount", "--whitespace=nowarn"];
        if reverse {
            args.push("--reverse");
        }
        self.run_stdin(&args, &patch).map(|_| ())
    }

    /// Commits that touched a file, following renames (`git log --follow`).
    pub fn file_history(&self, file: &str) -> Result<Vec<Commit>, String> {
        reject_unsafe_path(file)?;
        let fmt = format!("--pretty=format:%H{US}%P{US}%an{US}%ad{US}%D{US}%s");
        let out = self.run(&["log", "--follow", LOG_DATE, &fmt, "--", file])?;
        Ok(parse::log(&out))
    }

    /// Per-line authorship for a file (`git blame --porcelain`).
    pub fn blame(&self, file: &str) -> Result<Vec<BlameLine>, String> {
        reject_unsafe_path(file)?;
        let raw = self.run(&["blame", "--porcelain", "--", file])?;
        Ok(parse::blame(&raw))
    }

    /// Create a commit, or rewrite the previous one (`--amend`) keeping its
    /// author. Amend lets the user fix the last message/contents before pushing.
    pub fn commit(&self, message: &str, amend: bool) -> Result<String, String> {
        let mut args = vec!["commit", "-m", message];
        if amend {
            args.push("--amend");
        }
        self.run(&args)
    }

    /// Commit exactly `files`: clear the index, stage only those paths, then
    /// commit — leaving every other change in the working tree uncommitted. The
    /// backend primitive behind "commit one changelist". `-A` is needed so the
    /// staging covers modifications, additions AND deletions (a plain
    /// `git commit -- <paths>` can't add untracked files). An empty `files` with
    /// `amend` is a reword (index resets to HEAD, nothing new staged).
    pub fn commit_paths(
        &self,
        message: &str,
        files: &[String],
        amend: bool,
    ) -> Result<String, String> {
        for f in files {
            reject_unsafe_path(f)?;
        }
        self.run(&["reset", "-q"])?;
        if !files.is_empty() {
            let mut add = vec!["add", "-A", "--"];
            add.extend(files.iter().map(String::as_str));
            self.run(&add)?;
        }
        let mut commit = vec!["commit", "-m", message];
        if amend {
            commit.push("--amend");
        }
        self.run(&commit)
    }

    /// Commit a selection that may include only *part* of a file. Each entry is
    /// a path plus the hunks to stage from it — an empty hunk list means the
    /// whole file. The index is reset, the chosen files/hunks are staged (whole
    /// files via `add -A`, partial files by applying each hunk to the index like
    /// [`apply_hunk`]), then committed, leaving every unselected hunk in the
    /// working tree. Powers "review & commit hunks" for a changelist; the
    /// selection is made at commit time, so no fragile sub-file state is stored.
    pub fn commit_partial(
        &self,
        message: &str,
        files: &[(String, Vec<String>)],
        amend: bool,
    ) -> Result<String, String> {
        for (path, _) in files {
            reject_unsafe_path(path)?;
        }
        self.run(&["reset", "-q"])?;
        for (path, hunks) in files {
            if hunks.is_empty() {
                self.run(&["add", "-A", "--", path])?;
            } else {
                for hunk in hunks {
                    self.apply_hunk(path, hunk, false)?;
                }
            }
        }
        let mut commit = vec!["commit", "-m", message];
        if amend {
            commit.push("--amend");
        }
        self.run(&commit)
    }

    /// Absolute, host-visible path of this repo's changelist store
    /// (`<git-dir>/glimpse/changelists.json`). The git dir is resolved by git
    /// (`rev-parse --absolute-git-dir`) so it is correct for linked worktrees and
    /// `.git`-file setups, then mapped through `host_path` so it is reachable from
    /// the host fs (the WSL share on Windows) — the same approach
    /// [`interactive_rebase`] uses for its todo file. Living inside the git dir,
    /// the file is per-worktree and never committed or pushed, yet any tool (the
    /// CLI, an agent) can read/write it by this same rule.
    fn changelists_file(&self) -> Result<String, String> {
        self.glimpse_dir_file("changelists.json")
    }

    /// Absolute, host-visible path of `<git-dir>/glimpse/<name>` — the private
    /// per-worktree drawer described on [`changelists_file`], which more than
    /// one file now lives in.
    fn glimpse_dir_file(&self, name: &str) -> Result<String, String> {
        let git_dir = self
            .run(&["rev-parse", "--absolute-git-dir"])?
            .trim()
            .to_string();
        Ok(self.target.host_path(&format!("{git_dir}/glimpse/{name}")))
    }

    /// Absolute, host-visible path of this repo's **write receipt**
    /// (`<git-dir>/glimpse/last-write.json`) — see [`write_receipt`].
    ///
    /// [`write_receipt`]: Repo::write_receipt
    pub fn write_receipt_file(&self) -> Result<String, String> {
        self.glimpse_dir_file("last-write.json")
    }

    /// Record that a write just happened, so a running glimpse window can
    /// refresh **at once** instead of waiting for its debounced filesystem
    /// watcher — which lags by design, and by seconds over the `\\wsl$` share
    /// where it has to poll.
    ///
    /// The receipt lives beside the changelist store, in the git dir: private
    /// to the worktree, never committed, and readable by any tool that can
    /// reach the repository. It is written atomically (temp file + rename) so a
    /// watcher never reads a half-written file.
    ///
    /// This returns a `Result` because writing a file can genuinely fail. It is
    /// the **caller's** job to treat that failure as unimportant — the CLI does,
    /// deliberately, since a notification that failed must never fail the write
    /// that succeeded.
    pub fn write_receipt(&self, receipt: &WriteReceipt) -> Result<(), String> {
        let path = self.write_receipt_file()?;
        let p = std::path::Path::new(&path);
        if let Some(dir) = p.parent() {
            std::fs::create_dir_all(dir)
                .map_err(|e| format!("failed to create the glimpse dir: {e}"))?;
        }
        let json = serde_json::to_string(receipt)
            .map_err(|e| format!("failed to serialise the receipt: {e}"))?;
        let tmp = format!("{path}.tmp");
        std::fs::write(&tmp, json).map_err(|e| format!("failed to write the receipt: {e}"))?;
        std::fs::rename(&tmp, &path).map_err(|e| format!("failed to write the receipt: {e}"))?;
        Ok(())
    }

    /// Read the raw changelist store JSON, or `None` if it has never been
    /// written. Membership is soft state: a missing file simply means "no groups
    /// yet", so the absence is `Ok(None)`, not an error.
    pub fn read_changelists(&self) -> Result<Option<String>, String> {
        let path = self.changelists_file()?;
        match std::fs::read_to_string(&path) {
            Ok(s) => Ok(Some(s)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(format!("failed to read changelists: {e}")),
        }
    }

    /// Write the changelist store JSON atomically (temp file + rename) so a
    /// concurrent reader — including an external CLI/agent — never observes a
    /// half-written file. Creates `<git-dir>/glimpse/` on first write.
    pub fn write_changelists(&self, json: &str) -> Result<(), String> {
        let path = self.changelists_file()?;
        let p = std::path::Path::new(&path);
        if let Some(dir) = p.parent() {
            std::fs::create_dir_all(dir)
                .map_err(|e| format!("failed to create changelists dir: {e}"))?;
        }
        let tmp = format!("{path}.tmp");
        std::fs::write(&tmp, json).map_err(|e| format!("failed to write changelists: {e}"))?;
        std::fs::rename(&tmp, &path).map_err(|e| format!("failed to write changelists: {e}"))?;
        Ok(())
    }

    /// Subject + body of the most recent commit, to prefill an amend.
    pub fn head_message(&self) -> Result<String, String> {
        Ok(self
            .run(&["show", "-s", "--format=%B", "HEAD"])?
            .trim()
            .to_string())
    }

    /// Discard a file's **unstaged** working-tree change, sourcing it from the
    /// index. Untracked files are deleted (`clean`).
    ///
    /// This is the GUI's per-file discard, which lives in the *unstaged*
    /// section next to a separately-shown index: "throw this away" there means
    /// the unstaged half, and a staged change is meant to survive it. Anything
    /// that promises to throw away a path's uncommitted work outright — the
    /// CLI's `glimpse discard <path>` — wants [`discard_to_head`] instead.
    ///
    /// [`discard_to_head`]: Self::discard_to_head
    pub fn discard(&self, file: &str, untracked: bool) -> Result<(), String> {
        reject_unsafe_path(file)?;
        if untracked {
            self.run(&["clean", "-f", "--", file]).map(|_| ())
        } else {
            self.run(&["restore", "--", file]).map(|_| ())
        }
    }

    /// Take `files` back to the last committed state — index **and** working
    /// tree — in a single `git restore`.
    ///
    /// `--staged --worktree` with no `--source` makes HEAD the source, which is
    /// the difference that matters against [`discard`](Self::discard): a change
    /// that is merely *staged* is still uncommitted work, and leaving it behind
    /// while reporting "restored to the last committed state" would be a lie
    /// told by the one command that destroys things.
    ///
    /// It also accepts cases the index-sourced form rejects outright — a staged
    /// deletion (`git restore -- <p>` answers "did not match any file(s) known
    /// to git"), and a path staged as new, which HEAD has no version of and
    /// which is therefore removed rather than reverted.
    ///
    /// **One invocation for the whole batch, on purpose.** git validates every
    /// pathspec before it touches any of them, so a path it will not accept
    /// costs nothing at all — where a path-at-a-time loop would already have
    /// destroyed the paths ahead of it.
    pub fn discard_to_head(&self, files: &[String]) -> Result<(), String> {
        if files.is_empty() {
            return Ok(());
        }
        let mut args = vec!["restore", "--staged", "--worktree", "--"];
        for f in files {
            reject_unsafe_path(f)?;
            args.push(f);
        }
        self.run(&args).map(|_| ())
    }

    /// Delete `files` from disk — untracked paths, which no index or commit
    /// holds a copy of. One `git clean` for the whole batch, for the same
    /// reason [`discard_to_head`](Self::discard_to_head) takes one.
    pub fn discard_untracked(&self, files: &[String]) -> Result<(), String> {
        if files.is_empty() {
            return Ok(());
        }
        let mut args = vec!["clean", "-f", "--"];
        for f in files {
            reject_unsafe_path(f)?;
            args.push(f);
        }
        self.run(&args).map(|_| ())
    }

    pub fn checkout_branch(&self, branch: &str) -> Result<(), String> {
        reject_option(branch)?;
        self.run(&["switch", "--", branch]).map(|_| ())
    }

    /// Merge `branch` into the current branch (no editor). Conflicts surface in
    /// the status as unmerged entries, handled by the conflicts UI.
    pub fn merge(&self, branch: &str) -> Result<String, String> {
        reject_option(branch)?;
        // `--no-ff` always records a merge commit, so a merged branch keeps its
        // own lane + merge point in the graph instead of being fast-forwarded
        // into a straight line (which erases the branch topology).
        self.run(&["merge", "--no-ff", "--no-edit", "--", branch])
    }

    /// Is a merge started and not yet concluded?
    ///
    /// `MERGE_HEAD` exists for exactly that window, which is what makes it worth
    /// asking git rather than reading it off [`status`](Self::status): once the
    /// conflicts are resolved and staged, a mid-merge index is indistinguishable
    /// from an ordinary one. Anything about to throw the working tree away needs
    /// the difference, because the merge is uncommitted state that discarding
    /// does **not** undo — it would silently settle every conflict on *ours* and
    /// leave the merge open behind a clean-looking `status`.
    ///
    /// A probe rather than a `Result`: `rev-parse --verify --quiet` exits
    /// non-zero both when the ref is absent and when git itself fails, and
    /// distinguishing the two here would be false precision — every caller runs
    /// a git command that fails loudly first.
    pub fn merge_in_progress(&self) -> bool {
        self.run(&["rev-parse", "--verify", "--quiet", "MERGE_HEAD"])
            .is_ok()
    }

    /// Rebase the current branch onto `onto` (a branch, tag or commit). A
    /// conflict pauses the rebase for the continue / skip / abort controls.
    pub fn rebase(&self, onto: &str) -> Result<String, String> {
        reject_option(onto)?;
        self.run(&["rebase", onto])
    }

    /// Continue a paused rebase after conflicts are resolved. `core.editor=true`
    /// keeps the original message rather than opening an editor (which would hang
    /// the headless invocation).
    pub fn rebase_continue(&self) -> Result<String, String> {
        self.run(&["-c", "core.editor=true", "rebase", "--continue"])
    }

    /// Skip the current commit in a paused rebase.
    pub fn rebase_skip(&self) -> Result<String, String> {
        self.run(&["-c", "core.editor=true", "rebase", "--skip"])
    }

    /// Abort a paused rebase, restoring the pre-rebase state.
    pub fn rebase_abort(&self) -> Result<(), String> {
        self.run(&["rebase", "--abort"]).map(|_| ())
    }

    /// Run an interactive rebase from a frontend plan (reword / squash / fixup /
    /// drop / reorder) over `base..HEAD`, or the whole history when `base` is
    /// empty (`--root`). `steps` are in apply order.
    ///
    /// Non-interactive without an editor: the todo and any reword/squash messages
    /// are written into the git dir, then `-c sequence.editor='cp <todo>'` feeds
    /// the plan and `exec … --amend --file=…` lines apply the messages. Config is
    /// passed as `-c` flags (not env) so it crosses into WSL git too, and every
    /// path is the absolute path *as git sees it* so it is cwd-independent. A
    /// conflict pauses the rebase exactly like [`rebase`], reusing the existing
    /// continue / skip / abort flow.
    pub fn interactive_rebase(&self, base: &str, steps: &[RebaseStep]) -> Result<String, String> {
        if steps.is_empty() {
            return Err("empty rebase plan".to_string());
        }
        for step in steps {
            reject_option(&step.hash)?;
        }
        if !base.is_empty() {
            reject_option(base)?;
        }
        let git_dir = self
            .run(&["rev-parse", "--absolute-git-dir"])?
            .trim()
            .to_string();
        let todo_view = format!("{git_dir}/glimpse-rebase-todo");
        let msg_prefix = format!("{git_dir}/glimpse-rebase-msg-");
        let (todo, msgs) = build_rebase_todo(steps, &msg_prefix);
        // Write through the host-visible path (the WSL share on Windows); the
        // todo/exec lines reference the git-visible path written above.
        std::fs::write(self.target.host_path(&todo_view), &todo)
            .map_err(|e| format!("failed to write rebase plan: {e}"))?;
        for (path, message) in &msgs {
            std::fs::write(self.target.host_path(path), message)
                .map_err(|e| format!("failed to write rebase message: {e}"))?;
        }
        let editor = format!("sequence.editor=cp \"{todo_view}\"");
        let base_arg = if base.is_empty() { "--root" } else { base };
        self.run(&[
            "-c",
            &editor,
            "-c",
            "core.editor=true",
            "rebase",
            "-i",
            base_arg,
        ])
    }

    /// Commits an interactive rebase from `start` would replay — `start` and its
    /// descendants up to HEAD, oldest first, so the plan dialog can list them in
    /// apply order. Falls back to the whole history when `start` is the root.
    pub fn rebase_commits(&self, start: &str) -> Result<Vec<Commit>, String> {
        reject_option(start)?;
        let parent = format!("{start}^");
        let has_parent = self
            .run(&["rev-parse", "--verify", "--quiet", &parent])
            .is_ok();
        let range = if has_parent {
            format!("{parent}..HEAD")
        } else {
            "HEAD".to_string()
        };
        let fmt =
            format!("--pretty=format:%H{US}%P{US}%an{US}%ad{US}%D{US}%s{US}%G?{US}%GS{US}%GK");
        let out = self.run(&["log", "--reverse", LOG_DATE, &fmt, &range])?;
        Ok(parse::log(&out))
    }

    /// Start a `git bisect` between a known-bad and known-good ref. Returns git's
    /// output (the next commit to test).
    pub fn bisect_start(&self, bad: &str, good: &str) -> Result<String, String> {
        reject_option(bad)?;
        reject_option(good)?;
        self.run(&["bisect", "start", bad, good])
    }

    /// Mark the current bisect step `good`, `bad` or `skip` and advance. Returns
    /// git's output (the next commit, or the identified first-bad commit).
    pub fn bisect_mark(&self, verdict: &str) -> Result<String, String> {
        let sub = match verdict {
            "good" | "bad" | "skip" => verdict,
            _ => return Err(format!("invalid bisect verdict: {verdict}")),
        };
        self.run(&["bisect", sub])
    }

    /// End the bisect session and return to the original HEAD.
    pub fn bisect_reset(&self) -> Result<(), String> {
        self.run(&["bisect", "reset"]).map(|_| ())
    }

    /// List linked worktrees. Paths are mapped back to host paths so they can be
    /// opened as their own repo tab (round-trips a `\\wsl$` worktree).
    pub fn worktrees(&self) -> Result<Vec<Worktree>, String> {
        let raw = self.run(&["worktree", "list", "--porcelain"])?;
        let mut worktrees = parse::worktrees(&raw);
        for wt in &mut worktrees {
            wt.path = self.target.host_path(&wt.path);
        }
        Ok(worktrees)
    }

    /// Add a worktree at `path`, optionally checking out `reference` (an existing
    /// branch/commit; empty creates one on a new branch named after the path).
    /// `path` is a filesystem location the user picked, so a leading-dash guard —
    /// not the repo-relative path guard — is the right check.
    pub fn worktree_add(&self, path: &str, reference: &str) -> Result<(), String> {
        reject_option(path)?;
        let mut args = vec!["worktree", "add", path];
        if !reference.is_empty() {
            reject_option(reference)?;
            args.push(reference);
        }
        self.run(&args).map(|_| ())
    }

    /// Remove a linked worktree.
    pub fn worktree_remove(&self, path: &str) -> Result<(), String> {
        reject_option(path)?;
        self.run(&["worktree", "remove", path]).map(|_| ())
    }

    /// List submodules and their status. Pointer changes already render in the
    /// diff viewer as git's "Subproject commit" lines, so no extra diff plumbing.
    pub fn submodules(&self) -> Result<Vec<Submodule>, String> {
        Ok(parse::submodules(&self.run(&["submodule", "status"])?))
    }

    /// Initialise + update all submodules to their recorded commits.
    pub fn submodule_update(&self) -> Result<String, String> {
        self.run(&["submodule", "update", "--init", "--recursive"])
    }

    /// Sync submodule remote URLs from `.gitmodules`.
    pub fn submodule_sync(&self) -> Result<(), String> {
        self.run(&["submodule", "sync", "--recursive"]).map(|_| ())
    }

    /// Sparse-checkout state: whether the worktree is narrowed, and to what.
    ///
    /// `git sparse-checkout list` is NOT a probe for whether the feature is on.
    /// On a worktree that is not sparse it warns on stderr and still exits **0**
    /// (git 2.34), so a successful call proves nothing and every ordinary
    /// repository read as narrowed-to-nothing. The switch git itself reads is
    /// `core.sparseCheckout`, so that is what decides `enabled`; `list` is asked
    /// only afterwards, for the patterns.
    pub fn sparse_status(&self) -> Result<SparseStatus, String> {
        // `config --get` exits 1 when the key is unset, which is the common
        // case and not an error — hence the raw command rather than `run`.
        let cfg = self
            .target
            .command(&["config", "--get", "core.sparseCheckout"])
            .output()
            .map_err(|e| e.to_string())?;
        let enabled = cfg.status.success()
            && String::from_utf8_lossy(&cfg.stdout)
                .trim()
                .eq_ignore_ascii_case("true");
        if !enabled {
            return Ok(SparseStatus {
                enabled: false,
                patterns: Vec::new(),
            });
        }
        let out = self
            .target
            .command(&["sparse-checkout", "list"])
            .output()
            .map_err(|e| e.to_string())?;
        let patterns = if out.status.success() {
            let raw = String::from_utf8_lossy(&out.stdout);
            lines(&raw).map(str::to_string).collect()
        } else {
            Vec::new()
        };
        Ok(SparseStatus { enabled, patterns })
    }

    /// Enable (cone-mode) sparse-checkout limited to `patterns` (directories).
    pub fn sparse_set(&self, patterns: &[String]) -> Result<(), String> {
        if patterns.is_empty() {
            return Err("no paths to include".to_string());
        }
        let mut args = vec!["sparse-checkout", "set", "--"];
        for p in patterns {
            reject_option(p)?;
            args.push(p.as_str());
        }
        self.run(&args).map(|_| ())
    }

    /// Disable sparse-checkout, restoring the full working tree.
    pub fn sparse_disable(&self) -> Result<(), String> {
        self.run(&["sparse-checkout", "disable"]).map(|_| ())
    }

    /// Discard every working-tree change: restore tracked files to HEAD and
    /// remove untracked files/dirs.
    pub fn discard_all(&self) -> Result<(), String> {
        self.run(&["restore", "--staged", "--worktree", "--", "."])?;
        self.run(&["clean", "-fd"]).map(|_| ())
    }

    /// Check out a commit directly, leaving HEAD detached so the user can
    /// inspect or branch off it.
    pub fn checkout_commit(&self, hash: &str) -> Result<(), String> {
        // `git checkout` reads a value after `--` as a pathspec, so a `--`
        // separator can't guard a commit-ish here — reject a leading-dash value.
        reject_option(hash)?;
        self.run(&["checkout", hash]).map(|_| ())
    }

    pub fn create_branch(&self, name: &str) -> Result<(), String> {
        reject_option(name)?;
        self.run(&["switch", "-c", name]).map(|_| ())
    }

    /// Create a branch at a specific commit and switch to it ("branch here").
    pub fn create_branch_at(&self, name: &str, hash: &str) -> Result<(), String> {
        reject_option(name)?;
        reject_option(hash)?;
        self.run(&["switch", "-c", name, hash]).map(|_| ())
    }

    pub fn delete_branch(&self, name: &str) -> Result<(), String> {
        reject_option(name)?;
        self.run(&["branch", "-d", "--", name]).map(|_| ())
    }

    /// Revert a commit (creates a new inverse commit, no editor).
    /// Revert one or more commits (no editor). `mainline` (1-based) selects the
    /// parent to revert against — required when reverting a merge commit.
    pub fn revert(&self, hashes: &[String], mainline: Option<u32>) -> Result<(), String> {
        if hashes.is_empty() {
            return Err("no commits to revert".to_string());
        }
        let mut args = vec!["revert".to_string(), "--no-edit".to_string()];
        if let Some(m) = mainline {
            args.push("-m".to_string());
            args.push(m.to_string());
        }
        args.push("--".to_string());
        for h in hashes {
            reject_option(h)?;
            args.push(h.clone());
        }
        let argv: Vec<&str> = args.iter().map(String::as_str).collect();
        self.run(&argv).map(|_| ())
    }

    /// Cherry-pick a commit onto the current branch.
    /// Cherry-pick one or more commits, applied in the given order (oldest
    /// first). A mid-operation conflict leaves the standard cherry-pick state for
    /// the existing conflict UI to resolve.
    pub fn cherry_pick(&self, hashes: &[String]) -> Result<(), String> {
        if hashes.is_empty() {
            return Err("no commits to cherry-pick".to_string());
        }
        let mut args = vec!["cherry-pick", "--"];
        for h in hashes {
            reject_option(h)?;
            args.push(h.as_str());
        }
        self.run(&args).map(|_| ())
    }

    /// Move the current branch to `hash`. A hard reset discards working-tree
    /// changes — the UI confirms first.
    pub fn reset(&self, hash: &str, mode: ResetMode) -> Result<(), String> {
        // `git reset` treats anything after `--` as a pathspec ("Cannot do soft
        // reset with paths"), so guard the commit-ish by rejecting a leading `-`.
        reject_option(hash)?;
        let flag = match mode {
            ResetMode::Soft => "--soft",
            ResetMode::Mixed => "--mixed",
            ResetMode::Hard => "--hard",
        };
        self.run(&["reset", flag, hash]).map(|_| ())
    }

    pub fn rename_branch(&self, old: &str, new: &str) -> Result<(), String> {
        reject_option(old)?;
        reject_option(new)?;
        self.run(&["branch", "-m", "--", old, new]).map(|_| ())
    }

    /// Set a branch's upstream to `<remote>/<branch>` (so pull/push track it).
    pub fn set_upstream(&self, remote: &str, branch: &str) -> Result<(), String> {
        reject_option(remote)?;
        reject_option(branch)?;
        let target = format!("--set-upstream-to={remote}/{branch}");
        self.run(&["branch", &target, "--", branch]).map(|_| ())
    }

    /// Create a lightweight tag at `hash` (or HEAD when `hash` is empty).
    /// Create a tag. With no message it stays lightweight (a bare ref); a message
    /// makes it annotated (`-a`), and `sign` produces a signed annotated tag
    /// (`-s`, using the configured `user.signingkey` / `gpg.format`). The message
    /// is passed as the value of `-m`, so it is never treated as an option.
    pub fn create_tag(
        &self,
        name: &str,
        hash: &str,
        message: &str,
        sign: bool,
    ) -> Result<(), String> {
        reject_option(name)?;
        let mut args = vec!["tag"];
        if sign {
            args.extend(["-s", "-m", message]);
        } else if !message.is_empty() {
            args.extend(["-a", "-m", message]);
        }
        args.push("--");
        args.push(name);
        if !hash.is_empty() {
            reject_option(hash)?;
            args.push(hash);
        }
        self.run(&args).map(|_| ())
    }

    pub fn delete_tag(&self, name: &str) -> Result<(), String> {
        reject_option(name)?;
        self.run(&["tag", "-d", "--", name]).map(|_| ())
    }

    /// Push all local tags to the default remote.
    pub fn push_tags(&self) -> Result<String, String> {
        self.run(&["push", "--tags"])
    }

    pub fn add_remote(&self, name: &str, url: &str) -> Result<(), String> {
        reject_option(name)?;
        // The URL is positional after the name; a leading `-` would be parsed as
        // an option. (Dangerous transports like `ext::` are blocked by git's own
        // protocol policy on fetch, but reject the option-injection vector here.)
        reject_option(url)?;
        self.run(&["remote", "add", name, url]).map(|_| ())
    }

    pub fn remove_remote(&self, name: &str) -> Result<(), String> {
        reject_option(name)?;
        self.run(&["remote", "remove", name]).map(|_| ())
    }

    pub fn rename_remote(&self, old: &str, new: &str) -> Result<(), String> {
        reject_option(old)?;
        reject_option(new)?;
        self.run(&["remote", "rename", old, new]).map(|_| ())
    }

    /// List stash entries as (ref, message) pairs.
    pub fn stash_list(&self) -> Result<Vec<StashEntry>, String> {
        let fmt = format!("--format=%gd{US}%s");
        let raw = self.run(&["stash", "list", &fmt])?;
        Ok(lines(&raw)
            .filter_map(|l| {
                let mut p = l.splitn(2, US);
                let reference = p.next()?.to_string();
                let message = p.next().unwrap_or("").to_string();
                Some(StashEntry { reference, message })
            })
            .collect())
    }

    /// Stash the working tree. Optionally include untracked files and/or limit to
    /// specific paths (an empty `paths` stashes everything).
    pub fn stash_save(
        &self,
        message: &str,
        include_untracked: bool,
        paths: &[String],
    ) -> Result<(), String> {
        let mut args = vec!["stash", "push"];
        if include_untracked {
            args.push("--include-untracked");
        }
        if !message.is_empty() {
            args.push("-m");
            args.push(message);
        }
        if !paths.is_empty() {
            for p in paths {
                reject_unsafe_path(p)?;
            }
            args.push("--");
            args.extend(paths.iter().map(String::as_str));
        }
        self.run(&args).map(|_| ())
    }

    pub fn stash_pop(&self, reference: &str) -> Result<(), String> {
        reject_option(reference)?;
        self.run(&["stash", "pop", reference]).map(|_| ())
    }

    pub fn stash_apply(&self, reference: &str) -> Result<(), String> {
        reject_option(reference)?;
        self.run(&["stash", "apply", reference]).map(|_| ())
    }

    pub fn stash_drop(&self, reference: &str) -> Result<(), String> {
        reject_option(reference)?;
        self.run(&["stash", "drop", reference]).map(|_| ())
    }

    /// Files changed by a stash — for previewing its contents before pop/apply.
    pub fn stash_files(&self, reference: &str) -> Result<Vec<CommitFile>, String> {
        reject_option(reference)?;
        let raw = self.run(&["stash", "show", "--name-status", reference])?;
        Ok(parse::commit_files(&raw))
    }

    /// Per-file diff of a stash for the preview. A stash is a merge commit, so
    /// `git show` yields an unusable combined diff; diffing against the stash's
    /// first parent (the commit it was made on) gives a normal, parseable diff.
    pub fn stash_file_diff(
        &self,
        reference: &str,
        file: &str,
        ignore_whitespace: bool,
        whole: bool,
    ) -> Result<Option<DiffData>, String> {
        reject_option(reference)?;
        reject_unsafe_path(file)?;
        let base = format!("{reference}^");
        let mut args = vec!["diff", "--no-color", "--no-ext-diff", "--no-textconv"];
        if ignore_whitespace {
            args.push("-w");
        }
        args.push(&base);
        args.push(reference);
        args.push("--");
        args.push(file);
        let (raw, whole_refused) = self.run_whole_diff(&args, whole)?;
        let Some(mut diff) = parse::diff(&raw) else {
            return Ok(None);
        };
        diff.whole_refused = whole_refused;
        diff.attach_contents(
            || self.content(&format!("{reference}^:{file}")),
            || self.content(&format!("{reference}:{file}")),
        );
        Ok(Some(diff))
    }

    pub fn fetch(&self) -> Result<String, String> {
        self.run(&["fetch", "--all", "--prune"])
    }

    /// Pull with an explicit reconcile strategy so git never aborts with "Need
    /// to specify how to reconcile divergent branches" (which it does for a bare
    /// `git pull` on diverged branches when the user has no pull.rebase/pull.ff
    /// config): `merge` → `--no-rebase`, `rebase` → `--rebase`, `ff-only` →
    /// `--ff-only`. An unknown value falls back to merge.
    pub fn pull(&self, strategy: &str) -> Result<String, String> {
        let flag = match strategy {
            "rebase" => "--rebase",
            "ff-only" => "--ff-only",
            _ => "--no-rebase",
        };
        self.run(&["pull", flag])
    }

    /// Resolve a conflicted file: take `ours`/`theirs` then stage it, or just
    /// stage a manually-resolved file (`mark`).
    pub fn resolve_conflict(&self, file: &str, side: &str) -> Result<(), String> {
        reject_unsafe_path(file)?;
        match side {
            "ours" => {
                self.run(&["checkout", "--ours", "--", file])?;
            }
            "theirs" => {
                self.run(&["checkout", "--theirs", "--", file])?;
            }
            _ => {}
        }
        self.run(&["add", "--", file]).map(|_| ())
    }

    /// The working-tree content of a conflicted file, with its conflict markers,
    /// for the merge editor to parse into regions.
    pub fn conflict_content(&self, file: &str) -> Result<String, String> {
        reject_unsafe_path(file)?;
        Ok(self.target.read_file(file).unwrap_or_default())
    }

    /// Write a resolved file (from the merge editor) and stage it. The path is
    /// written through the host view so it works natively and over `\\wsl$`.
    pub fn resolve_conflict_save(&self, file: &str, content: &str) -> Result<(), String> {
        reject_unsafe_path(file)?;
        let top = self
            .run(&["rev-parse", "--show-toplevel"])?
            .trim()
            .to_string();
        let host = self.target.host_path(&format!("{top}/{file}"));
        std::fs::write(&host, content).map_err(|e| format!("failed to write file: {e}"))?;
        self.run(&["add", "--", file]).map(|_| ())
    }

    /// Push the current branch. `set_upstream` publishes a new branch and
    /// records its upstream (`-u origin HEAD`); `force` uses the safe
    /// `--force-with-lease` (never the unconditional `--force`).
    pub fn push(&self, set_upstream: bool, force: bool) -> Result<String, String> {
        let mut args = vec!["push"];
        if force {
            args.push("--force-with-lease");
        }
        if set_upstream {
            args.extend(["--set-upstream", "origin", "HEAD"]);
        }
        self.run(&args)
    }

    /// Read a git config value (`git config [--global] --get <key>`). git reports
    /// an unset key with exit code 1; map that to an empty string so "not
    /// configured" is a normal result rather than an error.
    /// Read a config value at a given `scope`: `global` / `local` / `system`, or
    /// any other value (`""`) for the *effective* value after full precedence.
    /// The scope maps to a fixed flag — never interpolated — so it can't inject
    /// an option.
    pub fn config_get(&self, key: &str, scope: &str) -> Result<String, String> {
        reject_option(key)?;
        let mut args = vec!["config"];
        match scope {
            "global" => args.push("--global"),
            "local" => args.push("--local"),
            "system" => args.push("--system"),
            _ => {}
        }
        args.push("--get");
        args.push(key);
        let output = self.target.command(&args).output().map_err(|e| {
            format!(
                "failed to run git: {e}\n\n$ {}",
                self.target.describe(&args)
            )
        })?;
        match output.status.code() {
            Some(0) => Ok(String::from_utf8_lossy(&output.stdout).trim().to_string()),
            Some(1) => Ok(String::new()),
            _ => Err(format!(
                "{}\n\n$ {}",
                String::from_utf8_lossy(&output.stderr).trim(),
                self.target.describe(&args)
            )),
        }
    }

    /// Write a git config value (`git config [--global] <key> <value>`). `value`
    /// runs through the same option-injection guard as a ref (no leading `-`, no
    /// control characters) while still allowing the spaces and `@`/`.` a name or
    /// email needs.
    pub fn config_set(&self, key: &str, value: &str, global: bool) -> Result<(), String> {
        reject_option(key)?;
        reject_option(value)?;
        let mut args = vec!["config"];
        if global {
            args.push("--global");
        }
        args.push(key);
        args.push(value);
        self.run(&args).map(|_| ())
    }

    /// Remove a config key at `scope` (defaults to `local`). Tolerates a missing
    /// key (git exit 5) so toggling a per-repo override off is idempotent.
    pub fn config_unset(&self, key: &str, scope: &str) -> Result<(), String> {
        reject_option(key)?;
        let mut args = vec!["config"];
        match scope {
            "global" => args.push("--global"),
            "system" => args.push("--system"),
            _ => args.push("--local"),
        }
        args.push("--unset");
        args.push(key);
        let output = self
            .target
            .command(&args)
            .output()
            .map_err(|e| format!("failed to run git: {e}"))?;
        match output.status.code() {
            Some(0) | Some(5) => Ok(()),
            _ => Err(String::from_utf8_lossy(&output.stderr).trim().to_string()),
        }
    }

    /// Clone `url` into `parent` (an existing directory), returning the host path
    /// of the freshly created repo so the caller can open it. Routed through
    /// `parent`, so a `\\wsl$` parent clones inside the distro.
    pub fn clone_repo(&self, url: &str, parent: &str) -> Result<String, String> {
        reject_option(url)?;
        self.run(&["clone", "--", url])?;
        let name = clone_dir_name(url);
        let name = if name.is_empty() { "repo" } else { name };
        // `parse_wsl_path` normalises separators, so a `/` join round-trips for
        // both native and `\\wsl$` parents.
        Ok(format!("{}/{}", parent.trim_end_matches(['/', '\\']), name))
    }

    /// Initialise a new repository in this directory (which must exist), with an
    /// optional initial branch name. Returns the canonical toplevel host path.
    pub fn init_repo(&self, branch: Option<&str>) -> Result<String, String> {
        let mut args = vec!["init"];
        if let Some(b) = branch {
            reject_option(b)?;
            args.push("-b");
            args.push(b);
        }
        self.run(&args)?;
        let top = self.run(&["rev-parse", "--show-toplevel"])?;
        Ok(self.target.host_path(top.trim()))
    }
}

/// Generates `app/types/bindings.ts` from the serde structs above so the
/// frontend imports one source-of-truth contract instead of re-declaring it.
/// Regenerate with `pnpm bindings` (runs this test, then formats the output).
#[cfg(test)]
#[test]
#[ignore = "writes app/types/bindings.ts; regenerate via `pnpm bindings`"]
fn export_bindings() {
    // ts-rs 12 takes an explicit `&Config`; defaults reproduce the pre-12 output.
    let cfg = ts_rs::Config::default();
    let decls = [
        Commit::decl(&cfg),
        Branch::decl(&cfg),
        ReflogEntry::decl(&cfg),
        Worktree::decl(&cfg),
        Submodule::decl(&cfg),
        SparseStatus::decl(&cfg),
        StashEntry::decl(&cfg),
        RepoInfo::decl(&cfg),
        DiffData::decl(&cfg),
        CommitFile::decl(&cfg),
        BlameLine::decl(&cfg),
        StatusEntry::decl(&cfg),
        RebaseStep::decl(&cfg),
        ImageDiff::decl(&cfg),
        Contributor::decl(&cfg),
        ActivityPoint::decl(&cfg),
        FileChurn::decl(&cfg),
        RepoStats::decl(&cfg),
        SshKey::decl(&cfg),
        SshStatus::decl(&cfg),
        trace::GitCommandEntry::decl(&cfg),
    ];
    let body: String = decls.iter().map(|d| format!("export {d}\n\n")).collect();
    let file = format!(
        "// GENERATED from src-tauri/crates/glimpse-core/src/git.rs by `cargo test` (ts-rs).\n\
         // Do not edit — change the Rust structs and re-run.\n\n{body}"
    );
    std::fs::create_dir_all("../../../app/types").expect("create app/types");
    std::fs::write("../../../app/types/bindings.ts", file).expect("write bindings.ts");
}

#[cfg(test)]
mod validate_tests {
    use super::{build_partial_hunk, reject_option, reject_unsafe_hunk, reject_unsafe_path};

    // A hunk body indexed 0..=3: context, removal, addition, addition.
    const HUNK: &str = "@@ -1,3 +1,4 @@\n ctx\n-removed\n+added1\n+added2";

    #[test]
    fn build_partial_hunk_stages_only_selected_addition() {
        // Stage just `+added1` (body index 2): the unselected removal becomes
        // context (it stays in the index) and the unselected addition is dropped.
        let got = build_partial_hunk(HUNK, &[2], false);
        assert_eq!(got, "@@ -1,3 +1,4 @@\n ctx\n removed\n+added1\n");
        // The reduced hunk is still a structurally valid patch body.
        assert!(reject_unsafe_hunk(got.trim_end()).is_ok());
    }

    #[test]
    fn build_partial_hunk_stages_only_selected_removal() {
        // Stage just the removal (index 1): both additions are dropped.
        let got = build_partial_hunk(HUNK, &[1], false);
        assert_eq!(got, "@@ -1,3 +1,4 @@\n ctx\n-removed\n");
    }

    #[test]
    fn build_partial_hunk_unstage_flips_the_roles() {
        // Unstaging `+added1` (reverse): the unselected addition is demoted to
        // context (stays staged) and the unselected removal is dropped.
        let got = build_partial_hunk(HUNK, &[2], true);
        assert_eq!(got, "@@ -1,3 +1,4 @@\n ctx\n+added1\n added2\n");
    }

    #[test]
    fn build_partial_hunk_keeps_no_newline_marker() {
        let hunk = "@@ -1 +1 @@\n-old\n+new\n\\ No newline at end of file";
        // Stage the addition (index 1); the no-newline marker is preserved.
        let got = build_partial_hunk(hunk, &[1], false);
        assert_eq!(
            got,
            "@@ -1 +1 @@\n old\n+new\n\\ No newline at end of file\n"
        );
    }

    #[test]
    fn build_partial_hunk_empty_selection_drops_all_changes() {
        // Nothing selected → only context survives (caller rejects this upfront).
        let got = build_partial_hunk(HUNK, &[], false);
        assert_eq!(got, "@@ -1,3 +1,4 @@\n ctx\n removed\n");
    }

    #[test]
    fn aggregate_stats_counts_and_sorts() {
        use super::aggregate_stats;
        let us = '\u{1f}';
        let raw = format!(
            "Ann{us}a@x{us}2024-01-02\n\
             Bob{us}b@x{us}2024-01-02\n\
             Ann{us}a@x{us}2024-01-01\n\
             Ann{us}a@x{us}2024-01-02\n"
        );
        let (total, contributors, activity) = aggregate_stats(&raw);
        assert_eq!(total, 4);
        assert_eq!(contributors[0].name, "Ann");
        assert_eq!(contributors[0].commits, 3);
        assert_eq!(contributors[1].commits, 1);
        // activity is ascending by date, counted per day
        assert_eq!(activity[0].date, "2024-01-01");
        assert_eq!(activity[1].date, "2024-01-02");
        assert_eq!(activity[1].count, 3);
    }

    #[test]
    fn aggregate_churn_ranks_top_files() {
        use super::aggregate_churn;
        let raw = "a.rs\nb.rs\n\na.rs\n\na.rs\nb.rs\n";
        let churn = aggregate_churn(raw, 1);
        assert_eq!(churn.len(), 1);
        assert_eq!(churn[0].path, "a.rs");
        assert_eq!(churn[0].changes, 3);
    }

    #[test]
    fn base64_encode_matches_known_vectors() {
        use super::base64_encode_into;
        let encode = |bytes: &[u8]| {
            let mut out = String::new();
            base64_encode_into(bytes, &mut out);
            out
        };
        assert_eq!(encode(b""), "");
        assert_eq!(encode(b"f"), "Zg==");
        assert_eq!(encode(b"fo"), "Zm8=");
        assert_eq!(encode(b"foo"), "Zm9v");
        assert_eq!(encode(b"foob"), "Zm9vYg==");
        assert_eq!(encode(b"foobar"), "Zm9vYmFy");
    }

    #[test]
    fn lfs_from_check_attr_collects_only_lfs_filtered_paths() {
        use super::lfs_from_check_attr;
        // Triplets: big.bin is LFS, notes.txt is filtered but not lfs, and
        // plain.rs has no filter — only the first should be collected.
        let out = "big.bin\u{0}filter\u{0}lfs\u{0}\
                   notes.txt\u{0}filter\u{0}clean\u{0}\
                   plain.rs\u{0}filter\u{0}unspecified\u{0}";
        let set = lfs_from_check_attr(out);
        assert_eq!(set.len(), 1);
        assert!(set.contains("big.bin"));
        assert!(lfs_from_check_attr("").is_empty());
    }

    #[test]
    fn build_rebase_todo_maps_actions_and_amend_execs() {
        use super::{build_rebase_todo, RebaseStep};
        let step = |action: &str, hash: &str, message: Option<&str>| RebaseStep {
            action: action.to_string(),
            hash: hash.to_string(),
            message: message.map(str::to_string),
        };
        let steps = [
            step("pick", "aaa", None),
            step("reword", "bbb", Some("new subject")),
            step("squash", "ccc", Some("merged")),
            step("fixup", "ddd", None),
            step("drop", "eee", None),
        ];
        let (todo, msgs) = build_rebase_todo(&steps, "/g/.git/m-");
        assert_eq!(
            todo,
            "pick aaa\n\
             pick bbb\n\
             exec git commit --amend --file=\"/g/.git/m-1\"\n\
             squash ccc\n\
             exec git commit --amend --file=\"/g/.git/m-2\"\n\
             fixup ddd\n\
             drop eee\n"
        );
        assert_eq!(
            msgs,
            vec![
                ("/g/.git/m-1".to_string(), "new subject".to_string()),
                ("/g/.git/m-2".to_string(), "merged".to_string()),
            ]
        );
    }

    #[test]
    fn reject_unsafe_hunk_blocks_smuggled_file_section() {
        // A normal hunk (header + context/add/remove/no-newline lines) is fine.
        let ok = "@@ -1,2 +1,2 @@\n context\n-old\n+new\n\\ No newline at end of file";
        assert!(reject_unsafe_hunk(ok).is_ok());
        // Removed/added lines that merely *look* like diff headers stay valid
        // (they carry the -/+ prefix, so git treats them as content).
        let tricky = "@@ -1 +1 @@\n--- a/keep\n+++ b/keep";
        assert!(reject_unsafe_hunk(tricky).is_ok());
        // A smuggled second file section (bare `diff --git`, `index`, `new file`)
        // is rejected — those lines lack a hunk prefix.
        for bad in [
            "@@ -1 +1 @@\n-old\n+new\ndiff --git a/other b/other\n--- a/other\n+++ b/other\n@@ -1 +1 @@\n-x\n+PWNED",
            "@@ -1 +1 @@\n+x\nindex 0000..1111 100644",
            "@@ -1 +1 @@\n+x\nnew file mode 100644",
        ] {
            assert!(reject_unsafe_hunk(bad).is_err(), "should reject {bad:?}");
        }
    }

    #[test]
    fn reject_option_blocks_leading_dash_and_control() {
        // Option-injection vectors and empties are rejected.
        for bad in ["-D", "--upload-pack=x", "-", "", "a\nb", "x\u{1b}y"] {
            assert!(reject_option(bad).is_err(), "should reject {bad:?}");
        }
        // Ordinary refs/hashes/remote names pass — including ones with `/`, `~`,
        // `@`, `{}` that are valid in real ref/rev syntax.
        for ok in [
            "main",
            "origin/main",
            "feature/x",
            "HEAD~3",
            "stash@{0}",
            "v1.2.3",
            "0a1b2c3d",
        ] {
            assert!(reject_option(ok).is_ok(), "should allow {ok:?}");
        }
    }

    #[test]
    fn reject_unsafe_path_blocks_traversal_and_injection() {
        for bad in [
            "/etc/passwd",
            "C:\\Windows\\win.ini",
            "../secret",
            "a/../../b",
            "x\n+++ b/evil",
            "x\rrest",
            "",
        ] {
            assert!(reject_unsafe_path(bad).is_err(), "should reject {bad:?}");
        }
        // Normal repo-relative paths pass.
        for ok in [
            "src/main.rs",
            "a/b/c.txt",
            "file with spaces.md",
            "-leading-dash.txt",
        ] {
            assert!(reject_unsafe_path(ok).is_ok(), "should allow {ok:?}");
        }
    }
}

/// End-to-end tests against a real `git` in a throwaway repo. These exercise the
/// changelist commit primitive ([`Repo::commit_paths`]) — the file-level commit
/// both the GUI's per-list commit and the headless `glimpse cl commit` rely on —
/// and assert its core contract: commit exactly the listed paths, leave the rest
/// dirty.
#[cfg(test)]
mod commit_paths_tests {
    use super::Repo;
    use std::path::{Path, PathBuf};
    use std::process::Command;

    /// Run `git -C <dir> <args>` with a hermetic, signing-free identity so the
    /// test never depends on (or mutates) the developer's global git config.
    fn git(dir: &Path, args: &[&str]) {
        let status = Command::new("git")
            .arg("-C")
            .arg(dir)
            .args(args)
            .status()
            .expect("run git");
        assert!(status.success(), "git {args:?} failed");
    }

    fn porcelain(dir: &Path) -> String {
        let out = Command::new("git")
            .arg("-C")
            .arg(dir)
            .args(["status", "--porcelain"])
            .output()
            .expect("run git status");
        String::from_utf8_lossy(&out.stdout).into_owned()
    }

    fn head_files(dir: &Path) -> String {
        let out = Command::new("git")
            .arg("-C")
            .arg(dir)
            .args(["show", "--name-only", "--format=", "HEAD"])
            .output()
            .expect("run git show");
        String::from_utf8_lossy(&out.stdout).into_owned()
    }

    #[test]
    fn commit_paths_commits_only_listed_files_and_leaves_the_rest_dirty() {
        // A per-process scratch repo, removed before and after so reruns are clean.
        let dir: PathBuf =
            std::env::temp_dir().join(format!("glimpse-commit-paths-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("create temp repo");

        git(&dir, &["init", "-q"]);
        git(&dir, &["config", "user.email", "test@example.com"]);
        git(&dir, &["config", "user.name", "Test"]);
        git(&dir, &["config", "commit.gpgsign", "false"]);

        // Baseline commit with two tracked files.
        std::fs::write(dir.join("a.txt"), "a1\n").unwrap();
        std::fs::write(dir.join("b.txt"), "b1\n").unwrap();
        git(&dir, &["add", "-A"]);
        git(&dir, &["commit", "-q", "-m", "initial"]);

        // Now: modify both tracked files and add an untracked one.
        std::fs::write(dir.join("a.txt"), "a2\n").unwrap();
        std::fs::write(dir.join("b.txt"), "b2\n").unwrap();
        std::fs::write(dir.join("c.txt"), "c1\n").unwrap();

        let repo = Repo::open(dir.to_str().unwrap());
        repo.commit_paths("change a", &["a.txt".to_string()], false)
            .expect("commit_paths succeeds");

        // The new HEAD carries a.txt and nothing else.
        let head = head_files(&dir);
        assert!(
            head.contains("a.txt"),
            "a.txt should be committed: {head:?}"
        );
        assert!(
            !head.contains("b.txt"),
            "b.txt must not be committed: {head:?}"
        );

        // b.txt stays modified, c.txt stays untracked — the rest is left dirty.
        let status = porcelain(&dir);
        assert!(
            status.contains("b.txt"),
            "b.txt should remain dirty: {status:?}"
        );
        assert!(
            status.contains("c.txt"),
            "c.txt should remain untracked: {status:?}"
        );
        assert!(
            !status.contains("a.txt"),
            "a.txt should be clean after commit: {status:?}"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }
}

#[cfg(test)]
mod version_tests {
    use super::Repo;

    #[test]
    fn version_reports_the_git_that_would_run() {
        // `git --version` needs no repository, which is the point: the report has
        // to name a git even when nothing is open. It goes through the resolved
        // target like every other call, so on Windows a WSL repo reports the
        // distro's git rather than the host's.
        let v = Repo::open("").version().expect("git --version");
        assert!(v.starts_with("git version "), "unexpected output: {v:?}");
        // Trimmed, because it goes straight into a pasted markdown list item.
        assert_eq!(v, v.trim());
    }
}

#[cfg(test)]
mod command_log_tests {
    use super::{trace, Repo};

    #[test]
    fn every_git_call_lands_in_the_command_log() {
        // A real invocation through the public surface. The buffer is
        // process-wide and the rest of the suite runs git too, so this looks for
        // its own call rather than assuming it is alone in there.
        let v = Repo::open("").version().expect("git --version");
        assert!(v.starts_with("git version "));
        let entries = trace::entries();
        let mine = entries
            .iter()
            .rev()
            .find(|e| e.command.ends_with("--version"))
            .expect("the --version call was recorded");
        assert!(mine.ok, "a call that worked was recorded as failed");
        assert_eq!(mine.error, "", "a call that worked has nothing to say");
        // The whole invocation, not just the subcommand: a git target routed to
        // the wrong place is invisible unless the argv that ran is there.
        assert!(
            mine.command.contains("-c core.fsmonitor="),
            "not the real argv: {}",
            mine.command
        );
    }

    #[test]
    fn a_failed_call_records_gits_own_message() {
        let dir = std::env::temp_dir().join(format!("glimpse-cmdlog-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("create temp dir");
        let path = dir.to_str().unwrap().to_string();

        // Not a repository, so git fails and says why.
        let err = Repo::open(&path).info().err().expect("not a repository");
        let entries = trace::entries();
        let mine = entries
            .iter()
            .rev()
            .find(|e| e.command.contains(&path))
            .expect("the failed call was recorded");
        assert!(!mine.ok, "a call that failed was recorded as fine");
        assert!(!mine.error.is_empty(), "a failure with no message");
        assert!(
            err.contains(&mine.error),
            "the log and the error disagree: {:?} vs {err:?}",
            mine.error
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn an_injected_failure_travels_the_real_error_path() {
        // Faults are passed in rather than read off the process-wide switch:
        // the suite runs in parallel, and a test that flipped the global would
        // make every other test's git calls fail too.
        let repo = Repo::open(".");
        let err = repo
            .run_with(
                &["status"],
                trace::Faults {
                    fail: true,
                    slow: false,
                },
            )
            .expect_err("the injected failure is a failure");
        // Same shape a real failure has — git's message, then the invocation —
        // so cleanGitError and the UI toast see nothing unusual.
        assert!(err.starts_with(trace::INJECTED_FAILURE), "{err}");
        assert!(err.contains("\n\n$ "), "the invocation is missing: {err}");
        // And it is recorded like one, without git ever having run.
        let entries = trace::entries();
        let mine = entries
            .iter()
            .rev()
            .find(|e| e.error == trace::INJECTED_FAILURE)
            .expect("the injected failure was recorded");
        assert!(!mine.ok);
        assert!(mine.command.ends_with("status"), "{}", mine.command);
    }
}

#[cfg(test)]
mod diff_content_cap_tests {
    use super::{DiffData, Repo, MAX_DIFF_CONTENT_BYTES};
    use std::cell::Cell;
    use std::path::{Path, PathBuf};
    use std::process::Command;

    /// A parsed diff before its contents are attached — what `parse::diff`
    /// hands back, hunks and all.
    fn parsed() -> DiffData {
        DiffData {
            file_name: "big.txt".to_string(),
            old_content: String::new(),
            new_content: String::new(),
            hunks: vec!["@@ -1 +1 @@\n-first\n+second".to_string()],
            is_lfs: false,
            contents_omitted: false,
            whole_refused: false,
        }
    }

    fn past_the_ceiling() -> String {
        "x".repeat(MAX_DIFF_CONTENT_BYTES + 1)
    }

    #[test]
    fn contents_within_the_ceiling_are_attached_as_before() {
        let mut diff = parsed();
        diff.attach_contents(|| "first\n".to_string(), || "second\n".to_string());
        assert_eq!(diff.old_content, "first\n");
        assert_eq!(diff.new_content, "second\n");
        assert!(!diff.contents_omitted, "a small file is not capped");
    }

    #[test]
    fn a_side_past_the_ceiling_ships_no_contents_at_all() {
        let mut diff = parsed();
        // The small side must not travel alone: the viewer would render the
        // missing half as an empty file, i.e. "everything was deleted".
        diff.attach_contents(|| "first\n".to_string(), past_the_ceiling);
        assert!(
            diff.contents_omitted,
            "the cap has to be visible in the payload"
        );
        assert!(diff.old_content.is_empty(), "old content shipped anyway");
        assert!(diff.new_content.is_empty(), "new content shipped anyway");
        assert_eq!(
            diff.hunks.len(),
            1,
            "the hunks are still the diff, and still ship"
        );
    }

    #[test]
    fn an_oversized_first_side_is_never_followed_by_a_second_read() {
        // Loading the second side would put both halves of a huge file in
        // memory at once — exactly what the ceiling exists to prevent.
        let second_read = Cell::new(false);
        let mut diff = parsed();
        diff.attach_contents(past_the_ceiling, || {
            second_read.set(true);
            String::new()
        });
        assert!(diff.contents_omitted);
        assert!(
            !second_read.get(),
            "the second side was read despite the first being over"
        );
    }

    fn git(dir: &Path, args: &[&str]) {
        let status = Command::new("git")
            .arg("-C")
            .arg(dir)
            .args(args)
            .status()
            .expect("run git");
        assert!(status.success(), "git {args:?} failed");
    }

    #[test]
    fn file_diff_caps_a_large_file_and_leaves_a_small_one_whole() {
        let dir: PathBuf =
            std::env::temp_dir().join(format!("glimpse-diff-cap-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("create temp repo");

        git(&dir, &["init", "-q"]);
        git(&dir, &["config", "user.email", "test@example.com"]);
        git(&dir, &["config", "user.name", "Test"]);
        git(&dir, &["config", "commit.gpgsign", "false"]);

        // Same bulk on both sides, so the *diff* stays one line while each
        // side's content is past the ceiling — the case the cap is for.
        let bulk = ("x".repeat(63) + "\n").repeat(MAX_DIFF_CONTENT_BYTES / 64 + 2);
        std::fs::write(dir.join("big.txt"), format!("first\n{bulk}")).unwrap();
        std::fs::write(dir.join("small.txt"), "first\n").unwrap();
        git(&dir, &["add", "-A"]);
        git(&dir, &["commit", "-q", "-m", "initial"]);
        std::fs::write(dir.join("big.txt"), format!("second\n{bulk}")).unwrap();
        std::fs::write(dir.join("small.txt"), "second\n").unwrap();

        let repo = Repo::open(dir.to_str().unwrap());

        let big = repo
            .file_diff("big.txt", false, false, false)
            .expect("diff big.txt")
            .expect("big.txt changed");
        assert!(big.contents_omitted, "the large file was shipped in full");
        assert!(big.old_content.is_empty() && big.new_content.is_empty());
        assert!(!big.hunks.is_empty(), "the diff itself must still arrive");
        assert!(!big.is_lfs, "too large is not the same as LFS");

        let small = repo
            .file_diff("small.txt", false, false, false)
            .expect("diff small.txt")
            .expect("small.txt changed");
        assert!(
            !small.contents_omitted,
            "an ordinary file must not be capped"
        );
        assert_eq!(small.old_content, "first\n");
        assert_eq!(small.new_content, "second\n");

        let _ = std::fs::remove_dir_all(&dir);
    }
}

#[cfg(test)]
mod image_cap_tests {
    use super::{base64_encode_into, data_url, ImageDiff, ImageSide, Repo, MAX_IMAGE_BYTES};
    use std::cell::Cell;
    use std::path::{Path, PathBuf};
    use std::process::Command;

    /// What `image_diff` starts from: the MIME type is known from the name,
    /// neither side has been fetched yet.
    fn empty() -> ImageDiff {
        ImageDiff {
            mime: "image/png".to_string(),
            old: None,
            new: None,
            contents_omitted: false,
        }
    }

    #[test]
    fn both_sides_within_the_ceiling_are_embedded() {
        let mut diff = empty();
        diff.attach_sides(
            || ImageSide::Bytes(b"foo".to_vec()),
            || ImageSide::Bytes(b"foobar".to_vec()),
        );
        assert_eq!(diff.old.as_deref(), Some("data:image/png;base64,Zm9v"));
        assert_eq!(diff.new.as_deref(), Some("data:image/png;base64,Zm9vYmFy"));
        assert!(!diff.contents_omitted, "a small image is not capped");
    }

    #[test]
    fn an_absent_side_is_not_a_capped_one() {
        let mut diff = empty();
        diff.attach_sides(|| ImageSide::Absent, || ImageSide::Bytes(b"foo".to_vec()));
        assert!(diff.old.is_none(), "an added image has no committed side");
        assert_eq!(diff.new.as_deref(), Some("data:image/png;base64,Zm9v"));
        assert!(!diff.contents_omitted, "absent is not too large");
    }

    #[test]
    fn a_side_past_the_ceiling_embeds_neither_image() {
        let mut diff = empty();
        // The small side must not travel alone: a null side is how the viewer
        // is told the file was added or deleted, so shipping one would report a
        // change that never happened.
        diff.attach_sides(|| ImageSide::Bytes(b"foo".to_vec()), || ImageSide::TooLarge);
        assert!(
            diff.contents_omitted,
            "the cap has to be visible in the payload"
        );
        assert!(diff.old.is_none(), "old image shipped anyway");
        assert!(diff.new.is_none(), "new image shipped anyway");
    }

    #[test]
    fn an_oversized_first_side_is_never_followed_by_a_second_fetch() {
        // Fetching the second image would put it in memory beside a first one
        // already known to be too big to ship — the peak the ceiling is for.
        let second_fetch = Cell::new(false);
        let mut diff = empty();
        diff.attach_sides(
            || ImageSide::TooLarge,
            || {
                second_fetch.set(true);
                ImageSide::Absent
            },
        );
        assert!(diff.contents_omitted);
        assert!(
            !second_fetch.get(),
            "the second side was fetched despite the first being over"
        );
    }

    #[test]
    fn a_data_url_is_built_in_a_single_buffer() {
        // While a side is encoded the image exists twice — raw bytes and URL.
        // It must not exist three times, which is what encoding into its own
        // base64 string and then copying that into the URL would cost.
        let url = data_url("image/png", b"foobar");
        assert_eq!(url, "data:image/png;base64,Zm9vYmFy");
        assert_eq!(
            url.capacity(),
            url.len(),
            "the URL was sized once up front, so it never grew into a second buffer"
        );
    }

    #[test]
    fn base64_encodes_onto_the_end_of_the_callers_buffer() {
        let mut out = String::from("data:image/png;base64,");
        base64_encode_into(b"foo", &mut out);
        assert_eq!(out, "data:image/png;base64,Zm9v");
    }

    fn git(dir: &Path, args: &[&str]) {
        let status = Command::new("git")
            .arg("-C")
            .arg(dir)
            .args(args)
            .status()
            .expect("run git");
        assert!(status.success(), "git {args:?} failed");
    }

    #[test]
    fn image_diff_caps_an_oversized_side_and_embeds_a_small_one() {
        let dir: PathBuf =
            std::env::temp_dir().join(format!("glimpse-image-cap-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("create temp repo");

        git(&dir, &["init", "-q"]);
        git(&dir, &["config", "user.email", "test@example.com"]);
        git(&dir, &["config", "user.name", "Test"]);
        git(&dir, &["config", "commit.gpgsign", "false"]);

        // PNGs by name only — image_diff ships the bytes, it never decodes them.
        let over = vec![0u8; MAX_IMAGE_BYTES + 1];
        std::fs::write(dir.join("small.png"), b"first").unwrap();
        std::fs::write(dir.join("big.png"), &over).unwrap();
        std::fs::write(dir.join("shrunk.png"), &over).unwrap();
        git(&dir, &["add", "-A"]);
        git(&dir, &["commit", "-q", "-m", "initial"]);
        std::fs::write(dir.join("small.png"), b"second").unwrap();
        std::fs::write(dir.join("big.png"), vec![1u8; MAX_IMAGE_BYTES + 1]).unwrap();
        std::fs::write(dir.join("shrunk.png"), b"tiny now").unwrap();

        let repo = Repo::open(dir.to_str().unwrap());

        let big = repo.image_diff("big.png").expect("diff big.png");
        assert!(big.contents_omitted, "the large image was embedded anyway");
        assert!(big.old.is_none() && big.new.is_none());
        assert_eq!(big.mime, "image/png", "the viewer still learns the type");

        // Only the committed side is over: its size is read before its bytes
        // are, so the blob is declined without ever being loaded.
        let shrunk = repo.image_diff("shrunk.png").expect("diff shrunk.png");
        assert!(
            shrunk.contents_omitted,
            "an oversized committed side was embedded anyway"
        );
        assert!(shrunk.old.is_none() && shrunk.new.is_none());

        let small = repo.image_diff("small.png").expect("diff small.png");
        assert!(
            !small.contents_omitted,
            "an ordinary image must not be capped"
        );
        assert_eq!(small.old.as_deref(), Some("data:image/png;base64,Zmlyc3Q="));
        assert_eq!(small.new.as_deref(), Some("data:image/png;base64,c2Vjb25k"));

        let _ = std::fs::remove_dir_all(&dir);
    }
}

#[cfg(test)]
mod whole_mode_refusal_tests {
    use super::{Repo, MAX_DIFF_CONTENT_BYTES};
    use std::path::{Path, PathBuf};
    use std::process::Command;

    fn git(dir: &Path, args: &[&str]) {
        let status = Command::new("git")
            .arg("-C")
            .arg(dir)
            .args(args)
            .status()
            .expect("run git");
        assert!(status.success(), "git {args:?} failed");
    }

    /// A repo holding one file past [`MAX_DIFF_CONTENT_BYTES`] and one ordinary
    /// file, each changed in the working tree and each with that change also
    /// committed, so every one of the four diff views has something to show.
    fn repo_with_a_big_and_a_small_file(name: &str) -> (PathBuf, Repo) {
        let dir: PathBuf = std::env::temp_dir().join(format!(
            "glimpse-whole-refusal-{name}-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("create temp repo");

        git(&dir, &["init", "-q"]);
        git(&dir, &["config", "user.email", "test@example.com"]);
        git(&dir, &["config", "user.name", "Test"]);
        git(&dir, &["config", "commit.gpgsign", "false"]);

        // Identical bulk on both sides: the *change* is one line, so the
        // ordinary unified diff is tiny while the whole-file diff carries the
        // entire file. That gap is exactly what the refusal turns on.
        let bulk = ("x".repeat(63) + "\n").repeat(MAX_DIFF_CONTENT_BYTES / 64 + 2);
        std::fs::write(dir.join("big.txt"), format!("first\n{bulk}")).unwrap();
        std::fs::write(dir.join("small.txt"), "first\n").unwrap();
        git(&dir, &["add", "-A"]);
        git(&dir, &["commit", "-q", "-m", "initial"]);
        std::fs::write(dir.join("big.txt"), format!("second\n{bulk}")).unwrap();
        std::fs::write(dir.join("small.txt"), "second\n").unwrap();

        let repo = Repo::open(dir.to_str().unwrap());
        (dir, repo)
    }

    fn hunk_bytes(hunks: &[String]) -> usize {
        hunks.iter().map(String::len).sum()
    }

    #[test]
    fn whole_mode_is_refused_once_the_whole_file_diff_is_past_the_ceiling() {
        let (dir, repo) = repo_with_a_big_and_a_small_file("worktree");

        let big = repo
            .file_diff("big.txt", false, false, true)
            .expect("diff big.txt")
            .expect("big.txt changed");
        assert!(
            big.whole_refused,
            "the whole-file diff crossed IPC at full size anyway"
        );
        assert!(
            hunk_bytes(&big.hunks) <= MAX_DIFF_CONTENT_BYTES,
            "the refusal has to bound what is actually shipped"
        );
        assert!(
            !big.hunks.is_empty(),
            "the fallback still has to show the change"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn an_ordinary_file_still_gets_the_whole_file_view() {
        let (dir, repo) = repo_with_a_big_and_a_small_file("small");

        let small = repo
            .file_diff("small.txt", false, false, true)
            .expect("diff small.txt")
            .expect("small.txt changed");
        assert!(
            !small.whole_refused,
            "a file well under the ceiling must keep the mode it asked for"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_diff_that_never_asked_for_whole_mode_is_never_marked_refused() {
        let (dir, repo) = repo_with_a_big_and_a_small_file("plain");

        // Nothing was declined here: the default mode produced exactly the
        // diff it always did. Flagging it would put a note in the toolbar for
        // a user who never turned the mode on.
        let big = repo
            .file_diff("big.txt", false, false, false)
            .expect("diff big.txt")
            .expect("big.txt changed");
        assert!(!big.whole_refused);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn every_diff_view_refuses_whole_mode_alike() {
        // A mode that silently works in one view and not another is worse than
        // one that never works, so all four paths are held to the same rule.
        let (dir, repo) = repo_with_a_big_and_a_small_file("allviews");
        git(&dir, &["add", "-A"]);
        git(&dir, &["commit", "-q", "-m", "second"]);

        let commit = repo
            .commit_file_diff("HEAD", "big.txt", false, true)
            .expect("commit diff")
            .expect("big.txt is in the commit");
        assert!(commit.whole_refused, "commit view shipped the whole file");
        assert!(hunk_bytes(&commit.hunks) <= MAX_DIFF_CONTENT_BYTES);

        let compare = repo
            .compare_file_diff("HEAD~1", "HEAD", "big.txt", false, true)
            .expect("compare diff")
            .expect("big.txt differs between the refs");
        assert!(compare.whole_refused, "compare view shipped the whole file");
        assert!(hunk_bytes(&compare.hunks) <= MAX_DIFF_CONTENT_BYTES);

        let bulk = std::fs::read_to_string(dir.join("big.txt")).unwrap();
        std::fs::write(dir.join("big.txt"), bulk.replace("second\n", "third\n")).unwrap();
        git(&dir, &["stash", "-q"]);
        let stash = repo
            .stash_file_diff("stash@{0}", "big.txt", false, true)
            .expect("stash diff")
            .expect("big.txt is in the stash");
        assert!(stash.whole_refused, "stash view shipped the whole file");
        assert!(hunk_bytes(&stash.hunks) <= MAX_DIFF_CONTENT_BYTES);

        let _ = std::fs::remove_dir_all(&dir);
    }
}

/// Sparse-checkout detection, against a real `git`.
///
/// The regression this pins: `git sparse-checkout list` was used as the probe
/// for whether the feature is *on*, and it is not one — a worktree that is not
/// sparse gets a warning on stderr and exit code **0** (git 2.34), so every
/// ordinary repository reported `enabled: true` with an empty pattern list.
#[cfg(test)]
mod sparse_status_tests {
    use super::Repo;
    use std::path::{Path, PathBuf};
    use std::process::Command;

    fn git(dir: &Path, args: &[&str]) {
        let status = Command::new("git")
            .arg("-C")
            .arg(dir)
            .args(args)
            .status()
            .expect("run git");
        assert!(status.success(), "git {args:?} failed");
    }

    fn scratch(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("glimpse-sparse-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("create temp repo");
        git(&dir, &["init", "-q", "-b", "main"]);
        git(&dir, &["config", "user.email", "test@example.com"]);
        git(&dir, &["config", "user.name", "Test"]);
        git(&dir, &["config", "commit.gpgsign", "false"]);
        std::fs::create_dir_all(dir.join("keep")).unwrap();
        std::fs::write(dir.join("keep/k.txt"), "k\n").unwrap();
        std::fs::write(dir.join("a.txt"), "a\n").unwrap();
        git(&dir, &["add", "-A"]);
        git(&dir, &["commit", "-q", "-m", "initial"]);
        dir
    }

    #[test]
    fn an_ordinary_repository_is_not_reported_as_sparse() {
        let dir = scratch("off");
        let repo = Repo::open(dir.to_str().unwrap());

        let state = repo.sparse_status().expect("sparse status");
        assert!(
            !state.enabled,
            "a repository that was never narrowed must read as disabled"
        );
        assert!(state.patterns.is_empty(), "{:?}", state.patterns);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_narrowed_repository_reports_its_patterns() {
        let dir = scratch("on");
        let repo = Repo::open(dir.to_str().unwrap());
        git(&dir, &["sparse-checkout", "set", "keep"]);

        let state = repo.sparse_status().expect("sparse status");
        assert!(state.enabled, "a narrowed checkout must read as enabled");
        assert!(
            state.patterns.iter().any(|p| p.contains("keep")),
            "the included directory is listed: {:?}",
            state.patterns
        );

        let _ = std::fs::remove_dir_all(&dir);
    }
}

#[cfg(test)]
mod write_receipt_tests {
    use super::{Repo, WriteReceipt};
    use std::path::{Path, PathBuf};
    use std::process::Command;

    fn git(dir: &Path, args: &[&str]) {
        let status = Command::new("git")
            .arg("-C")
            .arg(dir)
            .args(args)
            .status()
            .expect("run git");
        assert!(status.success(), "git {args:?} failed");
    }

    fn scratch(tag: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("glimpse-receipt-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("create temp repo");
        git(&dir, &["init", "-q", "-b", "main"]);
        dir
    }

    #[test]
    fn the_receipt_lands_in_the_git_dir_and_round_trips() {
        let dir = scratch("roundtrip");
        let repo = Repo::open(dir.to_str().unwrap());

        let written = WriteReceipt::new("commit", vec!["a.txt".to_string()]);
        repo.write_receipt(&written).expect("write the receipt");

        // Inside the git dir, so it is per-worktree and never committed —
        // asserted on the resolved path rather than on a string we built.
        let path = repo.write_receipt_file().expect("resolve the receipt path");
        assert!(
            path.replace('\\', "/").contains("/glimpse/last-write.json"),
            "{path}"
        );
        assert!(Path::new(&path).exists());

        let text = std::fs::read_to_string(&path).unwrap();
        let read: WriteReceipt = serde_json::from_str(&text).expect("parse the receipt");
        assert_eq!(read, written, "what the GUI reads is what the CLI wrote");
        assert!(read.at > 0, "a usable timestamp");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_second_write_replaces_the_first_rather_than_appending() {
        let dir = scratch("replace");
        let repo = Repo::open(dir.to_str().unwrap());

        repo.write_receipt(&WriteReceipt::new("stage", vec!["a.txt".to_string()]))
            .unwrap();
        repo.write_receipt(&WriteReceipt::new("discard", vec!["b.txt".to_string()]))
            .unwrap();

        let path = repo.write_receipt_file().unwrap();
        let read: WriteReceipt =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(read.action, "discard", "the latest write wins");
        assert_eq!(read.paths, vec!["b.txt".to_string()]);

        // The atomic-write temp file is not left behind for a watcher to trip on.
        assert!(!Path::new(&format!("{path}.tmp")).exists());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn writing_a_receipt_reports_failure_rather_than_pretending() {
        // The CLI treats a failed receipt as unimportant, but it can only make
        // that choice if the engine tells it the truth. A file where the
        // directory belongs makes the write genuinely impossible.
        let dir = scratch("unwritable");
        let repo = Repo::open(dir.to_str().unwrap());
        let path = repo.write_receipt_file().unwrap();
        let parent = Path::new(&path).parent().unwrap().to_path_buf();
        std::fs::write(&parent, "not a directory").unwrap();

        let err = repo
            .write_receipt(&WriteReceipt::new("stage", vec![]))
            .expect_err("an impossible write is an error");
        assert!(!err.is_empty(), "the failure is named: {err:?}");

        let _ = std::fs::remove_dir_all(&dir);
    }
}
