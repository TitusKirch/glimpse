mod git;
mod platform;

use std::env;
use std::path::Path;
use std::sync::Mutex;
use std::time::Duration;

use notify_debouncer_mini::notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_mini::{new_debouncer, DebounceEventResult, Debouncer};
use tauri::{AppHandle, Emitter, State};

/// Holds the active filesystem watcher so it stays alive (dropping it stops
/// watching). Only the most recently watched repo is tracked.
struct WatcherState(Mutex<Option<Debouncer<RecommendedWatcher>>>);

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
) -> Result<Option<git::DiffData>, String> {
    git::Repo::open(&path).file_diff(&file, staged)
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
) -> Result<Option<git::DiffData>, String> {
    git::Repo::open(&path).commit_file_diff(&hash, &file)
}

#[tauri::command]
async fn stage(path: String, file: String) -> Result<(), String> {
    git::Repo::open(&path).stage(&file)
}

#[tauri::command]
async fn unstage(path: String, file: String) -> Result<(), String> {
    git::Repo::open(&path).unstage(&file)
}

#[tauri::command]
async fn commit(path: String, message: String) -> Result<String, String> {
    git::Repo::open(&path).commit(&message)
}

#[tauri::command]
async fn discard(path: String, file: String, untracked: bool) -> Result<(), String> {
    git::Repo::open(&path).discard(&file, untracked)
}

#[tauri::command]
async fn checkout_branch(path: String, branch: String) -> Result<(), String> {
    git::Repo::open(&path).checkout_branch(&branch)
}

#[tauri::command]
async fn create_branch(path: String, name: String) -> Result<(), String> {
    git::Repo::open(&path).create_branch(&name)
}

#[tauri::command]
async fn delete_branch(path: String, name: String) -> Result<(), String> {
    git::Repo::open(&path).delete_branch(&name)
}

#[tauri::command]
async fn fetch(path: String) -> Result<String, String> {
    git::Repo::open(&path).fetch()
}

#[tauri::command]
async fn pull(path: String) -> Result<String, String> {
    git::Repo::open(&path).pull()
}

#[tauri::command]
async fn push(path: String) -> Result<String, String> {
    git::Repo::open(&path).push()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(WatcherState(Mutex::new(None)))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        // Persists window size/position/maximized state across restarts.
        // Restores on launch (before show) and saves on exit — handled natively.
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
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
            stage,
            unstage,
            commit,
            discard,
            checkout_branch,
            create_branch,
            delete_branch,
            fetch,
            pull,
            push
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
