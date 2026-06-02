mod git;
mod platform;

use std::collections::HashMap;
use std::env;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use notify_debouncer_mini::notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_mini::{new_debouncer, DebounceEventResult, Debouncer};
use tauri::{AppHandle, Emitter, State};

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

#[tauri::command]
async fn git_log(path: String, limit: Option<u32>) -> Result<Vec<git::Commit>, String> {
    git::Repo::open(&path).log(limit.unwrap_or(100))
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
async fn pull(locks: State<'_, RepoLocks>, path: String, rebase: bool) -> Result<String, String> {
    locked(&locks, &path, || git::Repo::open(&path).pull(rebase))
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
fn updater_endpoint(channel: &str) -> String {
    if let Some(slug) = channel.strip_prefix("experiment:") {
        return format!(
            "https://github.com/TitusKirch/glimpse/releases/download/experiment-{slug}/latest.json"
        );
    }
    match channel {
        "beta" => {
            "https://github.com/TitusKirch/glimpse/releases/download/beta/latest.json".to_string()
        }
        _ => {
            "https://github.com/TitusKirch/glimpse/releases/latest/download/latest.json".to_string()
        }
    }
}

/// Build an updater pointed at the given channel's manifest. The runtime
/// `endpoints` override is why channel switching needs Rust — the JS `check()`
/// can only read the static config endpoints.
#[cfg(desktop)]
fn channel_updater(
    app: &AppHandle,
    channel: &str,
) -> Result<tauri_plugin_updater::Updater, String> {
    use tauri_plugin_updater::UpdaterExt;
    let url = updater_endpoint(channel)
        .parse::<tauri::Url>()
        .map_err(|e| e.to_string())?;
    let mut builder = app
        .updater_builder()
        .endpoints(vec![url])
        .map_err(|e| e.to_string())?;
    // An experiment is chosen explicitly, so install it regardless of whether
    // its version is "newer" — switching to an experiment is a deliberate
    // (possibly side/down-grade) move, not an automatic update.
    if channel.starts_with("experiment:") {
        builder = builder.version_comparator(|_current, _update| true);
    }
    builder.build().map_err(|e| e.to_string())
}

/// Resolve the update to offer for a channel. The beta channel *graduates* to
/// stable: it prefers a newer beta, but falls back to stable so a beta user
/// moves to the final release once it's out (0.1.0-beta.2 → 0.1.0) instead of
/// being stranded until the next beta. Stable / experiment channels check only
/// themselves.
#[cfg(desktop)]
async fn resolve_update(
    app: &AppHandle,
    channel: &str,
) -> Result<Option<tauri_plugin_updater::Update>, String> {
    let chain: &[&str] = if channel == "beta" {
        &["beta", "stable"]
    } else {
        std::slice::from_ref(&channel)
    };
    for &ch in chain {
        let updater = channel_updater(app, ch)?;
        if let Some(update) = updater.check().await.map_err(|e| e.to_string())? {
            return Ok(Some(update));
        }
    }
    Ok(None)
}

/// Check the given channel for an available update; returns its version string.
#[cfg(desktop)]
#[tauri::command]
async fn check_update(app: AppHandle, channel: String) -> Result<Option<String>, String> {
    Ok(resolve_update(&app, &channel).await?.map(|u| u.version))
}

/// Re-resolve the channel and, if an update exists, download and install it.
#[cfg(desktop)]
#[tauri::command]
async fn install_update(app: AppHandle, channel: String) -> Result<(), String> {
    let Some(update) = resolve_update(&app, &channel).await? else {
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
async fn check_update(_channel: String) -> Result<Option<String>, String> {
    Ok(None)
}

#[cfg(not(desktop))]
#[tauri::command]
async fn install_update(_channel: String) -> Result<(), String> {
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .manage(WatcherState(Mutex::new(None)))
        .manage(RepoLocks::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        // Persists window size/position/maximized state across restarts.
        // Restores on launch (before show) and saves on exit — handled natively.
        .plugin(tauri_plugin_window_state::Builder::default().build())
        // `glimpse://` deep links (see tauri.conf.json plugins.deep-link).
        .plugin(tauri_plugin_deep_link::init());

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
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            default_repo,
            watch_repo,
            repo_info,
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
