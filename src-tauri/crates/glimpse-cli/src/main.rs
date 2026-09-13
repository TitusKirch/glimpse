//! The standalone `glimpse-cli` binary.
//!
//! No `windows_subsystem` attribute, deliberately: this is a **console**
//! program on every platform, which is the thing the GUI binary can only
//! approximate by attaching to its parent's console after the fact. It links
//! nothing from Tauri, so it builds and runs where no desktop exists at all —
//! a CI runner, an SSH session, a WSL distro.

fn main() {
    std::process::exit(glimpse_cli::run_from_env());
}
