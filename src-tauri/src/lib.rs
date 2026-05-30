mod git;
mod platform;

use std::env;

/// Current working directory — the frontend uses this as the default repo to open.
#[tauri::command]
fn default_repo() -> Result<String, String> {
    env::current_dir()
        .map(|p| p.to_string_lossy().to_string())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn repo_info(path: String) -> Result<git::RepoInfo, String> {
    git::repo_info(&path)
}

#[tauri::command]
fn git_log(path: String, limit: Option<u32>) -> Result<Vec<git::Commit>, String> {
    git::git_log(&path, limit.unwrap_or(100))
}

#[tauri::command]
fn git_status(path: String) -> Result<Vec<git::StatusEntry>, String> {
    git::git_status(&path)
}

#[tauri::command]
fn file_diff(path: String, file: String, staged: bool) -> Result<Option<git::DiffData>, String> {
    git::file_diff(&path, &file, staged)
}

#[tauri::command]
fn commit_files(path: String, hash: String) -> Result<Vec<git::CommitFile>, String> {
    git::commit_files(&path, &hash)
}

#[tauri::command]
fn commit_file_diff(
    path: String,
    hash: String,
    file: String,
) -> Result<Option<git::DiffData>, String> {
    git::commit_file_diff(&path, &hash, &file)
}

#[tauri::command]
fn stage(path: String, file: String) -> Result<(), String> {
    git::stage(&path, &file)
}

#[tauri::command]
fn unstage(path: String, file: String) -> Result<(), String> {
    git::unstage(&path, &file)
}

#[tauri::command]
fn commit(path: String, message: String) -> Result<String, String> {
    git::commit(&path, &message)
}

#[tauri::command]
fn discard(path: String, file: String, untracked: bool) -> Result<(), String> {
    git::discard(&path, &file, untracked)
}

#[tauri::command]
fn checkout_branch(path: String, branch: String) -> Result<(), String> {
    git::checkout_branch(&path, &branch)
}

#[tauri::command]
fn create_branch(path: String, name: String) -> Result<(), String> {
    git::create_branch(&path, &name)
}

#[tauri::command]
fn delete_branch(path: String, name: String) -> Result<(), String> {
    git::delete_branch(&path, &name)
}

#[tauri::command]
fn fetch(path: String) -> Result<String, String> {
    git::fetch(&path)
}

#[tauri::command]
fn pull(path: String) -> Result<String, String> {
    git::pull(&path)
}

#[tauri::command]
fn push(path: String) -> Result<String, String> {
    git::push(&path)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
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
