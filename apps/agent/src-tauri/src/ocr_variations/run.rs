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
#[cfg(test)]
use crate::ocr_check::SCREENSHOTS;
use crate::ocr_check::{folder_screenshots, read_screenshot};

/// The seed of the catalogue: fixed, so every run reads the same variations.
pub const SEED: u64 = 20_261_118;

/// What `ocr-check --variations` was asked to do.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Options {
    pub combos: usize,
    pub summary: Option<PathBuf>,
    pub json: Option<PathBuf>,
    /// `--shard i/n` (1-based): read only this shard's prints of the folder, so n jobs can split the run.
    pub shard: Option<Shard>,
    pub folder: PathBuf,
}

/// Shard `index` (1-based) of `count`: it reads the prints whose position in the sorted folder list is `index - 1` modulo
/// `count`, so every print belongs to exactly one shard whatever the number of prints.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Shard {
    pub index: usize,
    pub count: usize,
}

impl Shard {
    /// Reads `i/n` with `1 <= i <= n`.
    pub fn parse(text: &str) -> Result<Shard, String> {
        let bad = || format!("--shard {text:?} is not i/n with 1 <= i <= n");
        let (index, count) = text.split_once('/').ok_or_else(bad)?;
        let index: usize = index.parse().map_err(|_| bad())?;
        let count: usize = count.parse().map_err(|_| bad())?;
        if index == 0 || index > count {
            return Err(bad());
        }
        Ok(Shard { index, count })
    }

    /// The names of this shard, in their order in `names`.
    pub fn select(&self, names: &[String]) -> Vec<String> {
        names
            .iter()
            .enumerate()
            .filter(|(position, _)| position % self.count == self.index - 1)
            .map(|(_, name)| name.clone())
            .collect()
    }
}

/// The `shard` entry of the JSON of a sharded run: which shard it is, every print the folder holds and the ones this shard
/// read, so the merge can prove that the shards together read each print exactly once.
pub fn shard_json(shard: Shard, folder_prints: &[String]) -> serde_json::Value {
    serde_json::json!({
        "index": shard.index,
        "count": shard.count,
        "folder_prints": folder_prints,
        "assigned": shard.select(folder_prints),
    })
}

/// Reads the arguments after the program name: `--variations [--combos N] [--shard i/n] [--summary <file>] [--json <file>] <folder>`.
pub fn parse_args(args: &[String]) -> Result<Options, String> {
    let mut combos = DEFAULT_COMBOS;
    let mut summary = None;
    let mut json = None;
    let mut folder = None;
    let mut shard = None;
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
            "--shard" => {
                shard = Some(Shard::parse(iter.next().ok_or("--shard needs i/n")?)?);
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
        shard,
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

/// The prints a run reads: all of the folder's, or the shard's share of the ones that are there. The share is taken over the
/// files present (sorted), so the shards partition them even when a known name is missing.
fn shard_names(dir: &Path, shard: Option<Shard>) -> Vec<String> {
    let all = folder_screenshots(dir);
    match shard {
        None => all,
        Some(shard) => shard.select(&present_prints(dir)),
    }
}

/// The prints of the folder that exist as files, in the order `folder_screenshots` lists them.
pub fn present_prints(dir: &Path) -> Vec<String> {
    folder_screenshots(dir)
        .into_iter()
        .filter(|name| dir.join(name).is_file())
        .collect()
}

/// Reads the five screenshots of `dir`, decodes each once and runs the catalogue over it. A screenshot that is missing or
/// does not decode is named in the log and skipped. Returns the report; the caller writes the summary and the JSON.
pub fn run_folder(
    dir: &Path,
    reader: Arc<dyn TextReader + Send + Sync>,
    combos: usize,
    shard: Option<Shard>,
    progress: &mut dyn FnMut(&str),
) -> Result<Report, String> {
    if !dir.is_dir() {
        return Err(format!("{} is not a folder", dir.display()));
    }
    let mut images = Vec::new();
    for name in shard_names(dir, shard) {
        let path = dir.join(&name);
        match read_screenshot(&path) {
            Ok(image) => images.push((name, image)),
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
        let mut value = report.json();
        if let Some(shard) = options.shard {
            value["shard"] = shard_json(shard, &present_prints(&options.folder));
        }
        let text = serde_json::to_string_pretty(&value)
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
                shard: None,
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
            "--shard",
            "2/5",
            "dir",
        ]))
        .unwrap();
        assert_eq!(options.combos, 7);
        assert_eq!(options.summary, Some(PathBuf::from("s.md")));
        assert_eq!(options.json, Some(PathBuf::from("j.json")));
        assert_eq!(options.folder, PathBuf::from("dir"));
        assert_eq!(options.shard, Some(Shard { index: 2, count: 5 }));
    }

    fn names(count: usize) -> Vec<String> {
        (0..count).map(|n| format!("print-{n:02}.png")).collect()
    }

    #[test]
    fn a_shard_is_i_over_n_with_i_in_one_to_n() {
        assert_eq!(Shard::parse("1/1").unwrap(), Shard { index: 1, count: 1 });
        assert_eq!(Shard::parse("8/8").unwrap(), Shard { index: 8, count: 8 });
        for bad in ["0/3", "4/3", "1", "a/3", "1/b", "1/0", "", "1/2/3", "-1/3"] {
            let error = Shard::parse(bad).unwrap_err();
            assert!(error.contains("is not i/n"), "{bad}: {error}");
        }
    }

    #[test]
    fn the_shards_split_the_sorted_list_round_robin_and_cover_it_once() {
        let all = names(19);
        let pick = |index| Shard { index, count: 8 }.select(&all);
        assert_eq!(
            pick(1),
            vec!["print-00.png", "print-08.png", "print-16.png"]
        );
        assert_eq!(
            pick(3),
            vec!["print-02.png", "print-10.png", "print-18.png"]
        );
        assert_eq!(pick(4), vec!["print-03.png", "print-11.png"]);
        assert_eq!(pick(8), vec!["print-07.png", "print-15.png"]);
        let mut joined: Vec<String> = (1..=8).flat_map(pick).collect();
        joined.sort();
        assert_eq!(joined, all);
        // One shard of one is the whole list; more shards than prints leaves the last ones empty.
        assert_eq!(Shard { index: 1, count: 1 }.select(&all), all);
        let few = names(2);
        assert!(Shard { index: 3, count: 4 }.select(&few).is_empty());
        assert_eq!(
            Shard { index: 2, count: 4 }.select(&few),
            vec!["print-01.png"]
        );
    }

    #[test]
    fn the_shard_entry_of_the_json_names_the_folder_and_the_share() {
        let all = names(5);
        let value = shard_json(Shard { index: 2, count: 3 }, &all);
        assert_eq!(value["index"], 2);
        assert_eq!(value["count"], 3);
        assert_eq!(value["folder_prints"], serde_json::json!(all));
        assert_eq!(
            value["assigned"],
            serde_json::json!(["print-01.png", "print-04.png"])
        );
    }

    #[test]
    fn bad_arguments_say_why() {
        for (args, wanted) in [
            (vec!["--variations"], "folder"),
            (vec!["--variations", "--combos"], "needs a number"),
            (vec!["--variations", "--combos", "x", "d"], "not a number"),
            (vec!["--variations", "--summary"], "needs a file"),
            (vec!["--variations", "--json"], "needs a file"),
            (vec!["--variations", "--shard"], "needs i/n"),
            (vec!["--variations", "--shard", "0/2", "d"], "is not i/n"),
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
        // The log lines carry fixed vocabulary only: no text a reader returned.
        let log = report.log_lines().join("\n");
        assert!(log.contains("Supported totals: 6 variations"), "{log}");
        assert!(
            !log.contains("PARTY") && !log.contains("GAME NAME"),
            "{log}"
        );
    }

    #[test]
    fn the_outputs_are_written_where_asked() {
        let dir = std::env::temp_dir().join(format!("d2rmm-variations-out-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let options = Options {
            combos: 0,
            summary: Some(dir.join("s.md")),
            json: Some(dir.join("j.json")),
            shard: None,
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
        assert!(
            json.get("shard").is_none(),
            "an unsharded run has no shard entry"
        );
        let sharded = Options {
            shard: Some(Shard { index: 1, count: 2 }),
            ..options.clone()
        };
        write_outputs(&report, &sharded).unwrap();
        let json: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(dir.join("j.json")).unwrap()).unwrap();
        assert_eq!(json["shard"]["index"], 1);
        assert_eq!(json["shard"]["count"], 2);
        assert_eq!(json["shard"]["folder_prints"], serde_json::json!([]));
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
    fn a_shard_takes_its_share_of_the_files_that_are_there() {
        let dir =
            std::env::temp_dir().join(format!("d2rmm-variations-shard-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        // Only the 1st, 3rd and 4th known prints exist: the missing ones take no place in the split.
        for index in [0, 2, 3] {
            std::fs::write(dir.join(SCREENSHOTS[index]), b"x").unwrap();
        }
        let present = present_prints(&dir);
        assert_eq!(
            present,
            vec![SCREENSHOTS[0], SCREENSHOTS[2], SCREENSHOTS[3]]
        );
        let first = shard_names(&dir, Some(Shard { index: 1, count: 2 }));
        let second = shard_names(&dir, Some(Shard { index: 2, count: 2 }));
        assert_eq!(first, vec![SCREENSHOTS[0], SCREENSHOTS[3]]);
        assert_eq!(second, vec![SCREENSHOTS[2]]);
        assert_eq!(shard_names(&dir, None).len(), SCREENSHOTS.len());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_folder_that_is_not_one_is_an_error_and_missing_files_are_skipped() {
        let mut lines = Vec::new();
        let reader: Arc<dyn TextReader + Send + Sync> = Arc::new(MaskedPartyReader);
        let missing = std::env::temp_dir().join("d2rmm-no-such-variations-folder");
        let error = run_folder(&missing, Arc::clone(&reader), 0, None, &mut |l| {
            lines.push(l.to_string())
        })
        .unwrap_err();
        assert!(error.contains("is not a folder"), "{error}");
        let empty =
            std::env::temp_dir().join(format!("d2rmm-variations-empty-{}", std::process::id()));
        std::fs::create_dir_all(&empty).unwrap();
        let report =
            run_folder(&empty, reader, 0, None, &mut |l| lines.push(l.to_string())).unwrap();
        std::fs::remove_dir(&empty).unwrap();
        assert!(report.results.is_empty());
        assert_eq!(
            lines.iter().filter(|line| line.contains("skipped")).count(),
            SCREENSHOTS.len()
        );
    }
}
