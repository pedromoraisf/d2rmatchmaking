//! The maintainer's standalone Windows OCR check: `ocr-check.exe <folder>` (apps/agent/README.md, "The Party panel check").
//! It reads the five screenshots named in the README in the folder, with the production reader (`WindowsOcr`) and the shared
//! check (`d2rmm_agent::ocr_check`), prints PASS or FAIL per file with why (no character or game name unless `--show-reads`), and exits non-zero when a file
//! fails, is missing, or the en-US Windows OCR language is not installed. An example, never shipped in the installer.
//! `ocr-check --variations <folder>` measures the robustness of the reading instead (`d2rmm_agent::ocr_variations`).
//! Windows only: the engine is the Windows OCR engine.

#[cfg(windows)]
fn main() -> std::process::ExitCode {
    use std::path::Path;
    use std::process::ExitCode;
    use std::sync::Arc;

    use d2rmm_agent::adapters::windows_ocr::{WindowsOcr, comparison_readers};
    use d2rmm_agent::ocr_check::{check_folder, folder_screenshots};

    // `--show-reads` prints the character names and the game name the engine read: local runs only, the CI log is public.
    let mut args: Vec<String> = std::env::args().skip(1).collect();
    if args.iter().any(|arg| arg == "--variations") {
        return variations(&args);
    }
    let show_reads = args.iter().any(|arg| arg == "--show-reads");
    args.retain(|arg| arg != "--show-reads");
    let [folder] = args.as_slice() else {
        eprintln!(
            "usage: ocr-check [--show-reads] <folder>   (the folder holds the five maintainer-*.png screenshots)"
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
    match check_folder(
        Path::new(folder),
        Arc::new(reader),
        comparison_readers(),
        show_reads,
    ) {
        Ok(()) => {
            println!(
                "All {} files PASS.",
                folder_screenshots(Path::new(folder)).len()
            );
            ExitCode::SUCCESS
        }
        Err(failed) => {
            println!(
                "{} of {} files FAIL.",
                failed.len(),
                folder_screenshots(Path::new(folder)).len()
            );
            ExitCode::from(1)
        }
    }
}

/// `ocr-check --variations [--combos N] [--shard i/n] [--summary <file.md>] [--json <file.json>] <folder>`: reads hundreds of in-memory
/// variations of each screenshot with the production reading and reports, per transform family, how many read correctly, were
/// refused and read wrong. It measures: the exit code is 0 whatever the counts. Nothing is written but the two report files
/// (counts and variant ids, no text read); no variation image is kept.
#[cfg(windows)]
fn variations(args: &[String]) -> std::process::ExitCode {
    use std::path::Path;
    use std::process::ExitCode;
    use std::sync::Arc;

    use d2rmm_agent::adapters::windows_ocr::WindowsOcr;
    use d2rmm_agent::ocr_variations::run::{parse_args, run_folder, write_outputs};

    let options = match parse_args(args) {
        Ok(options) => options,
        Err(error) => {
            eprintln!("{error}");
            eprintln!(
                "usage: ocr-check --variations [--combos N] [--shard i/n] [--summary <file.md>] [--json <file.json>] <folder>"
            );
            return ExitCode::from(2);
        }
    };
    let reader = match WindowsOcr::new() {
        Ok(reader) => reader,
        Err(_) => {
            eprintln!(
                "The en-US Windows OCR language is not installed on this PC, so no screenshot can be read."
            );
            return ExitCode::from(1);
        }
    };
    let report = match run_folder(
        Path::new(&options.folder),
        Arc::new(reader),
        options.combos,
        options.shard,
        &mut |line| println!("{line}"),
    ) {
        Ok(report) => report,
        Err(error) => {
            eprintln!("{error}");
            return ExitCode::from(1);
        }
    };
    let all = report.totals(None);
    println!(
        "Totals: {} variations, {} correct, {} refused, {} wrong.",
        all.total(),
        all.correct,
        all.refused,
        all.wrong
    );
    for line in report.log_lines() {
        println!("{line}");
    }
    if let Err(error) = write_outputs(&report, &options) {
        eprintln!("{error}");
        return ExitCode::from(1);
    }
    ExitCode::SUCCESS
}

#[cfg(not(windows))]
fn main() -> std::process::ExitCode {
    eprintln!("The OCR check runs on Windows only: the engine is the Windows OCR engine.");
    std::process::ExitCode::from(1)
}
