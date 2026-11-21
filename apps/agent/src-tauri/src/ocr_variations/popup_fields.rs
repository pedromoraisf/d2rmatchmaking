//! How the OCR variants agree on each card field of a frame (screen-recognition T9). The popup print refuses most of its
//! variations on `name-unread`, `level-unread` or `title-unread`; the reason class alone does not say whether the variants
//! read nothing, read different things, or read the same thing the rules then drop. This reads each card's name, level and
//! title lines the way the production reading does and keeps, per field, COUNTS only: how many variants parsed, how many were
//! blank, how many distinct readings, how many agree with the leading one, how far the others sit from it (edit-distance
//! class), and how many equal the expected card. No read text, and so no character name, ever leaves this module.
use std::collections::HashMap;
use std::sync::{Arc, Mutex, PoisonError};

use d2rmm_agent_core::ports::{ReadError, Rgba, TextReader};
use d2rmm_agent_core::screen_reader::readings_of;
use d2rmm_agent_domain::anchors::{self, TitleLine};
use d2rmm_agent_domain::character_screen::{parse_level_and_class, read_name, read_title};
use d2rmm_agent_domain::characters::{Class, Title};
use d2rmm_agent_domain::language::LanguagePack;
use d2rmm_agent_domain::layout::{CARD_SLOTS, ScreenRegion, screen_region};
use d2rmm_agent_domain::name_diff::edit_distance;
use d2rmm_agent_domain::vision::{ReadText, Region, TextLine};

use crate::ocr_check::Card;

type Key = (u32, u32, u32, u32);

fn key(region: Region) -> Key {
    (region.x, region.y, region.width, region.height)
}

#[derive(Default)]
struct Memo {
    read: HashMap<Key, Result<ReadText, ReadError>>,
    variants: HashMap<Key, Vec<ReadText>>,
    lines: HashMap<Key, Vec<TextLine>>,
    line_variants: HashMap<Key, Vec<Vec<TextLine>>>,
}

/// A reader that remembers what it read of the current frame, so the production reading and the card-field diagnostic that
/// follows it cost one OCR pass, not two (the popup print has to stay inside the per-print time budget). The same pixels and
/// region always give the same text, so it changes no reading; `next_frame` forgets everything.
pub struct MemoReader {
    inner: Arc<dyn TextReader + Send + Sync>,
    memo: Mutex<Memo>,
}

impl MemoReader {
    pub fn new(inner: Arc<dyn TextReader + Send + Sync>) -> Self {
        Self {
            inner,
            memo: Mutex::new(Memo::default()),
        }
    }

    /// Forgets the readings of the previous frame.
    pub fn next_frame(&self) {
        *self.memo.lock().unwrap_or_else(PoisonError::into_inner) = Memo::default();
    }

    fn cached<V: Clone>(
        &self,
        table: impl Fn(&mut Memo) -> &mut HashMap<Key, V>,
        region: Region,
        read: impl FnOnce() -> V,
    ) -> V {
        let k = key(region);
        {
            let mut memo = self.memo.lock().unwrap_or_else(PoisonError::into_inner);
            if let Some(found) = table(&mut memo).get(&k) {
                return found.clone();
            }
        }
        let value = read();
        let mut memo = self.memo.lock().unwrap_or_else(PoisonError::into_inner);
        table(&mut memo).insert(k, value.clone());
        value
    }
}

impl TextReader for MemoReader {
    fn read(&self, image: &Rgba, region: Region) -> Result<ReadText, ReadError> {
        self.cached(|m| &mut m.read, region, || self.inner.read(image, region))
    }

    fn read_variants(&self, image: &Rgba, region: Region) -> Vec<ReadText> {
        self.cached(
            |m| &mut m.variants,
            region,
            || self.inner.read_variants(image, region),
        )
    }

    fn read_lines(&self, image: &Rgba, region: Region) -> Vec<TextLine> {
        self.cached(
            |m| &mut m.lines,
            region,
            || self.inner.read_lines(image, region),
        )
    }

    fn read_line_variants(&self, image: &Rgba, region: Region) -> Vec<Vec<TextLine>> {
        self.cached(
            |m| &mut m.line_variants,
            region,
            || self.inner.read_line_variants(image, region),
        )
    }
}

/// Agreement of the OCR variants on one field of one card slot: counts only.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FieldStats {
    pub slot: u8,
    /// `name`, `level` or `title`; `title-absent`, `title-unseen` and `title-garbled` for a title line that was not found
    /// as a known title (no variants then).
    pub field: &'static str,
    /// How many variants read the region (the engine fails on some).
    pub variants: u8,
    /// Variants whose text does not parse as this field (blank ones included).
    pub unparsed: u8,
    /// Variants that read nothing (a subset of `unparsed`, except for a title, where blank is a value).
    pub blank: u8,
    /// Distinct parsed readings.
    pub distinct: u8,
    /// How many variants gave the leading parsed reading.
    pub top: u8,
    /// Parsed readings other than the leading one, by distance to it: 1 edit, 2 edits, further.
    pub near1: u8,
    pub near2: u8,
    pub far: u8,
    /// Variants that read the expected card's value.
    pub expected: u8,
    /// The production majority rule settles on a value (a unique leader, with at least two votes when there are two or
    /// more variants).
    pub settled: bool,
    /// ... and that value is the expected one.
    pub settled_expected: bool,
}

/// The agreement of `readings` (`None` for a variant that did not parse), for a field whose expected value is `expected`.
/// `distance` measures how far a reading is from the leading one, 3 or more meaning far.
fn stats<T: PartialEq + Clone>(
    slot: u8,
    field: &'static str,
    readings: &[Option<T>],
    blank: usize,
    expected: Option<&T>,
    distance: impl Fn(&T, &T) -> usize,
) -> FieldStats {
    let mut tallies: Vec<(T, usize)> = Vec::new();
    for value in readings.iter().flatten() {
        match tallies.iter_mut().find(|(seen, _)| seen == value) {
            Some((_, count)) => *count += 1,
            None => tallies.push((value.clone(), 1)),
        }
    }
    let top = tallies.iter().map(|(_, count)| *count).max().unwrap_or(0);
    let leaders = tallies.iter().filter(|(_, count)| *count == top).count();
    let settled = top > 0 && leaders == 1 && top >= readings.len().min(2);
    let leader = tallies.iter().find(|(_, count)| *count == top);
    let (mut near1, mut near2, mut far) = (0, 0, 0);
    if let Some((lead, _)) = leader {
        for (value, count) in &tallies {
            if value == lead {
                continue;
            }
            match distance(value, lead) {
                0 | 1 => near1 += count,
                2 => near2 += count,
                _ => far += count,
            }
        }
    }
    let equals = |value: &T| expected == Some(value);
    FieldStats {
        slot,
        field,
        variants: small(readings.len()),
        unparsed: small(readings.iter().filter(|r| r.is_none()).count()),
        blank: small(blank),
        distinct: small(tallies.len()),
        top: small(top),
        near1: small(near1),
        near2: small(near2),
        far: small(far),
        expected: small(
            tallies
                .iter()
                .filter(|(value, _)| equals(value))
                .map(|(_, count)| count)
                .sum(),
        ),
        settled,
        settled_expected: settled && leader.is_some_and(|(value, _)| equals(value)),
    }
}

fn small(count: usize) -> u8 {
    u8::try_from(count).unwrap_or(u8::MAX)
}

/// The class of a title line that no variant could settle, as a field name with no variants.
fn lineless(slot: u8, field: &'static str) -> FieldStats {
    stats::<u8>(slot, field, &[], 0, None, |_, _| 3)
}

/// The agreement on the name, level and title lines of each card slot of `frame`, found as the production reading finds
/// them (the card column's lines, the cards by their level line, each field's box padded). `expected` are the cards the
/// screenshot is known to show, by position. Empty when the frame has no card column.
pub fn card_field_stats(
    reader: &dyn TextReader,
    frame: &Rgba,
    pack: &LanguagePack,
    expected: &[Card],
) -> Vec<FieldStats> {
    let Some(column) = screen_region(ScreenRegion::CardColumn, frame.width, frame.height) else {
        return Vec::new();
    };
    let lines = reader.read_line_variants(frame, column);
    let pad = anchors::line_pad(frame.height);
    let readings = |region| {
        let area = anchors::padded(region, pad, frame.width, frame.height);
        readings_of(reader, frame, area)
    };
    let mut all = Vec::new();
    let cards = anchors::find_cards_in_variants(pack, &lines, frame.height);
    for (index, anchor) in cards.into_iter().take(usize::from(CARD_SLOTS)).enumerate() {
        let slot = small(index);
        let wanted = expected.get(index);
        let names = readings(anchor.name);
        let parsed: Vec<Option<String>> = names
            .iter()
            .map(|text| read_name(text).map(|name| name.to_lowercase()))
            .collect();
        let blank = names.iter().filter(|t| t.trim().is_empty()).count();
        let wanted_name = wanted.map(|(name, ..)| name.to_lowercase());
        all.push(stats(
            slot,
            "name",
            &parsed,
            blank,
            wanted_name.as_ref(),
            |a, b| edit_distance(a, b),
        ));

        let levels = readings(anchor.level);
        let parsed: Vec<Option<(u8, Class)>> = levels
            .iter()
            .map(|text| parse_level_and_class(text, pack))
            .collect();
        let blank = levels.iter().filter(|t| t.trim().is_empty()).count();
        let wanted_level = wanted.map(|(_, class, level, _)| (*level, *class));
        all.push(stats(
            slot,
            "level",
            &parsed,
            blank,
            wanted_level.as_ref(),
            |a, b| {
                if a.1 == b.1 {
                    edit_distance(&a.0.to_string(), &b.0.to_string())
                } else {
                    3
                }
            },
        ));

        match anchor.title {
            TitleLine::Known(region) => {
                let titles = readings(region);
                let parsed: Vec<Option<Option<Title>>> =
                    titles.iter().map(|text| read_title(pack, text)).collect();
                let blank = titles.iter().filter(|t| t.trim().is_empty()).count();
                let wanted_title = wanted.map(|(.., title)| *title);
                all.push(stats(
                    slot,
                    "title",
                    &parsed,
                    blank,
                    wanted_title.as_ref(),
                    |_, _| 3,
                ));
            }
            TitleLine::None if anchor.title_unseen => all.push(lineless(slot, "title-unseen")),
            TitleLine::None => all.push(lineless(slot, "title-absent")),
            TitleLine::Unknown => all.push(lineless(slot, "title-garbled")),
        }
    }
    all
}

#[cfg(test)]
mod tests {
    use super::{FieldStats, stats};

    fn name_stats(readings: &[Option<&str>], expected: &str) -> FieldStats {
        let owned: Vec<Option<String>> = readings.iter().map(|r| r.map(str::to_string)).collect();
        let blank = readings.iter().filter(|r| r.is_none()).count();
        stats(
            1,
            "name",
            &owned,
            blank,
            Some(&expected.to_string()),
            |a, b| d2rmm_agent_domain::name_diff::edit_distance(a, b),
        )
    }

    #[test]
    fn six_equal_readings_are_unanimous_and_settle() {
        let got = name_stats(&[Some("abc"); 6], "abc");
        assert_eq!(
            (got.variants, got.unparsed, got.distinct, got.top),
            (6, 0, 1, 6)
        );
        assert_eq!((got.near1, got.near2, got.far, got.expected), (0, 0, 0, 6));
        assert!(got.settled && got.settled_expected);
    }

    #[test]
    fn a_disagreeing_variant_is_counted_by_its_distance_to_the_leader() {
        let got = name_stats(
            &[
                Some("abcd"),
                Some("abcd"),
                Some("abcd"),
                Some("abce"),
                Some("abxy"),
                Some("zzzzzzz"),
            ],
            "abcd",
        );
        assert_eq!((got.distinct, got.top), (4, 3));
        assert_eq!((got.near1, got.near2, got.far), (1, 1, 1));
        assert_eq!(got.expected, 3);
        assert!(got.settled && got.settled_expected);
    }

    #[test]
    fn unparsed_and_blank_variants_vote_for_nothing() {
        let got = name_stats(&[None, None, Some("abc"), Some("abc"), None, None], "abc");
        assert_eq!((got.variants, got.unparsed, got.blank), (6, 4, 4));
        assert_eq!((got.top, got.expected), (2, 2));
        assert!(got.settled, "two votes and no rival settle, as `majority`");
        let one = name_stats(&[None, None, None, Some("abc"), None, None], "abc");
        assert!(!one.settled, "one vote of six is not enough");
        assert_eq!(one.expected, 1);
    }

    #[test]
    fn a_tie_between_two_readings_settles_nothing() {
        let got = name_stats(&[Some("abc"), Some("abc"), Some("abd"), Some("abd")], "abc");
        assert_eq!((got.distinct, got.top), (2, 2));
        assert!(!got.settled && !got.settled_expected);
    }

    #[test]
    fn a_lone_reading_settles_and_a_settled_wrong_value_is_not_expected() {
        let got = name_stats(&[Some("xyz")], "abc");
        assert!(got.settled && !got.settled_expected);
        assert_eq!(got.expected, 0);
        assert!(!name_stats(&[], "abc").settled);
    }

    #[test]
    fn a_settled_value_that_differs_from_the_expected_one_is_marked() {
        let got = name_stats(&[Some("abx"), Some("abx"), Some("abx")], "abc");
        assert!(got.settled && !got.settled_expected);
        assert_eq!((got.top, got.expected), (3, 0));
    }

    mod memo {
        use std::sync::Arc;
        use std::sync::atomic::{AtomicUsize, Ordering};

        use d2rmm_agent_core::ports::{ReadError, Rgba, TextReader};
        use d2rmm_agent_domain::vision::{ReadText, Region};

        use super::super::MemoReader;

        struct Counting(AtomicUsize);

        impl TextReader for Counting {
            fn read(&self, _image: &Rgba, _region: Region) -> Result<ReadText, ReadError> {
                self.0.fetch_add(1, Ordering::SeqCst);
                Ok(ReadText {
                    text: "x".to_string(),
                    confidence: 1.0,
                })
            }
        }

        fn region(x: u32) -> Region {
            Region {
                x,
                y: 0,
                width: 5,
                height: 5,
            }
        }

        fn image() -> Rgba {
            Rgba {
                width: 10,
                height: 10,
                pixels: Vec::new(),
            }
        }

        #[test]
        fn a_region_read_twice_in_a_frame_is_read_once_and_a_new_frame_reads_again() {
            let counting = Arc::new(Counting(AtomicUsize::new(0)));
            let memo = MemoReader::new(counting.clone());
            let image = image();
            for _ in 0..3 {
                assert_eq!(memo.read_variants(&image, region(1)).len(), 1);
                assert_eq!(memo.read_lines(&image, region(1)).len(), 1);
                assert_eq!(memo.read_line_variants(&image, region(1)).len(), 1);
                assert!(memo.read(&image, region(1)).is_ok());
            }
            // One OCR call per method kind on the default impls: the three derived ones call `read` once each, plus `read`.
            let first = counting.0.load(Ordering::SeqCst);
            assert_eq!(first, 4);
            memo.read(&image, region(2)).unwrap();
            assert_eq!(
                counting.0.load(Ordering::SeqCst),
                first + 1,
                "another region"
            );
            memo.next_frame();
            memo.read(&image, region(1)).unwrap();
            assert_eq!(counting.0.load(Ordering::SeqCst), first + 2, "a new frame");
        }
    }

    mod frame {
        use std::sync::Arc;

        use d2rmm_agent_core::ports::{ReadError, Rgba, TextReader};
        use d2rmm_agent_domain::language::LanguagePack;
        use d2rmm_agent_domain::vision::{ReadText, Region, TextLine};

        use super::super::card_field_stats;
        use crate::ocr_check::MAINTAINER_CARDS;

        /// Reads the card column as two cards (a name and a level line each) and every field region as `field`.
        struct Column {
            field: &'static str,
        }

        impl TextReader for Column {
            fn read(&self, _image: &Rgba, _region: Region) -> Result<ReadText, ReadError> {
                Ok(ReadText {
                    text: self.field.to_string(),
                    confidence: 1.0,
                })
            }

            fn read_lines(&self, _image: &Rgba, region: Region) -> Vec<TextLine> {
                let line = |text: &str, row: u32| TextLine {
                    text: text.to_string(),
                    region: Region {
                        x: region.x,
                        y: region.y + row,
                        width: region.width,
                        height: 20,
                    },
                };
                vec![
                    line("vukVuka", 100),
                    line("Level 88 Sorceress", 130),
                    line("vukaDao", 300),
                    line("Level 11 Sorceress", 330),
                ]
            }
        }

        fn frame() -> Rgba {
            Rgba {
                width: 1920,
                height: 1033,
                pixels: Vec::new(),
            }
        }

        #[test]
        fn each_card_slot_reports_its_name_level_and_title_agreement_without_any_text() {
            let reader: Arc<dyn TextReader + Send + Sync> = Arc::new(Column {
                field: "Level 88 Sorceress",
            });
            let got = card_field_stats(
                &*reader,
                &frame(),
                &LanguagePack::english(),
                &MAINTAINER_CARDS,
            );
            assert!(!got.is_empty(), "the two cards are found by their level");
            let level = got
                .iter()
                .find(|f| f.slot == 0 && f.field == "level")
                .expect("a level entry for slot 0");
            assert_eq!(level.variants, 1);
            assert_eq!((level.top, level.expected), (1, 1));
            assert!(level.settled_expected);
            let name = got
                .iter()
                .find(|f| f.slot == 0 && f.field == "name")
                .expect("a name entry for slot 0");
            assert_eq!(name.unparsed, 1, "a level text is no character name");
            assert!(!name.settled);
            assert!(got.iter().any(|f| f.field.starts_with("title")));
        }

        #[test]
        fn a_frame_of_an_unsupported_size_has_no_card_column() {
            let tiny = Rgba {
                width: 100,
                height: 100,
                pixels: Vec::new(),
            };
            let reader = Column { field: "" };
            assert!(
                card_field_stats(&reader, &tiny, &LanguagePack::english(), &MAINTAINER_CARDS)
                    .is_empty()
            );
        }
    }
}
