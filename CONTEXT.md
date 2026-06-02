# CONTEXT

Domain vocabulary for `glimpse` — the nouns and verbs the code is named after.
Keep these terms exact in code, comments, and discussion so a reader (human or
agent) can map a name to its concept without re-deriving it. This file is the
domain glossary; the architecture vocabulary (module, interface, seam, depth,
leverage, locality) lives in the review tooling, not here.

## Terms

**RepoState**
Everything one open repository shows in a tab: its identity (`id`, `name`,
`path`, `flavor`, `distro`) plus its whole view — branches, remote branches,
current branch, remotes, tags, stashes, commits, working-tree status, and the
current selection/diff. The repo store keeps these keyed by `id` with an
`activeId`; projection getters expose the active one so switching tabs swaps the
entire graph + diff.

**selection**
What the diff panel is showing for the active repo: either a **commit** is
selected (its body + changed files) or a working-tree **file** is selected
(staged or unstaged). The two are mutually exclusive. Today the panels read the
underlying fields (`selectedHash`, `selectedBody`, `selectedFile`,
`selectedFileStaged`, `commitFiles`) directly — flat projections, because most
readers want one field (which commit row is highlighted, which file to blame),
not the whole pair.

**native**
The single Native/Browser gate for repo-store effects. A store action wraps its
body in `native(fn)`: inside the Tauri desktop shell it runs `fn`; in the
browser demo it is a no-op so the mock data stays put and no git dialog appears.
The `isTauri()` check lives here once instead of being restated at each action.

**mutate**
The repo store's shared mutating-action shape: go through `native` (skip outside
the desktop shell), run the git call under `guarded` (busy flag + error
surfacing), then refresh the view — `reload` (re-read the whole repo), `status`
(working tree + current diff), or `none` (the action updates the view itself).

**GitTarget / resolve**
How `git` is reached for a repository, decided once per repo by
`platform::resolve()`: native git by default, or — on Windows only, for a
`\\wsl$` / `\\wsl.localhost` path — the distro's git via
`wsl.exe -d <distro> --cd <linux-path> --exec git`. A `Repo` holds one resolved
`GitTarget`, so the platform seam is touched in exactly one place.

**ResetMode**
The `git reset` variant: `soft`, `mixed`, or `hard`. A serde enum on the Rust
side, deserialized from the frontend's `'soft' | 'mixed' | 'hard'` union, so an
unknown value is rejected at the IPC seam instead of silently falling back to
`--mixed`.

**diffLang**
Maps a file name's extension to a highlight.js language id (or `''` when the
extension is unknown or that grammar isn't loaded), gated by `hljs.getLanguage`.
The single source of truth for syntax highlighting across both the diff and
blame views (`app/utils/highlight.ts`); `parseDiff` consumes it rather than
keeping its own copy.

**recent list / moveToFront**
A persisted, most-recent-first, de-duplicated, capped list — used for recently
opened repositories and recently used command-palette actions. The mechanics
(move/insert to front, dedup by a stable key, trim to `max`) live once in the
pure `moveToFront` core (`app/utils/recency.ts`); each store supplies the key and
the cap (owned by the layout store, under Settings → General → Recent).
