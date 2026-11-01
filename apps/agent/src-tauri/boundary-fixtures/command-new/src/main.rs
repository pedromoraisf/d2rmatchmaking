//! Boundary fixture: std::process::Command is disallowed in the agent. Never run.
use std::process::Command;

fn main() {
    let _ = Command::new("cmd");
}
