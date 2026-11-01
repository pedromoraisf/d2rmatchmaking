//! `cargo run -p xtask -- contracts` regenerates `core/src/contracts/generated.rs`;
//! `cargo run -p xtask -- draw-fixture` writes the F0 reference image of the game name (AD-047).

use std::error::Error;
use std::fs;
use std::process::ExitCode;

use xtask::fixture::{fixture_path, render_png};
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

fn draw_fixture() -> Result<(), Box<dyn Error>> {
    let path = fixture_path();
    fs::write(&path, render_png()?)?;
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
        Some("draw-fixture") => match draw_fixture() {
            Ok(()) => ExitCode::SUCCESS,
            Err(error) => {
                eprintln!("xtask draw-fixture: {error}");
                ExitCode::FAILURE
            }
        },
        _ => {
            eprintln!("usage: cargo run -p xtask -- contracts | draw-fixture");
            ExitCode::from(2)
        }
    }
}
