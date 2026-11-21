//! The remote configuration's rule (remote-config RCF-05, RCF-06, RCF-07, RCF-10; ADR 010): the API serves data, and the agent
//! decides what to do with it. `from_wire` turns what an adapter read from the body into the `Effective` configuration the
//! loops read: every number is clamped into a range that belongs to the agent, every phrase and region that fails its rule
//! is dropped, a section that cannot be read falls back to the built-in default field by field, and a version that does not
//! grow keeps what the agent holds. Pure: no clock, no randomness, no I/O, no JSON (the adapter reads the body).
//!
//! No field is a command, a path, a URL, a script, a key or a pattern. A phrase is a literal the existing rules compare; a
//! region is four fractions of the client. `FIELDS` lists every field the agent reads, and a source-rule test fails when
//! the list grows until the change is reviewed (RCF-10).

use crate::capture_cascade::{DEMOTE_AFTER, PROBE_EVERY, RATE_WINDOW};

/// A body over this many bytes is refused whole (RCF-02, RCF-06). The API's own limit is the same number.
pub const MAX_BODY_BYTES: usize = 64 * 1024;

/// The longest phrase, in characters (RCF-03).
pub const PHRASE_MAX_CHARS: usize = 40;

/// The smallest side of a region, as a fraction of the client: under it the region reads nothing (RCF-05).
pub const REGION_MIN_SIDE: f64 = 0.02;

/// The look interval today, in milliseconds (`watch_screen::TICK`): one look a second (CHR-03).
pub const LOOK_INTERVAL_DEFAULT_MS: u32 = 1000;

/// The padding around the HUD track today, in pixels of the reference client (`hud_track::TRACK_PAD`).
pub const TRACK_PAD_DEFAULT: u32 = 24;

/// Every field of the configuration the agent reads, by its wire name (RCF-10); a region is four fractions `x`, `y`, `width`
/// and `height`. A new field needs a review.
pub const FIELDS: [&str; 15] = [
    "version",
    "cadence.demoteAfter",
    "cadence.probeEvery",
    "cadence.rateWindow",
    "cadence.lookIntervalMs",
    "thresholds.trackPad",
    "regions.hudBand",
    "regions.automapArea",
    "regions.partyArea",
    "phrases.en.party",
    "phrases.en.gameName",
    "phrases.en.password",
    "phrases.pt-BR.party",
    "phrases.pt-BR.gameName",
    "phrases.pt-BR.password",
];

/// The interval the agent accepts for one number, inclusive. Never read from the server.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Range {
    pub min: u32,
    pub max: u32,
}

impl Range {
    /// `value` moved into the range; a value under it becomes the minimum, one over it the maximum.
    pub fn clamp(self, value: f64) -> u32 {
        if value.is_nan() || value <= f64::from(self.min) {
            return self.min;
        }
        if value >= f64::from(self.max) {
            return self.max;
        }
        // Inside the range, so it fits a u32; a fraction rounds down.
        value.floor() as u32
    }
}

/// The agent's own limits (RCF-05, RCF-09). Every extreme keeps the call counts of the capture cascade and the reading within
/// today's: the look interval never goes under one second, the probe cadence never under today's sixty looks.
pub struct Ranges;

impl Ranges {
    pub const DEMOTE_AFTER: Range = Range { min: 1, max: 10 };
    pub const PROBE_EVERY: Range = Range { min: 60, max: 600 };
    pub const RATE_WINDOW: Range = Range { min: 10, max: 600 };
    pub const LOOK_INTERVAL_MS: Range = Range {
        min: 1000,
        max: 10_000,
    };
    pub const TRACK_PAD: Range = Range { min: 8, max: 48 };
    /// A whole version number the agent takes.
    pub const VERSION_MAX: u32 = 2_147_483_647;
}

/// A reading area as fractions of the reference client.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Area {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// The words of one language the reading looks for. `None` is the built-in word.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Words {
    pub party: Option<String>,
    pub game_name: Option<String>,
    pub password: Option<String>,
}

impl Words {
    fn is_configured(&self) -> bool {
        self.party.is_some() || self.game_name.is_some() || self.password.is_some()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Cadence {
    pub demote_after: u32,
    pub probe_every: u32,
    pub rate_window: u32,
    pub look_interval_ms: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Thresholds {
    pub track_pad: u32,
}

/// `None` is the built-in area.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct Regions {
    pub hud_band: Option<Area>,
    pub automap_area: Option<Area>,
    pub party_area: Option<Area>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Phrases {
    pub en: Words,
    pub pt_br: Words,
}

impl Phrases {
    /// Whether any phrase is configured (the headless agent prints `configured` or `built-in`).
    pub fn is_configured(&self) -> bool {
        self.en.is_configured() || self.pt_br.is_configured()
    }
}

/// What the loops read: a value, never a body (design § Principle).
#[derive(Debug, Clone, PartialEq)]
pub struct Effective {
    /// `0` is the built-in defaults.
    pub version: u32,
    pub cadence: Cadence,
    pub thresholds: Thresholds,
    pub regions: Regions,
    pub phrases: Phrases,
}

impl Effective {
    /// The built-in defaults: the constants the agent has today (RCF-07).
    pub const fn built_in() -> Self {
        Self {
            version: 0,
            cadence: Cadence {
                demote_after: DEMOTE_AFTER,
                probe_every: PROBE_EVERY,
                rate_window: RATE_WINDOW as u32,
                look_interval_ms: LOOK_INTERVAL_DEFAULT_MS,
            },
            thresholds: Thresholds {
                track_pad: TRACK_PAD_DEFAULT,
            },
            regions: Regions {
                hud_band: None,
                automap_area: None,
                party_area: None,
            },
            phrases: Phrases {
                en: Words {
                    party: None,
                    game_name: None,
                    password: None,
                },
                pt_br: Words {
                    party: None,
                    game_name: None,
                    password: None,
                },
            },
        }
    }
}

impl Default for Effective {
    fn default() -> Self {
        Self::built_in()
    }
}

/// What an adapter read from the body, field by field: a field of the wrong type, or absent, is `None`. Numbers arrive as the
/// body wrote them, so a value outside its range reaches `from_wire` untouched. Unknown fields are not carried.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Wire {
    pub version: Option<f64>,
    pub demote_after: Option<f64>,
    pub probe_every: Option<f64>,
    pub rate_window: Option<f64>,
    pub look_interval_ms: Option<f64>,
    pub track_pad: Option<f64>,
    pub hud_band: Option<WireArea>,
    pub automap_area: Option<WireArea>,
    pub party_area: Option<WireArea>,
    pub en: WireWords,
    pub pt_br: WireWords,
}

#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct WireArea {
    pub x: Option<f64>,
    pub y: Option<f64>,
    pub width: Option<f64>,
    pub height: Option<f64>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct WireWords {
    pub party: Option<String>,
    pub game_name: Option<String>,
    pub password: Option<String>,
}

/// What a body came to against the version the agent holds (RCF-06, RCF-11).
#[derive(Debug, Clone, PartialEq)]
pub enum Verdict {
    /// A newer version: this is what the agent runs from now on.
    Applied(Box<Effective>),
    /// The same version: nothing changes.
    Unchanged,
    /// An older version: the agent keeps what it holds.
    Stale,
    /// The body could not be used (not JSON, over the limit, a version that is not a whole number).
    Invalid,
}

impl Verdict {
    /// The fixed word of `config.outcome` (RCF-11).
    pub const fn word(&self) -> &'static str {
        match self {
            Self::Applied(_) => "applied",
            Self::Unchanged => "unchanged",
            Self::Stale => "stale",
            Self::Invalid => "invalid",
        }
    }
}

/// The version rule and the clamping of one body. `wire` is `None` when the body was not JSON or was over `MAX_BODY_BYTES`.
pub fn from_wire(wire: Option<&Wire>, held_version: u32) -> Verdict {
    let Some(wire) = wire else {
        return Verdict::Invalid;
    };
    let Some(version) = whole_version(wire.version) else {
        return Verdict::Invalid;
    };
    if version < held_version {
        return Verdict::Stale;
    }
    if version == held_version {
        return Verdict::Unchanged;
    }
    Verdict::Applied(Box::new(effective_of(wire, version)))
}

/// The body size rule: whether a body of this many bytes may be read at all.
pub const fn body_fits(len: usize) -> bool {
    len <= MAX_BODY_BYTES
}

fn whole_version(version: Option<f64>) -> Option<u32> {
    let version = version?;
    if !version.is_finite() || version.fract() != 0.0 {
        return None;
    }
    if version < 1.0 || version > f64::from(Ranges::VERSION_MAX) {
        return None;
    }
    // Whole and inside 1..=VERSION_MAX, so it fits.
    Some(version as u32)
}

fn effective_of(wire: &Wire, version: u32) -> Effective {
    let built_in = Effective::built_in();
    let take =
        |value: Option<f64>, range: Range, default: u32| value.map_or(default, |v| range.clamp(v));
    Effective {
        version,
        cadence: Cadence {
            demote_after: take(
                wire.demote_after,
                Ranges::DEMOTE_AFTER,
                built_in.cadence.demote_after,
            ),
            probe_every: take(
                wire.probe_every,
                Ranges::PROBE_EVERY,
                built_in.cadence.probe_every,
            ),
            rate_window: take(
                wire.rate_window,
                Ranges::RATE_WINDOW,
                built_in.cadence.rate_window,
            ),
            look_interval_ms: take(
                wire.look_interval_ms,
                Ranges::LOOK_INTERVAL_MS,
                built_in.cadence.look_interval_ms,
            ),
        },
        thresholds: Thresholds {
            track_pad: take(
                wire.track_pad,
                Ranges::TRACK_PAD,
                built_in.thresholds.track_pad,
            ),
        },
        regions: Regions {
            hud_band: wire.hud_band.and_then(area_of),
            automap_area: wire.automap_area.and_then(area_of),
            party_area: wire.party_area.and_then(area_of),
        },
        phrases: Phrases {
            en: words_of(&wire.en),
            pt_br: words_of(&wire.pt_br),
        },
    }
}

/// A region only when all four fractions are there, lie inside the client and the sides reach the minimum (RCF-05).
fn area_of(wire: WireArea) -> Option<Area> {
    let area = Area {
        x: wire.x?,
        y: wire.y?,
        width: wire.width?,
        height: wire.height?,
    };
    let finite = [area.x, area.y, area.width, area.height]
        .iter()
        .all(|value| value.is_finite());
    let inside = (0.0..=1.0).contains(&area.x)
        && (0.0..=1.0).contains(&area.y)
        && area.width <= 1.0
        && area.height <= 1.0
        && area.x + area.width <= 1.0
        && area.y + area.height <= 1.0;
    let large = area.width >= REGION_MIN_SIDE && area.height >= REGION_MIN_SIDE;
    (finite && inside && large).then_some(area)
}

fn words_of(wire: &WireWords) -> Words {
    Words {
        party: wire.party.as_deref().and_then(phrase_of),
        game_name: wire.game_name.as_deref().and_then(phrase_of),
        password: wire.password.as_deref().and_then(phrase_of),
    }
}

/// A phrase only when it is 1 to `PHRASE_MAX_CHARS` characters of letters (Latin-1 letters included), digits and spaces, with
/// at least one that is not a space: no punctuation, so no pattern, escape, command, path or URL can be written (RCF-10).
fn phrase_of(text: &str) -> Option<String> {
    let chars = text.chars().count();
    if chars == 0 || chars > PHRASE_MAX_CHARS {
        return None;
    }
    let plain = text
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == ' ' || is_latin1_letter(c));
    (plain && text.chars().any(|c| c != ' ')).then(|| text.to_string())
}

/// `À-ÖØ-öø-ÿ`, the contract's character class.
const fn is_latin1_letter(c: char) -> bool {
    matches!(c, '\u{C0}'..='\u{D6}' | '\u{D8}'..='\u{F6}' | '\u{F8}'..='\u{FF}')
}

#[cfg(test)]
mod tests {
    use super::*;

    fn wire(version: f64) -> Wire {
        Wire {
            version: Some(version),
            ..Wire::default()
        }
    }

    fn applied(wire: &Wire) -> Effective {
        match from_wire(Some(wire), 0) {
            Verdict::Applied(effective) => *effective,
            other => panic!("expected applied, got {other:?}"),
        }
    }

    #[test]
    fn the_built_in_defaults_are_the_constants_the_agent_has_today() {
        let built_in = Effective::built_in();
        assert_eq!(built_in.version, 0);
        assert_eq!(built_in.cadence.demote_after, 3);
        assert_eq!(built_in.cadence.probe_every, 60);
        assert_eq!(built_in.cadence.rate_window, 60);
        assert_eq!(built_in.cadence.look_interval_ms, 1000);
        assert_eq!(built_in.thresholds.track_pad, 24);
        assert_eq!(built_in.regions, Regions::default());
        assert!(!built_in.phrases.is_configured());
        assert_eq!(Effective::default(), built_in);
    }

    #[test]
    fn an_empty_document_applies_the_defaults_under_its_version() {
        let effective = applied(&wire(2.0));
        assert_eq!(
            effective,
            Effective {
                version: 2,
                ..Effective::built_in()
            }
        );
    }

    #[test]
    fn the_ranges_are_the_agents_own() {
        assert_eq!(Ranges::DEMOTE_AFTER, Range { min: 1, max: 10 });
        assert_eq!(Ranges::PROBE_EVERY, Range { min: 60, max: 600 });
        assert_eq!(Ranges::RATE_WINDOW, Range { min: 10, max: 600 });
        assert_eq!(
            Ranges::LOOK_INTERVAL_MS,
            Range {
                min: 1000,
                max: 10_000
            }
        );
        assert_eq!(Ranges::TRACK_PAD, Range { min: 8, max: 48 });
        assert_eq!(Ranges::VERSION_MAX, 2_147_483_647);
    }

    /// Each number field, at, under and over both of its edges: the value is clamped, never obeyed (RCF-05).
    #[test]
    fn every_number_is_clamped_at_each_edge() {
        type Set = fn(&mut Wire, f64);
        type Get = fn(&Effective) -> u32;
        let fields: [(Range, Set, Get); 5] = [
            (
                Ranges::DEMOTE_AFTER,
                |w, v| w.demote_after = Some(v),
                |e| e.cadence.demote_after,
            ),
            (
                Ranges::PROBE_EVERY,
                |w, v| w.probe_every = Some(v),
                |e| e.cadence.probe_every,
            ),
            (
                Ranges::RATE_WINDOW,
                |w, v| w.rate_window = Some(v),
                |e| e.cadence.rate_window,
            ),
            (
                Ranges::LOOK_INTERVAL_MS,
                |w, v| w.look_interval_ms = Some(v),
                |e| e.cadence.look_interval_ms,
            ),
            (
                Ranges::TRACK_PAD,
                |w, v| w.track_pad = Some(v),
                |e| e.thresholds.track_pad,
            ),
        ];
        for (range, set, get) in fields {
            let (min, max) = (f64::from(range.min), f64::from(range.max));
            for (sent, used) in [
                (min - 1.0, range.min),
                (min, range.min),
                (min + 1.0, range.min + 1),
                (max - 1.0, range.max - 1),
                (max, range.max),
                (max + 1.0, range.max),
                (100_000.0, range.max),
                (-5.0, range.min),
                (0.0, range.min),
                (f64::INFINITY, range.max),
                (f64::NEG_INFINITY, range.min),
                (f64::NAN, range.min),
            ] {
                let mut body = wire(2.0);
                set(&mut body, sent);
                assert_eq!(get(&applied(&body)), used, "{range:?} sent {sent}");
            }
        }
    }

    #[test]
    fn a_fraction_rounds_down_inside_the_range() {
        let mut body = wire(2.0);
        body.probe_every = Some(120.9);
        assert_eq!(applied(&body).cadence.probe_every, 120);
    }

    #[test]
    fn the_look_interval_never_goes_under_one_second() {
        for sent in [0.0, 1.0, 500.0, 999.0, -1000.0] {
            let mut body = wire(2.0);
            body.look_interval_ms = Some(sent);
            assert!(applied(&body).cadence.look_interval_ms >= 1000, "{sent}");
        }
    }

    #[test]
    fn a_missing_number_keeps_its_default_and_the_rest_still_applies() {
        let mut body = wire(2.0);
        body.probe_every = Some(120.0);
        let effective = applied(&body);
        assert_eq!(effective.cadence.probe_every, 120);
        assert_eq!(effective.cadence.demote_after, 3);
        assert_eq!(effective.cadence.rate_window, 60);
        assert_eq!(effective.cadence.look_interval_ms, 1000);
        assert_eq!(effective.thresholds.track_pad, 24);
    }

    fn words(text: &str) -> WireWords {
        WireWords {
            party: Some(text.to_string()),
            ..WireWords::default()
        }
    }

    fn party_in_english(text: &str) -> Option<String> {
        let mut body = wire(2.0);
        body.en = words(text);
        applied(&body).phrases.en.party
    }

    #[test]
    fn a_plain_phrase_is_taken_in_each_language() {
        let mut body = wire(2.0);
        body.en = WireWords {
            party: Some("Party".into()),
            game_name: Some("Game Name".into()),
            password: Some("Password".into()),
        };
        body.pt_br = words("Grupo Açaí 2");
        let effective = applied(&body);
        assert_eq!(effective.phrases.en.party.as_deref(), Some("Party"));
        assert_eq!(effective.phrases.en.game_name.as_deref(), Some("Game Name"));
        assert_eq!(effective.phrases.en.password.as_deref(), Some("Password"));
        assert_eq!(
            effective.phrases.pt_br.party.as_deref(),
            Some("Grupo Açaí 2")
        );
        assert!(effective.phrases.is_configured());
    }

    #[test]
    fn a_phrase_with_a_forbidden_character_is_dropped() {
        for hostile in [
            "(a+)+$", "a.*", "a|b", "[a]", "a\\b", "a/b", "a:b", "a;b", "a\"b", "a'b", "a\nb",
            "a\tb", "a_b", "a-b", "a%b", "a{2}", "<b>", "a\u{0}b", "a\u{D7}b", "a\u{F7}b", "😀",
            "ａｂ",
        ] {
            assert_eq!(party_in_english(hostile), None, "{hostile:?}");
        }
    }

    #[test]
    fn a_phrase_is_one_to_forty_characters_with_one_that_is_not_a_space() {
        assert_eq!(party_in_english(""), None);
        assert_eq!(party_in_english("   "), None);
        assert_eq!(party_in_english("a").as_deref(), Some("a"));
        let at_the_limit = "a".repeat(PHRASE_MAX_CHARS);
        assert_eq!(party_in_english(&at_the_limit), Some(at_the_limit.clone()));
        assert_eq!(party_in_english(&"a".repeat(PHRASE_MAX_CHARS + 1)), None);
        // The limit counts characters, not bytes.
        let accents = "é".repeat(PHRASE_MAX_CHARS);
        assert_eq!(party_in_english(&accents), Some(accents.clone()));
    }

    #[test]
    fn a_dropped_phrase_leaves_the_other_phrases_and_sections_applied() {
        let mut body = wire(2.0);
        body.probe_every = Some(120.0);
        body.en = WireWords {
            party: Some("(a+)+$".into()),
            game_name: Some("Game Name".into()),
            password: None,
        };
        let effective = applied(&body);
        assert_eq!(effective.phrases.en.party, None);
        assert_eq!(effective.phrases.en.game_name.as_deref(), Some("Game Name"));
        assert_eq!(effective.cadence.probe_every, 120);
    }

    fn area(x: f64, y: f64, width: f64, height: f64) -> WireArea {
        WireArea {
            x: Some(x),
            y: Some(y),
            width: Some(width),
            height: Some(height),
        }
    }

    fn hud_band(area: WireArea) -> Option<Area> {
        let mut body = wire(2.0);
        body.hud_band = Some(area);
        applied(&body).regions.hud_band
    }

    #[test]
    fn a_region_inside_the_client_is_taken_as_is() {
        let taken = hud_band(area(0.1, 0.2, 0.5, 0.25)).expect("a region");
        assert_eq!(
            taken,
            Area {
                x: 0.1,
                y: 0.2,
                width: 0.5,
                height: 0.25
            }
        );
        assert!(
            hud_band(area(0.0, 0.0, 1.0, 1.0)).is_some(),
            "the whole client"
        );
        assert!(
            hud_band(area(0.98, 0.98, 0.02, 0.02)).is_some(),
            "the smallest, in the corner"
        );
    }

    #[test]
    fn a_region_outside_the_client_or_under_the_minimum_size_is_the_default() {
        for refused in [
            area(-0.01, 0.0, 0.5, 0.5),
            area(0.0, -0.01, 0.5, 0.5),
            area(1.01, 0.0, 0.5, 0.5),
            area(0.0, 1.01, 0.5, 0.5),
            area(0.6, 0.0, 0.5, 0.5),
            area(0.0, 0.6, 0.5, 0.5),
            area(0.0, 0.0, 1.01, 0.5),
            area(0.0, 0.0, 0.5, 1.01),
            area(0.1, 0.1, 0.019, 0.5),
            area(0.1, 0.1, 0.5, 0.019),
            area(0.1, 0.1, 0.0, 0.0),
            area(0.1, 0.1, -0.5, 0.5),
            area(f64::NAN, 0.1, 0.5, 0.5),
            area(0.1, 0.1, f64::INFINITY, 0.5),
            WireArea {
                x: None,
                ..area(0.1, 0.1, 0.5, 0.5)
            },
            WireArea {
                height: None,
                ..area(0.1, 0.1, 0.5, 0.5)
            },
        ] {
            assert_eq!(hud_band(refused), None, "{refused:?}");
        }
    }

    #[test]
    fn each_region_falls_back_on_its_own() {
        let mut body = wire(2.0);
        body.hud_band = Some(area(2.0, 0.0, 0.5, 0.5));
        body.automap_area = Some(area(0.1, 0.1, 0.5, 0.5));
        body.party_area = Some(area(0.2, 0.2, 0.3, 0.3));
        let regions = applied(&body).regions;
        assert_eq!(regions.hud_band, None);
        assert!(regions.automap_area.is_some());
        assert!(regions.party_area.is_some());
    }

    #[test]
    fn a_newer_version_is_applied() {
        assert!(
            matches!(from_wire(Some(&wire(6.0)), 5), Verdict::Applied(applied) if applied.version == 6)
        );
        assert!(
            matches!(from_wire(Some(&wire(1.0)), 0), Verdict::Applied(applied) if applied.version == 1)
        );
    }

    #[test]
    fn an_equal_version_changes_nothing() {
        assert_eq!(from_wire(Some(&wire(5.0)), 5), Verdict::Unchanged);
    }

    #[test]
    fn an_older_version_keeps_what_the_agent_holds() {
        assert_eq!(from_wire(Some(&wire(4.0)), 5), Verdict::Stale);
        assert_eq!(from_wire(Some(&wire(1.0)), 2_147_483_647), Verdict::Stale);
    }

    #[test]
    fn a_body_without_a_whole_version_is_invalid() {
        assert_eq!(
            from_wire(None, 0),
            Verdict::Invalid,
            "not JSON or too large"
        );
        let mut missing = Wire::default();
        assert_eq!(from_wire(Some(&missing), 0), Verdict::Invalid);
        for version in [
            0.0,
            -1.0,
            1.5,
            f64::NAN,
            f64::INFINITY,
            2_147_483_648.0,
            1e20,
        ] {
            missing.version = Some(version);
            assert_eq!(from_wire(Some(&missing), 0), Verdict::Invalid, "{version}");
        }
        missing.version = Some(2_147_483_647.0);
        assert!(matches!(from_wire(Some(&missing), 0), Verdict::Applied(_)));
    }

    #[test]
    fn an_invalid_body_never_changes_a_held_version_even_with_valid_fields() {
        let body = Wire {
            probe_every: Some(120.0),
            ..Wire::default()
        };
        assert_eq!(from_wire(Some(&body), 3), Verdict::Invalid);
    }

    #[test]
    fn the_size_limit_is_64_kib() {
        assert_eq!(MAX_BODY_BYTES, 65_536);
        assert!(body_fits(0));
        assert!(body_fits(65_536));
        assert!(!body_fits(65_537));
    }

    #[test]
    fn the_outcome_words_are_fixed() {
        assert_eq!(Verdict::Applied(Box::default()).word(), "applied");
        assert_eq!(Verdict::Unchanged.word(), "unchanged");
        assert_eq!(Verdict::Stale.word(), "stale");
        assert_eq!(Verdict::Invalid.word(), "invalid");
    }

    #[test]
    fn the_field_list_is_the_closed_set_the_agent_reads() {
        assert_eq!(FIELDS.len(), 15);
        assert!(FIELDS.contains(&"cadence.probeEvery"));
        assert!(!FIELDS.iter().any(|field| field.contains("command")
            || field.contains("path")
            || field.contains("url")
            || field.contains("script")
            || field.contains("pattern")));
    }

    /// RCF-09: the probe cadence never goes under today's sixty looks, so no configuration makes the cascade capture more than it
    /// does now (611 captures in 600 looks on the second method).
    #[test]
    fn the_probe_cadence_never_goes_under_today_s_sixty_looks() {
        for sent in [0.0, 1.0, 10.0, 30.0, 59.0, -5.0, f64::NEG_INFINITY] {
            let mut body = wire(2.0);
            body.probe_every = Some(sent);
            assert_eq!(applied(&body).cadence.probe_every, 60, "{sent}");
        }
        let mut body = wire(2.0);
        body.probe_every = Some(60.0);
        assert_eq!(applied(&body).cadence.probe_every, 60);
        body.probe_every = Some(61.0);
        assert_eq!(applied(&body).cadence.probe_every, 61);
    }
}
