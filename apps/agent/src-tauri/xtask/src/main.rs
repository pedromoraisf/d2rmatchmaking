//! `cargo run -p xtask -- contracts` regenerates `core/src/contracts/generated.rs`.

use std::error::Error;
use std::fs;
use std::process::ExitCode;

use xtask::{generate, generated_path, schema_dir};

fn contracts() -> Result<(), Box<dyn Error>> {
    let source = generate(&schema_dir())?;
    let path = generated_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(&path, source)?;
    println!("wrote {}", path.display());
    Ok(())
}

fn main() -> ExitCode {
    match std::env::args().nth(1).as_deref() {
        Some("contracts") => match contracts() {
            Ok(()) => ExitCode::SUCCESS,
            Err(error) => {
                eprintln!("xtask contracts: {error}");
                ExitCode::FAILURE
            }
        },
        _ => {
            eprintln!("usage: cargo run -p xtask -- contracts");
            ExitCode::from(2)
        }
    }
}
