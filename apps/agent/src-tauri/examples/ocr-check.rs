//! The maintainer's standalone Windows OCR check: `ocr-check.exe <folder>` (apps/agent/README.md, "The Party panel check").
//! It reads the five screenshots named in the README in the folder, with the production reader (`WindowsOcr`) and the shared
//! check (`d2rmm_agent::ocr_check`), prints PASS or FAIL per file with what the engine read, and exits non-zero when a file
//! fails, is missing, or the en-US Windows OCR language is not installed. An example, never shipped in the installer.
//! Windows only: the engine is the Windows OCR engine.

#[cfg(windows)]
fn main() -> std::process::ExitCode {
    use std::path::Path;
    use std::process::ExitCode;
    use std::sync::Arc;

    use d2rmm_agent::adapters::windows_ocr::WindowsOcr;
    use d2rmm_agent::ocr_check::{SCREENSHOTS, check_folder};

    let args: Vec<String> = std::env::args().skip(1).collect();
    let [folder] = args.as_slice() else {
        eprintln!(
            "usage: ocr-check <folder>   (the folder holds the five maintainer-*.png screenshots)"
        );
        return ExitCode::from(2);
    };
    let reader = match WindowsOcr::new() {
        Ok(reader) => reader,
        Err(_) => {
            eprintln!(
                "The en-US Windows OCR language is not installed on this PC, so no screenshot can be read.\n\
                 Install it: Settings > Time & language > Language & region > Add a language > English (United States),\n\
                 then add its optical character recognition feature (Language options). Then run ocr-check again."
            );
            return ExitCode::from(1);
        }
    };
    match check_folder(Path::new(folder), Arc::new(reader)) {
        Ok(()) => {
            println!("All {} files PASS.", SCREENSHOTS.len());
            ExitCode::SUCCESS
        }
        Err(failed) => {
            println!("{} of {} files FAIL.", failed.len(), SCREENSHOTS.len());
            ExitCode::from(1)
        }
    }
}

#[cfg(not(windows))]
fn main() -> std::process::ExitCode {
    eprintln!("The OCR check runs on Windows only: the engine is the Windows OCR engine.");
    std::process::ExitCode::from(1)
}
