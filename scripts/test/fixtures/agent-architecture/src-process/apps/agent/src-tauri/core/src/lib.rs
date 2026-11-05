// Fixture: a core crate root that forbids unsafe code but starts a process.
#![forbid(unsafe_code)]

use std::process::Command;

pub fn start_game() -> Command {
    Command::new("D2R.exe")
}
