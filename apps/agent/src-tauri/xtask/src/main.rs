//! `cargo run -p xtask -- contracts` regenerates `adapters/src/contracts/generated.rs`;
//! `cargo run -p xtask -- draw-fixture` writes the F0 reference image of the game name (AD-047).

use std::error::Error;
use std::fs;
use std::process::ExitCode;

use xtask::fixture::{draw_party_fixtures, fixture_path, render_png};
use xtask::{generate, generate_schema_module, generated_path, schema_dir, schema_module_path};

fn contracts() -> Result<(), Box<dyn Error>> {
    let source = generate(&schema_dir())?;
    let path = generated_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(&path, source)?;
    println!("wrote {}", path.display());
    let module = generate_schema_module(&schema_dir())?;
    fs::write(schema_module_path(), module)?;
    println!("wrote {}", schema_module_path().display());
    Ok(())
}

fn draw_fixture() -> Result<(), Box<dyn Error>> {
    let path = fixture_path();
    fs::write(&path, render_png()?)?;
    println!("wrote {}", path.display());
    Ok(())
}

fn draw_party() -> Result<(), Box<dyn Error>> {
    for path in draw_party_fixtures()? {
        println!("wrote {}", path.display());
    }
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
        Some("draw-fixture") => match std::env::args().nth(2).as_deref() {
            None => match draw_fixture() {
                Ok(()) => ExitCode::SUCCESS,
                Err(error) => {
                    eprintln!("xtask draw-fixture: {error}");
                    ExitCode::FAILURE
                }
            },
            Some("party") => match draw_party() {
                Ok(()) => ExitCode::SUCCESS,
                Err(error) => {
                    eprintln!("xtask draw-fixture party: {error}");
                    ExitCode::FAILURE
                }
            },
            Some(_) => {
                eprintln!("usage: cargo run -p xtask -- draw-fixture [party]");
                ExitCode::from(2)
            }
        },
        _ => {
            eprintln!("usage: cargo run -p xtask -- contracts | draw-fixture [party]");
            ExitCode::from(2)
        }
    }
}
