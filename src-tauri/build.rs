fn main() {
    // The experiment release workflow bakes the experiment slug into the binary
    // via this env var (read with option_env! in lib.rs). Without this line cargo
    // wouldn't rebuild when only the env changes, so the baked name could go stale.
    println!("cargo:rerun-if-env-changed=GLIMPSE_EXPERIMENT");
    tauri_build::build()
}
