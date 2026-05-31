mod git;
mod platform;

use std::env;

/// Current working directory — the frontend uses this as the default repo to open.
#[tauri::command]
async fn default_repo() -> Result<String, String> {
    env::current_dir()
        .map(|p| p.to_string_lossy().to_string())
        .map_err(|e| e.to_string())
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
        .plugin(tauri_plugin_opener::init())
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
