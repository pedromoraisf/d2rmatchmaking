//! What a run of the variations reports: counts per transform family and screenshot, the list of variants that read Wrong,
//! a markdown table for the job summary and a JSON file for the artifact. Variant ids, families, screenshot file names and
//! outcome classes only: no text read from a screen, no pixel.
use std::collections::BTreeMap;

use serde_json::{Value, json};

use super::catalogue::{COMBO_FAMILY, FAMILIES};
use super::outcome::{Outcome, UNSUPPORTED_SIZE, Verdict};
use super::popup_fields::FieldStats;

/// How many variations of a family read correctly, were refused and read wrong.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Counts {
    pub correct: usize,
    pub refused: usize,
    pub wrong: usize,
}

impl Counts {
    pub fn add(&mut self, outcome: Outcome) {
        match outcome {
            Outcome::Correct => self.correct += 1,
            Outcome::Refused => self.refused += 1,
            Outcome::Wrong => self.wrong += 1,
        }
    }

    pub fn total(&self) -> usize {
        self.correct + self.refused + self.wrong
    }

    pub fn merge(&mut self, other: Counts) {
        self.correct += other.correct;
        self.refused += other.refused;
        self.wrong += other.wrong;
    }

    /// `correct/refused/wrong`, as the summary table writes a cell.
    pub fn cell(&self) -> String {
        format!("{}/{}/{}", self.correct, self.refused, self.wrong)
    }
}

/// The OCR variants in the order the reader returns them, and the classes of a reading of the Party field.
pub const FIELD_VARIANTS: [&str; 6] = [
    "nearest 3x",
    "bilinear 3x",
    "nearest 4x",
    "bilinear 4x",
    "nearest 5x",
    "bilinear 5x",
];
pub const FIELD_CLASSES: [&str; 6] = ["match", "masked", "blank", "1-edit", "2-edits", "far"];

/// One variation of one screenshot, read and classified.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VariantResult {
    pub screenshot: String,
    pub id: String,
    pub family: &'static str,
    pub verdict: Verdict,
    /// For a Party frame: the class of each OCR variant's reading of the field, in reader order; `None` for other screens.
    pub field_variants: Option<Vec<&'static str>>,
    /// For the popup print: how the OCR variants agree on each card field, as counts (`popup_fields`); `None` elsewhere.
    pub card_fields: Option<Vec<FieldStats>>,
}

/// Every result of a run, in the order they were read, and the seconds each screenshot took.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Report {
    pub seed: u64,
    pub combos: usize,
    pub results: Vec<VariantResult>,
    pub elapsed: Vec<(String, f64)>,
}

/// The families in the order a report lists them: the singles, then the combinations.
fn family_order() -> Vec<&'static str> {
    let mut families = vec!["scale"];
    families.extend(FAMILIES.iter().filter(|name| **name != "scale"));
    families.push(COMBO_FAMILY);
    families
}

/// The screenshot's name as the table shows it: `party-revealed` for `maintainer-party-revealed.png`.
pub fn short_name(screenshot: &str) -> &str {
    screenshot
        .strip_prefix("maintainer-")
        .unwrap_or(screenshot)
        .strip_suffix(".png")
        .unwrap_or(screenshot)
}

impl Report {
    /// The screenshots in the order they were read.
    pub fn screenshots(&self) -> Vec<&str> {
        let mut names: Vec<&str> = Vec::new();
        for result in &self.results {
            if !names.contains(&result.screenshot.as_str()) {
                names.push(&result.screenshot);
            }
        }
        names
    }

    /// Counts of one family in one screenshot.
    pub fn counts(&self, family: &str, screenshot: &str) -> Counts {
        let mut counts = Counts::default();
        for result in &self.results {
            if result.family == family && result.screenshot == screenshot {
                counts.add(result.verdict.outcome);
            }
        }
        counts
    }

    /// Counts of one screenshot, or of every screenshot when `screenshot` is `None`.
    pub fn totals(&self, screenshot: Option<&str>) -> Counts {
        let mut counts = Counts::default();
        for result in &self.results {
            if screenshot.is_none_or(|name| name == result.screenshot) {
                counts.add(result.verdict.outcome);
            }
        }
        counts
    }

    /// The families that appear in the results, in report order.
    fn families(&self) -> Vec<&'static str> {
        family_order()
            .into_iter()
            .filter(|family| self.results.iter().any(|result| result.family == *family))
            .collect()
    }

    /// The variants that read Wrong, by screenshot.
    pub fn wrong_ids(&self) -> BTreeMap<&str, Vec<&str>> {
        let mut wrong: BTreeMap<&str, Vec<&str>> = BTreeMap::new();
        for result in &self.results {
            if result.verdict.outcome == Outcome::Wrong {
                wrong
                    .entry(result.screenshot.as_str())
                    .or_default()
                    .push(&result.id);
            }
        }
        wrong
    }

    /// One compact line per family of a screenshot, for the log.
    pub fn family_lines(&self, screenshot: &str) -> Vec<String> {
        self.families()
            .into_iter()
            .filter_map(|family| {
                let counts = self.counts(family, screenshot);
                (counts.total() > 0).then(|| {
                    format!(
                        "  {} {family}: {} correct, {} refused, {} wrong",
                        short_name(screenshot),
                        counts.correct,
                        counts.refused,
                        counts.wrong
                    )
                })
            })
            .collect()
    }

    /// How many variations of each screenshot ended `outcome` for each reason class, most frequent first (then by reason).
    pub fn reason_counts(&self, outcome: Outcome) -> Vec<(String, BTreeMap<String, usize>, usize)> {
        let mut by_reason: BTreeMap<String, BTreeMap<String, usize>> = BTreeMap::new();
        for result in &self.results {
            if result.verdict.outcome == outcome {
                *by_reason
                    .entry(result.verdict.reason.to_string())
                    .or_default()
                    .entry(result.screenshot.clone())
                    .or_insert(0) += 1;
            }
        }
        let mut rows: Vec<(String, BTreeMap<String, usize>, usize)> = by_reason
            .into_iter()
            .map(|(reason, per)| {
                let total = per.values().sum();
                (reason, per, total)
            })
            .collect();
        rows.sort_by(|a, b| b.2.cmp(&a.2).then_with(|| a.0.cmp(&b.0)));
        rows
    }

    /// The reason rows of `outcome` as log lines, one per reason and screenshot, most frequent reason first, at most `limit`:
    /// `  wrong  maintainer-select-screen.png  card0-title=None  35`. Reasons are fixed vocabulary, never read text.
    pub fn reason_lines(&self, outcome: Outcome, limit: usize) -> Vec<String> {
        let screenshots = self.screenshots();
        self.reason_counts(outcome)
            .into_iter()
            .flat_map(|(reason, per, _)| {
                screenshots
                    .iter()
                    .filter_map(|name| {
                        let count = per.get(*name).copied().unwrap_or(0);
                        (count > 0)
                            .then(|| format!("  {}  {name}  {reason}  {count}", outcome.name()))
                    })
                    .collect::<Vec<_>>()
            })
            .take(limit)
            .collect()
    }

    /// The end of the run's log, for when the artifact is out of reach: the reason tables, one line per screenshot without
    /// the unsupported-size refusals, and the totals of the supported variations.
    pub fn log_lines(&self) -> Vec<String> {
        let mut lines = vec!["Reasons for the wrong reads:".to_string()];
        lines.extend(self.reason_lines(Outcome::Wrong, usize::MAX));
        lines.push("Reasons for the refused reads (top 40 rows):".to_string());
        lines.extend(self.reason_lines(Outcome::Refused, 40));
        for name in self.screenshots() {
            let counts = self.supported_counts(Some(name));
            lines.push(format!(
                "  {name}: {} correct, {} refused, {} wrong (unsupported-size left out)",
                counts.correct, counts.refused, counts.wrong
            ));
        }
        let all = self.supported_counts(None);
        lines.push(format!(
            "Supported totals: {} variations, {} correct, {} refused, {} wrong.",
            all.total(),
            all.correct,
            all.refused,
            all.wrong
        ));
        lines.extend(
            self.card_field_table()
                .lines()
                .filter(|line| !line.is_empty())
                .map(str::to_string),
        );
        lines
    }

    /// The counts of the variations of `screenshot` (all when `None`) without the unsupported-size refusals.
    fn supported_counts(&self, screenshot: Option<&str>) -> Counts {
        let mut counts = Counts::default();
        for result in &self.results {
            if screenshot.is_none_or(|name| result.screenshot == name)
                && result.verdict.reason != UNSUPPORTED_SIZE.reason
            {
                counts.add(result.verdict.outcome);
            }
        }
        counts
    }

    /// A table of reason class by screenshot for `outcome`, or nothing when no variation ended so.
    fn reason_table(&self, outcome: Outcome) -> String {
        let rows = self.reason_counts(outcome);
        if rows.is_empty() {
            return String::new();
        }
        let screenshots = self.screenshots();
        let mut text = format!("Reasons for the {} reads:\n\n| reason |", outcome.name());
        for name in &screenshots {
            text.push_str(&format!(" {} |", short_name(name)));
        }
        text.push_str(" all |\n|---|");
        for _ in 0..=screenshots.len() {
            text.push_str("---|");
        }
        text.push('\n');
        for (reason, per, total) in rows {
            text.push_str(&format!("| {reason} |"));
            for name in &screenshots {
                text.push_str(&format!(" {} |", per.get(*name).copied().unwrap_or(0)));
            }
            text.push_str(&format!(" {total} |\n"));
        }
        text.push('\n');
        text
    }

    /// How many readings of each OCR variant fell in each class, across the Party variations of the revealed screenshots, or
    /// nothing when there are none. A variant the engine failed on is left out by the reader, so a short list shifts the
    /// positions after it; the position is the index in the list.
    fn field_variant_table(&self) -> String {
        let mut counts = [[0usize; FIELD_CLASSES.len()]; FIELD_VARIANTS.len()];
        let mut variations = 0;
        for result in &self.results {
            if !result.screenshot.contains("party-revealed") {
                continue;
            }
            let Some(classes) = &result.field_variants else {
                continue;
            };
            variations += 1;
            for (position, class) in classes.iter().take(FIELD_VARIANTS.len()).enumerate() {
                if let Some(column) = FIELD_CLASSES.iter().position(|name| name == class) {
                    counts[position][column] += 1;
                }
            }
        }
        if variations == 0 {
            return String::new();
        }
        let mut text = format!(
            "Party field by OCR variant ({variations} readings of the revealed screenshots):\n\n| variant |"
        );
        for class in FIELD_CLASSES {
            text.push_str(&format!(" {class} |"));
        }
        text.push_str("\n|---|");
        for _ in FIELD_CLASSES {
            text.push_str("---|");
        }
        text.push('\n');
        for (position, name) in FIELD_VARIANTS.iter().enumerate() {
            text.push_str(&format!("| {name} |"));
            for count in counts[position] {
                text.push_str(&format!(" {count} |"));
            }
            text.push('\n');
        }
        text.push('\n');
        text
    }

    /// How the OCR variants agree on each card field of the popup print, as counts, or nothing when no result carries them.
    /// Two tables: per slot and field, the sums over the variations; and per reason class, how many variations settle each
    /// field on the expected value by the production majority rule. No read text.
    fn card_field_table(&self) -> String {
        let with: Vec<(&VariantResult, &Vec<FieldStats>)> = self
            .results
            .iter()
            .filter_map(|result| result.card_fields.as_ref().map(|fields| (result, fields)))
            .collect();
        if with.is_empty() {
            return String::new();
        }
        let mut keys: Vec<(u8, &'static str)> = with
            .iter()
            .flat_map(|(_, fields)| fields.iter().map(|f| (f.slot, f.field)))
            .collect();
        keys.sort_unstable();
        keys.dedup();
        let mut text = format!(
            "Popup card fields by slot, summed over {} variations (v = OCR readings, unp = did not parse, blank, d1/d2/far = parsed readings 1 edit, 2 edits or further from the leading one, exp = equal to the expected card, unan = every reading agreed, settled and ok = the majority rule settles / settles on the expected value):\n\n| slot | field | n | v | unp | blank | d1 | d2 | far | exp | unan | settled | ok |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|\n",
            with.len()
        );
        for (slot, field) in keys {
            let rows: Vec<&FieldStats> = with
                .iter()
                .flat_map(|(_, fields)| fields.iter())
                .filter(|f| f.slot == slot && f.field == field)
                .collect();
            let sum = |value: fn(&FieldStats) -> u8| -> usize {
                rows.iter().map(|f| usize::from(value(f))).sum()
            };
            let count = |test: fn(&FieldStats) -> bool| rows.iter().filter(|f| test(f)).count();
            text.push_str(&format!(
                "| {slot} | {field} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} |\n",
                rows.len(),
                sum(|f| f.variants),
                sum(|f| f.unparsed),
                sum(|f| f.blank),
                sum(|f| f.near1),
                sum(|f| f.near2),
                sum(|f| f.far),
                sum(|f| f.expected),
                count(|f| f.variants > 0 && f.top == f.variants),
                count(|f| f.settled),
                count(|f| f.settled_expected),
            ));
        }
        let mut by_reason: BTreeMap<(&str, &str), [usize; 9]> = BTreeMap::new();
        for (result, fields) in &with {
            let ok = |field: &str| {
                fields
                    .iter()
                    .any(|f| f.slot == 0 && f.field == field && f.settled_expected)
            };
            let ok_all = |field: &str| {
                let of: Vec<&FieldStats> = fields.iter().filter(|f| f.field == field).collect();
                !of.is_empty() && of.iter().all(|f| f.settled_expected)
            };
            let lift: Vec<&FieldStats> = fields
                .iter()
                .filter(|f| f.field.starts_with("lift-"))
                .collect();
            let row = by_reason
                .entry((
                    result.verdict.outcome.name(),
                    result.verdict.reason.as_ref(),
                ))
                .or_default();
            row[0] += 1;
            row[1] += usize::from(ok("name"));
            row[2] += usize::from(ok("level"));
            row[3] += usize::from(ok("title"));
            row[4] += usize::from(["name", "level"].iter().all(|field| ok(field)));
            row[5] += usize::from(["name", "level"].iter().all(|field| ok_all(field)));
            row[6] += usize::from(!lift.is_empty());
            // Both cards' names and levels settle on the expected values in the lifted read.
            row[7] += usize::from(lift.len() >= 4 && lift.iter().all(|f| f.settled_expected));
            // Some lifted field settles on a value that is not the expected one: the way a lift reads WRONG.
            row[8] += usize::from(lift.iter().any(|f| f.settled && !f.settled_expected));
        }
        text.push_str(
            "\nPopup variations by outcome and reason: how many settle each field of slot 0 on the expected value (name, level, title; a title line the lines pass did not find is read through the pixels and shown here as no field), name and level together on slot 0, and on every slot, then, for the variations whose plain read found no card and whose column was read again with its brightness lifted (diagnostic only, every third variation), how many read, how many settle both cards' names and levels on the expected values, and how many settle some field on a value that is not the expected one:\n\n| outcome | reason | n | name ok | level ok | title ok | slot 0 name+level ok | all slots name+level ok | lifted read | lifted all ok | lifted settles wrong |\n|---|---|---|---|---|---|---|---|---|---|---|\n",
        );
        for ((outcome, reason), row) in by_reason {
            text.push_str(&format!(
                "| {outcome} | {reason} | {} | {} | {} | {} | {} | {} | {} | {} | {} |\n",
                row[0], row[1], row[2], row[3], row[4], row[5], row[6], row[7], row[8]
            ));
        }
        text.push('\n');
        text
    }

    /// The markdown for the job summary: a family by screenshot table of `correct/refused/wrong`, the totals and the ids of
    /// the variants that read wrong.
    pub fn markdown(&self) -> String {
        let screenshots = self.screenshots();
        let mut text = String::from("## OCR variations\n\n");
        text.push_str(&format!(
            "Seed {}, {} seeded combinations per screenshot. Each cell is correct/refused/wrong; a wrong read is the worst outcome.\n\n",
            self.seed, self.combos
        ));
        text.push_str("| family |");
        for name in &screenshots {
            text.push_str(&format!(" {} |", short_name(name)));
        }
        text.push_str(" all |\n|---|");
        for _ in 0..=screenshots.len() {
            text.push_str("---|");
        }
        text.push('\n');
        for family in self.families() {
            text.push_str(&format!("| {family} |"));
            let mut all = Counts::default();
            for name in &screenshots {
                let counts = self.counts(family, name);
                all.merge(counts);
                text.push_str(&format!(" {} |", counts.cell()));
            }
            text.push_str(&format!(" {} |\n", all.cell()));
        }
        text.push_str("| **total** |");
        for name in &screenshots {
            text.push_str(&format!(" {} |", self.totals(Some(name)).cell()));
        }
        text.push_str(&format!(" {} |\n\n", self.totals(None).cell()));
        let all = self.totals(None);
        text.push_str(&format!(
            "Totals: {} variations, {} correct, {} refused, {} wrong.\n\n",
            all.total(),
            all.correct,
            all.refused,
            all.wrong
        ));
        text.push_str(&self.field_variant_table());
        text.push_str(&self.card_field_table());
        text.push_str(&self.reason_table(Outcome::Refused));
        text.push_str(&self.reason_table(Outcome::Wrong));
        let wrong = self.wrong_ids();
        if wrong.is_empty() {
            text.push_str("No variant read wrong.\n");
        } else {
            text.push_str("Variants that read wrong:\n\n");
            for (screenshot, ids) in wrong {
                text.push_str(&format!(
                    "- {}: {}\n",
                    short_name(screenshot),
                    ids.join(", ")
                ));
            }
        }
        text.push_str("\nSeconds per screenshot:");
        for (name, seconds) in &self.elapsed {
            text.push_str(&format!(" {} {seconds:.0};", short_name(name)));
        }
        text.push('\n');
        text
    }

    /// The same counts as JSON, and one entry per variant (no read text).
    pub fn json(&self) -> Value {
        let counts_json = |counts: Counts| {
            json!({
                "correct": counts.correct,
                "refused": counts.refused,
                "wrong": counts.wrong,
            })
        };
        let mut families = serde_json::Map::new();
        for family in self.families() {
            let mut per_screenshot = serde_json::Map::new();
            for name in self.screenshots() {
                per_screenshot.insert(name.to_string(), counts_json(self.counts(family, name)));
            }
            families.insert(family.to_string(), Value::Object(per_screenshot));
        }
        let all = self.supported_counts(None);
        let supported = json!({
            "variations": all.total(),
            "correct": all.correct,
            "refused": all.refused,
            "wrong": all.wrong,
        });
        let mut totals = serde_json::Map::new();
        for name in self.screenshots() {
            totals.insert(name.to_string(), counts_json(self.totals(Some(name))));
        }
        let mut elapsed = serde_json::Map::new();
        for (name, seconds) in &self.elapsed {
            elapsed.insert(name.clone(), json!(seconds));
        }
        let variants: Vec<Value> = self
            .results
            .iter()
            .map(|result| {
                let mut entry = json!({
                    "screenshot": result.screenshot,
                    "id": result.id,
                    "family": result.family,
                    "outcome": result.verdict.outcome.name(),
                    "reason_class": result.verdict.reason.as_ref(),
                });
                if let Some(variants) = &result.field_variants {
                    entry["field_variants"] = json!(variants);
                }
                if let Some(fields) = &result.card_fields {
                    entry["card_fields"] = fields
                        .iter()
                        .map(|f| {
                            json!({
                                "slot": f.slot, "field": f.field, "variants": f.variants,
                                "unparsed": f.unparsed, "blank": f.blank, "distinct": f.distinct,
                                "top": f.top, "near1": f.near1, "near2": f.near2, "far": f.far,
                                "expected": f.expected, "settled": f.settled,
                                "settled_expected": f.settled_expected,
                            })
                        })
                        .collect();
                }
                entry
            })
            .collect();
        json!({
            "seed": self.seed,
            "combos": self.combos,
            "totals": counts_json(self.totals(None)),
            "supported": supported,
            "totals_by_screenshot": totals,
            "families": families,
            "elapsed_seconds": elapsed,
            "variants": variants,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn result(screenshot: &str, id: &str, family: &'static str, outcome: Outcome) -> VariantResult {
        VariantResult {
            screenshot: screenshot.to_string(),
            id: id.to_string(),
            family,
            verdict: Verdict {
                outcome,
                reason: "reason".into(),
            },
            field_variants: None,
            card_fields: None,
        }
    }

    fn report() -> Report {
        Report {
            seed: 9,
            combos: 2,
            results: vec![
                result(
                    "maintainer-party-revealed.png",
                    "gamma-0.6",
                    "tone",
                    Outcome::Correct,
                ),
                result(
                    "maintainer-party-revealed.png",
                    "gamma-0.8",
                    "tone",
                    Outcome::Wrong,
                ),
                result(
                    "maintainer-party-revealed.png",
                    "scale-720",
                    "scale",
                    Outcome::Refused,
                ),
                result(
                    "maintainer-select-screen.png",
                    "gamma-0.6",
                    "tone",
                    Outcome::Refused,
                ),
                result(
                    "maintainer-select-screen.png",
                    "combo-000",
                    "combo",
                    Outcome::Correct,
                ),
            ],
            elapsed: vec![
                ("maintainer-party-revealed.png".to_string(), 12.4),
                ("maintainer-select-screen.png".to_string(), 8.0),
            ],
        }
    }

    #[test]
    fn counts_by_family_screenshot_and_total() {
        let report = report();
        let revealed = "maintainer-party-revealed.png";
        assert_eq!(
            report.counts("tone", revealed),
            Counts {
                correct: 1,
                refused: 0,
                wrong: 1
            }
        );
        assert_eq!(report.counts("tone", revealed).cell(), "1/0/1");
        assert_eq!(report.counts("jpeg", revealed), Counts::default());
        assert_eq!(report.totals(Some(revealed)).total(), 3);
        assert_eq!(report.totals(None).total(), 5);
        assert_eq!(report.totals(None).wrong, 1);
        assert_eq!(
            report.screenshots(),
            [revealed, "maintainer-select-screen.png"]
        );
    }

    #[test]
    fn the_wrong_variants_are_listed_by_screenshot() {
        let report = report();
        let wrong = report.wrong_ids();
        assert_eq!(wrong.len(), 1);
        assert_eq!(wrong["maintainer-party-revealed.png"], ["gamma-0.8"]);
    }

    #[test]
    fn short_names_drop_the_prefix_and_the_extension() {
        assert_eq!(
            short_name("maintainer-party-revealed.png"),
            "party-revealed"
        );
        assert_eq!(short_name("other.bin"), "other.bin");
    }

    #[test]
    fn the_family_lines_list_the_families_in_report_order() {
        let lines = report().family_lines("maintainer-party-revealed.png");
        assert_eq!(
            lines,
            [
                "  party-revealed scale: 0 correct, 1 refused, 0 wrong",
                "  party-revealed tone: 1 correct, 0 refused, 1 wrong",
            ]
        );
    }

    #[test]
    fn the_markdown_has_the_table_the_totals_and_the_wrong_ids() {
        let text = report().markdown();
        assert!(
            text.contains("| family | party-revealed | select-screen | all |"),
            "{text}"
        );
        assert!(text.contains("| scale | 0/1/0 | 0/0/0 | 0/1/0 |"), "{text}");
        assert!(text.contains("| tone | 1/0/1 | 0/1/0 | 1/1/1 |"), "{text}");
        assert!(
            text.contains("| **total** | 1/1/1 | 1/1/0 | 2/2/1 |"),
            "{text}"
        );
        assert!(text.contains("Totals: 5 variations, 2 correct, 2 refused, 1 wrong."));
        assert!(text.contains("- party-revealed: gamma-0.8"));
        assert!(text.contains("party-revealed 12;"));
        let clean = Report {
            results: vec![result(
                "maintainer-select-screen.png",
                "a",
                "tone",
                Outcome::Correct,
            )],
            ..Report::default()
        };
        assert!(clean.markdown().contains("No variant read wrong."));
    }

    #[test]
    fn the_reason_tables_count_by_screenshot_most_frequent_first() {
        let with = |screenshot: &str, id: &str, outcome, reason: &'static str| VariantResult {
            verdict: Verdict {
                outcome,
                reason: reason.into(),
            },
            ..result(screenshot, id, "tone", outcome)
        };
        let report = Report {
            results: vec![
                with(
                    "maintainer-party-revealed.png",
                    "a",
                    Outcome::Refused,
                    "b-rare",
                ),
                with(
                    "maintainer-party-revealed.png",
                    "b",
                    Outcome::Refused,
                    "a-common",
                ),
                with(
                    "maintainer-select-screen.png",
                    "c",
                    Outcome::Refused,
                    "a-common",
                ),
                with(
                    "maintainer-select-screen.png",
                    "d",
                    Outcome::Refused,
                    "a-common",
                ),
                with(
                    "maintainer-select-screen.png",
                    "e",
                    Outcome::Wrong,
                    "card0-level",
                ),
                with(
                    "maintainer-select-screen.png",
                    "f",
                    Outcome::Correct,
                    "fine",
                ),
            ],
            ..Report::default()
        };
        let rows = report.reason_counts(Outcome::Refused);
        assert_eq!(
            rows.iter()
                .map(|(reason, _, total)| (reason.as_str(), *total))
                .collect::<Vec<_>>(),
            [("a-common", 3), ("b-rare", 1)]
        );
        let text = report.markdown();
        assert!(text.contains("Reasons for the refused reads:"), "{text}");
        assert!(
            text.contains("| reason | party-revealed | select-screen | all |"),
            "{text}"
        );
        assert!(text.contains("| a-common | 1 | 2 | 3 |"), "{text}");
        assert!(text.contains("| b-rare | 1 | 0 | 1 |"), "{text}");
        assert!(text.contains("Reasons for the wrong reads:"), "{text}");
        assert!(text.contains("| card0-level | 0 | 1 | 1 |"), "{text}");
        let clean = Report {
            results: vec![with(
                "maintainer-select-screen.png",
                "f",
                Outcome::Correct,
                "fine",
            )],
            ..Report::default()
        };
        assert!(!clean.markdown().contains("Reasons for the"));
    }

    #[test]
    fn the_log_lines_print_the_reason_tables_and_the_supported_totals() {
        let with = |outcome, reason: &str| VariantResult {
            verdict: Verdict {
                outcome,
                reason: reason.to_string().into(),
            },
            ..result("maintainer-select-screen.png", "a", "tone", outcome)
        };
        let mut results = vec![
            with(Outcome::Wrong, "card0-title=None"),
            with(Outcome::Wrong, "card0-title=None"),
            with(Outcome::Refused, "unsupported-size"),
            with(Outcome::Refused, "no-card"),
            VariantResult {
                screenshot: "maintainer-party-masked.png".to_string(),
                ..with(Outcome::Correct, "fine")
            },
        ];
        let lines = Report {
            results: results.clone(),
            ..Report::default()
        }
        .log_lines();
        assert_eq!(lines[0], "Reasons for the wrong reads:");
        assert_eq!(
            lines[1],
            "  wrong  maintainer-select-screen.png  card0-title=None  2"
        );
        assert!(lines.contains(&"  refused  maintainer-select-screen.png  no-card  1".to_string()));
        assert!(lines.contains(
            &"  maintainer-select-screen.png: 0 correct, 1 refused, 2 wrong (unsupported-size left out)"
                .to_string()
        ));
        assert_eq!(
            lines.last().unwrap(),
            "Supported totals: 4 variations, 1 correct, 1 refused, 2 wrong."
        );
        for index in 0..60 {
            results.push(with(Outcome::Refused, &format!("r{index}")));
        }
        let long = Report {
            results,
            ..Report::default()
        };
        assert_eq!(long.reason_lines(Outcome::Refused, 40).len(), 40);
    }

    #[test]
    fn the_variant_table_counts_each_class_per_position_for_the_revealed_party_frames() {
        let party = |screenshot: &str, classes: &[&'static str]| VariantResult {
            field_variants: Some(classes.to_vec()),
            card_fields: None,
            ..result(screenshot, "a", "shift", Outcome::Refused)
        };
        let report = Report {
            results: vec![
                party(
                    "maintainer-party-revealed.png",
                    &["match", "blank", "far", "far", "far", "far"],
                ),
                party(
                    "maintainer-party-revealed-tooltip.png",
                    &["1-edit", "blank"],
                ),
                // The masked frame and the other screens are not counted.
                party("maintainer-party-masked.png", &["masked"; 6]),
                result(
                    "maintainer-select-screen.png",
                    "b",
                    "shift",
                    Outcome::Correct,
                ),
            ],
            ..Report::default()
        };
        let text = report.markdown();
        assert!(text.contains("(2 readings of the revealed"), "{text}");
        assert!(
            text.contains("| variant | match | masked | blank | 1-edit | 2-edits | far |"),
            "{text}"
        );
        assert!(
            text.contains("| nearest 3x | 1 | 0 | 0 | 1 | 0 | 0 |"),
            "{text}"
        );
        assert!(
            text.contains("| bilinear 3x | 0 | 0 | 2 | 0 | 0 | 0 |"),
            "{text}"
        );
        assert!(
            text.contains("| nearest 4x | 0 | 0 | 0 | 0 | 0 | 1 |"),
            "{text}"
        );
        assert!(
            text.contains("| bilinear 5x | 0 | 0 | 0 | 0 | 0 | 1 |"),
            "{text}"
        );
        assert!(!Report::default().markdown().contains("by OCR variant"));
        let value = report.json();
        assert_eq!(
            value["variants"][1]["field_variants"],
            json!(["1-edit", "blank"])
        );
        assert!(value["variants"][3].get("field_variants").is_none());
    }

    #[test]
    fn the_json_has_counts_and_one_entry_per_variant_with_no_text() {
        let value = report().json();
        assert_eq!(value["totals"]["wrong"], 1);
        assert_eq!(
            value["families"]["tone"]["maintainer-party-revealed.png"]["correct"],
            1
        );
        assert_eq!(
            value["totals_by_screenshot"]["maintainer-select-screen.png"]["refused"],
            1
        );
        let variants = value["variants"].as_array().unwrap();
        assert_eq!(variants.len(), 5);
        assert_eq!(
            variants[1],
            json!({
                "screenshot": "maintainer-party-revealed.png",
                "id": "gamma-0.8",
                "family": "tone",
                "outcome": "wrong",
                "reason_class": "reason",
            })
        );
        assert_eq!(
            value["elapsed_seconds"]["maintainer-select-screen.png"],
            8.0
        );
    }

    #[test]
    fn the_json_carries_the_supported_totals_without_the_unsupported_size() {
        let with = |outcome, reason: &str| VariantResult {
            verdict: Verdict {
                outcome,
                reason: reason.to_string().into(),
            },
            ..result("maintainer-select-screen.png", "a", "tone", outcome)
        };
        let value = Report {
            results: vec![
                with(Outcome::Wrong, "card0-title=None"),
                with(Outcome::Wrong, "card0-title=None"),
                with(Outcome::Refused, "unsupported-size"),
                with(Outcome::Refused, "no-card"),
                with(Outcome::Correct, "fine"),
            ],
            ..Report::default()
        }
        .json();
        assert_eq!(
            value["supported"],
            json!({"variations": 4, "correct": 1, "refused": 1, "wrong": 2})
        );
        assert_eq!(value["totals"]["refused"], 2);
    }

    #[test]
    fn the_card_field_tables_sum_the_counts_by_slot_and_by_reason_and_the_json_carries_them() {
        let field = |slot, name, settled_expected| FieldStats {
            slot,
            field: name,
            variants: 6,
            unparsed: 2,
            blank: 1,
            distinct: 2,
            top: 4,
            near1: 1,
            near2: 0,
            far: 1,
            expected: if settled_expected { 4 } else { 0 },
            settled: true,
            settled_expected,
        };
        let popup = |reason: &str, name_ok: bool| VariantResult {
            verdict: Verdict {
                outcome: Outcome::Refused,
                reason: reason.to_string().into(),
            },
            card_fields: Some(vec![
                field(0, "name", name_ok),
                field(0, "level", true),
                field(0, "title", true),
            ]),
            ..result(
                "maintainer-select-difficulty.png",
                "a",
                "tone",
                Outcome::Refused,
            )
        };
        let report = Report {
            results: vec![
                popup("name-unread", true),
                popup("name-unread", false),
                result(
                    "maintainer-party-revealed.png",
                    "b",
                    "tone",
                    Outcome::Correct,
                ),
            ],
            ..Report::default()
        };
        let text = report.markdown();
        assert!(text.contains("Popup card fields by slot, summed over 2 variations"));
        assert!(text.contains("| 0 | name | 2 | 12 | 4 | 2 | 2 | 0 | 2 | 4 | 0 | 2 | 1 |"));
        assert!(text.contains("| refused | name-unread | 2 | 1 | 2 | 2 | 1 | 1 | 0 | 0 | 0 |"));
        let value = report.json();
        assert_eq!(value["variants"][0]["card_fields"][0]["top"], 4);
        assert_eq!(value["variants"][0]["card_fields"][0]["field"], "name");
        assert!(value["variants"][2].get("card_fields").is_none());
        assert!(
            !Report::default().markdown().contains("Popup card fields"),
            "no popup results, no table"
        );
    }
}
