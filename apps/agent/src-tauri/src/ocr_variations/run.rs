//! Runs the variations: for each screenshot, each variation is made in memory, read with the production reading and
//! classified, then dropped. Nothing is written to disk and nothing printed names a character or a game name. The readings
//! run one after another: the Windows OCR engine's thread safety is not something the check relies on.
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Instant;

use d2rmm_agent_core::ports::{Rgba, TextReader};
use d2rmm_agent_core::screen_reader::ScreenReader;
use d2rmm_agent_domain::language::LanguagePack;

use super::catalogue::{DEFAULT_COMBOS, Variation, catalogue};
use super::outcome::classify_image_detailed;
use super::report::{Report, VariantResult};
use crate::ocr_check::{SCREENSHOTS, read_screenshot};

/// The seed of the catalogue: fixed, so every run reads the same variations.
pub const SEED: u64 = 20_261_118;

/// What `ocr-check --variations` was asked to do.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Options {
    pub combos: usize,
    pub summary: Option<PathBuf>,
    pub json: Option<PathBuf>,
    pub folder: PathBuf,
}

/// Reads the arguments after the program name: `--variations [--combos N] [--summary <file>] [--json <file>] <folder>`.
pub fn parse_args(args: &[String]) -> Result<Options, String> {
    let mut combos = DEFAULT_COMBOS;
    let mut summary = None;
    let mut json = None;
    let mut folder = None;
    let mut iter = args.iter();
    while let Some(arg) = iter.next() {
        match arg.as_str() {
            "--variations" => {}
            "--combos" => {
                let value = iter.next().ok_or("--combos needs a number")?;
                combos = value
                    .parse()
                    .map_err(|_| format!("--combos {value:?} is not a number"))?;
            }
            "--summary" => {
                summary = Some(PathBuf::from(iter.next().ok_or("--summary needs a file")?));
            }
            "--json" => {
                json = Some(PathBuf::from(iter.next().ok_or("--json needs a file")?));
            }
            flag if flag.starts_with("--") => return Err(format!("unknown option {flag}")),
            other => {
                if folder.replace(PathBuf::from(other)).is_some() {
                    return Err("only one folder is read".to_string());
                }
            }
        }
    }
    Ok(Options {
        combos,
        summary,
        json,
        folder: folder.ok_or("the folder with the five screenshots is missing")?,
    })
}

/// Reads every variation of every image with `reader` and classifies it. `progress` receives each line the run prints (one
/// per screenshot and family, then the time), so the caller decides where it goes. An image is named by its file name.
pub fn run_images(
    images: &[(String, Rgba)],
    reader: Arc<dyn TextReader + Send + Sync>,
    variations: &[Variation],
    seed: u64,
    combos: usize,
    progress: &mut dyn FnMut(&str),
) -> Report {
    let screens = ScreenReader::new(Arc::clone(&reader), Arc::new(LanguagePack::english()));
    let mut report = Report {
        seed,
        combos,
        ..Report::default()
    };
    for (name, image) in images {
        let started = Instant::now();
        let first = report.results.len();
        for variation in variations {
            let varied = variation.apply(image);
            let (verdict, field_variants) =
                classify_image_detailed(name, &*reader, &screens, &varied);
            drop(varied);
            report.results.push(VariantResult {
                screenshot: name.clone(),
                id: variation.id.clone(),
                family: variation.family,
                verdict,
                field_variants,
            });
        }
        let seconds = started.elapsed().as_secs_f64();
        report.elapsed.push((name.clone(), seconds));
        // The lines of this screenshot alone: a report of just its results.
        let this = Report {
            results: report.results[first..].to_vec(),
            ..Report::default()
        };
        for line in this.family_lines(name) {
            progress(&line);
        }
        let all = this.totals(None);
        progress(&format!(
            "  {name}: {} variations, {} correct, {} refused, {} wrong, {seconds:.1} s",
            all.total(),
            all.correct,
            all.refused,
            all.wrong
        ));
    }
    report
}

/// Reads the five screenshots of `dir`, decodes each once and runs the catalogue over it. A screenshot that is missing or
/// does not decode is named in the log and skipped. Returns the report; the caller writes the summary and the JSON.
pub fn run_folder(
    dir: &Path,
    reader: Arc<dyn TextReader + Send + Sync>,
    combos: usize,
    progress: &mut dyn FnMut(&str),
) -> Result<Report, String> {
    if !dir.is_dir() {
        return Err(format!("{} is not a folder", dir.display()));
    }
    let mut images = Vec::new();
    for name in SCREENSHOTS {
        let path = dir.join(name);
        match read_screenshot(&path) {
            Ok(image) => images.push((name.to_string(), image)),
            Err(error) => progress(&format!("  {name}: skipped, {error}")),
        }
    }
    let variations = catalogue(SEED, combos);
    progress(&format!(
        "  {} variations per screenshot, seed {SEED}",
        variations.len()
    ));
    Ok(run_images(
        &images,
        reader,
        &variations,
        SEED,
        combos,
        progress,
    ))
}

/// Writes the markdown summary and the JSON the options ask for. Only counts, family names and variant ids go in them.
pub fn write_outputs(report: &Report, options: &Options) -> Result<(), String> {
    if let Some(path) = &options.summary {
        std::fs::write(path, report.markdown())
            .map_err(|error| format!("cannot write {}: {error}", path.display()))?;
    }
    if let Some(path) = &options.json {
        let text = serde_json::to_string_pretty(&report.json())
            .map_err(|error| format!("cannot encode the JSON: {error}"))?;
        std::fs::write(path, text)
            .map_err(|error| format!("cannot write {}: {error}", path.display()))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use d2rmm_agent_core::ports::ReadError;
    use d2rmm_agent_domain::vision::{ReadText, Region, TextLine};

    use super::*;
    use crate::ocr_variations::outcome::Outcome;
    use crate::ocr_variations::transforms::Transform;

    fn strings(args: &[&str]) -> Vec<String> {
        args.iter().map(|arg| arg.to_string()).collect()
    }

    #[test]
    fn the_arguments_default_and_override() {
        let options = parse_args(&strings(&["--variations", "folder"])).unwrap();
        assert_eq!(
            options,
            Options {
                combos: DEFAULT_COMBOS,
                summary: None,
                json: None,
                folder: PathBuf::from("folder"),
            }
        );
        let options = parse_args(&strings(&[
            "--variations",
            "--combos",
            "7",
            "--summary",
            "s.md",
            "--json",
            "j.json",
            "dir",
        ]))
        .unwrap();
        assert_eq!(options.combos, 7);
        assert_eq!(options.summary, Some(PathBuf::from("s.md")));
        assert_eq!(options.json, Some(PathBuf::from("j.json")));
        assert_eq!(options.folder, PathBuf::from("dir"));
    }

    #[test]
    fn bad_arguments_say_why() {
        for (args, wanted) in [
            (vec!["--variations"], "folder"),
            (vec!["--variations", "--combos"], "needs a number"),
            (vec!["--variations", "--combos", "x", "d"], "not a number"),
            (vec!["--variations", "--summary"], "needs a file"),
            (vec!["--variations", "--json"], "needs a file"),
            (vec!["--variations", "--nope", "d"], "unknown option"),
            (vec!["--variations", "a", "b"], "only one folder"),
        ] {
            let error = parse_args(&strings(&args)).unwrap_err();
            assert!(error.contains(wanted), "{args:?}: {error}");
        }
    }

    /// Reads a Party panel whose title and label are there and whose field shows nothing: the masked value.
    struct MaskedPartyReader;

    impl TextReader for MaskedPartyReader {
        fn read(&self, _image: &Rgba, _region: Region) -> Result<ReadText, ReadError> {
            Ok(ReadText {
                text: String::new(),
                confidence: 0.0,
            })
        }

        fn read_lines(&self, _image: &Rgba, area: Region) -> Vec<TextLine> {
            [("PARTY", 153), ("GAME NAME", 192)]
                .into_iter()
                .filter(|(_, middle)| area.y <= *middle && *middle < area.bottom())
                .map(|(text, middle)| TextLine {
                    text: text.to_string(),
                    region: Region {
                        x: 280,
                        y: middle - 8,
                        width: 200,
                        height: 16,
                    },
                })
                .collect()
        }
    }

    fn frame() -> Rgba {
        Rgba {
            width: 1920,
            height: 1080,
            pixels: vec![0; 1920 * 1080 * 4],
        }
    }

    fn variation(id: &str, transforms: Vec<Transform>) -> Variation {
        Variation {
            id: id.to_string(),
            family: "shift",
            transforms,
        }
    }

    #[test]
    fn a_fake_reader_gives_counts_per_screenshot_and_logs_no_text() {
        let images = vec![
            ("maintainer-party-masked.png".to_string(), frame()),
            ("maintainer-party-revealed.png".to_string(), frame()),
            ("maintainer-select-screen.png".to_string(), frame()),
        ];
        let variations = vec![
            variation("identity", vec![]),
            variation("shift-right-1", vec![Transform::Shift { dx: 1, dy: 0 }]),
            // 4:3 is outside 16:10..2:1: refused whatever the screenshot.
            variation("aspect-4x3", vec![Transform::CropAspect { w: 4, h: 3 }]),
        ];
        let mut lines = Vec::new();
        let report = run_images(
            &images,
            Arc::new(MaskedPartyReader),
            &variations,
            3,
            0,
            &mut |line| lines.push(line.to_string()),
        );
        assert_eq!(report.results.len(), 9);
        // The masked frame reads masked: correct twice, the 4:3 crop refused.
        let masked = "maintainer-party-masked.png";
        assert_eq!(report.totals(Some(masked)).correct, 2);
        assert_eq!(report.totals(Some(masked)).refused, 1);
        // The revealed frame also reads masked: the agent only asks to reveal the name and posts nothing, so all three are
        // refused, none wrong.
        let revealed = "maintainer-party-revealed.png";
        assert_eq!(report.totals(Some(revealed)).refused, 3);
        assert_eq!(report.totals(Some(revealed)).wrong, 0);
        assert!(report.wrong_ids().is_empty());
        // The selection screen reads no card: refused.
        assert_eq!(
            report.totals(Some("maintainer-select-screen.png")).refused,
            3
        );
        assert!(
            report
                .results
                .iter()
                .all(|r| { r.verdict.outcome != Outcome::Correct || r.screenshot == masked })
        );
        assert_eq!(report.elapsed.len(), 3);
        assert_eq!(
            lines.len(),
            3 * 2,
            "a family line and a total line per screenshot: {lines:?}"
        );
        assert!(
            lines
                .iter()
                .any(|line| line.contains("party-masked shift: 2 correct, 1 refused, 0 wrong"))
        );
        assert_eq!(report.seed, 3);
    }

    #[test]
    fn the_outputs_are_written_where_asked() {
        let dir = std::env::temp_dir().join(format!("d2rmm-variations-out-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let options = Options {
            combos: 0,
            summary: Some(dir.join("s.md")),
            json: Some(dir.join("j.json")),
            folder: dir.clone(),
        };
        let report = Report::default();
        write_outputs(&report, &options).unwrap();
        assert!(
            std::fs::read_to_string(dir.join("s.md"))
                .unwrap()
                .starts_with("## OCR variations")
        );
        let json: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(dir.join("j.json")).unwrap()).unwrap();
        assert_eq!(json["totals"]["wrong"], 0);
        let missing = Options {
            summary: Some(dir.join("no-such-dir").join("s.md")),
            json: None,
            ..options
        };
        assert!(
            write_outputs(&report, &missing)
                .unwrap_err()
                .contains("cannot write")
        );
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_folder_that_is_not_one_is_an_error_and_missing_files_are_skipped() {
        let mut lines = Vec::new();
        let reader: Arc<dyn TextReader + Send + Sync> = Arc::new(MaskedPartyReader);
        let missing = std::env::temp_dir().join("d2rmm-no-such-variations-folder");
        let error = run_folder(&missing, Arc::clone(&reader), 0, &mut |l| {
            lines.push(l.to_string())
        })
        .unwrap_err();
        assert!(error.contains("is not a folder"), "{error}");
        let empty =
            std::env::temp_dir().join(format!("d2rmm-variations-empty-{}", std::process::id()));
        std::fs::create_dir_all(&empty).unwrap();
        let report = run_folder(&empty, reader, 0, &mut |l| lines.push(l.to_string())).unwrap();
        std::fs::remove_dir(&empty).unwrap();
        assert!(report.results.is_empty());
        assert_eq!(
            lines.iter().filter(|line| line.contains("skipped")).count(),
            SCREENSHOTS.len()
        );
    }
}
