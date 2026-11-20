//! Matching the game name the Party panel shows against the room's expected name (AGN-03, AGN-04). D2R draws the letter O as
//! `⊕` and zero as `Ø`, and OCR reads both as zero or as O, so each side is normalised the same way before the comparison:
//! before the last `-` the glyphs `0`, `Ø` and `⊕` mean the letter `o` (`mmcowsh`, `mmchaosn`), and after it `O`, `o`, `Ø`
//! and `⊕` mean the digit `0` (the level number, `mmchaosn-10`). The engine also reads the `⊕` as `b`, `e`, `9`, `@`, `®`,
//! `©`, `°`, `ö`, `ó`, `ò`, `ô`, `õ`, `θ`, `⊗`, `⊙`, `◎`, `○` or `◯`, so before the last `-` those mean `o` too. The small-caps `B` of `mmbaalh` is read as `8` (maintainer's live test,
//! 2026-11-19), and `b` already reads as `o` there, so before the last `-` `8` means `o` as well (after it `8` stays the
//! digit). It is a glyph
//! table, never an edit distance, and a unit test proves that no two names the API can generate (ADR 017) collide under it,
//! so a different room's name is still refused. A masked field (only `x` characters) is never compared.

/// What one reading of the Game Name field says about the room's game name.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FieldRead {
    /// The field shows the masked value: the player has not clicked the eye (AGN-04).
    Masked,
    /// The field shows the expected game name, after normalisation (AGN-03).
    Matched,
    /// The field shows a name that is not the expected one, or nothing readable (AGN-03: nothing is posted).
    Other,
}

/// Classifies one reading of the field against the expected game name. The caller reads the field only while the Party
/// panel is open, so an empty or blank reading means the field shows nothing readable: the masked value is drawn as dots
/// the engine may not read, so it counts as `Masked` (the player must reveal the name; nothing is posted). A blank
/// expected name is `Other`, never a match.
pub fn read_field(read: &str, expected: &str) -> FieldRead {
    if is_masked(read) || read.trim().is_empty() {
        return FieldRead::Masked;
    }
    if expected.trim().is_empty() {
        return FieldRead::Other;
    }
    if normalise(read) == normalise(expected) {
        FieldRead::Matched
    } else {
        FieldRead::Other
    }
}

/// Classifies several readings of the field (the OCR variants, characters-reading T21) against the expected game name. The
/// name is matched when any reading matches exactly after the normalisation above (no edit distance: a wrong name stays
/// refused); otherwise the field is masked when any reading is the mask, or when every reading is blank; otherwise it shows
/// another name. No reading at all is a blank field.
pub fn read_field_variants(reads: &[&str], expected: &str) -> FieldRead {
    let each: Vec<FieldRead> = reads
        .iter()
        .map(|read| read_field(read, expected))
        .collect();
    if each.contains(&FieldRead::Matched) {
        return FieldRead::Matched;
    }
    if reads.iter().any(|read| is_masked(read))
        || each.iter().all(|read| *read == FieldRead::Masked)
    {
        return FieldRead::Masked;
    }
    FieldRead::Other
}

/// Where the Game Name field's readings came from (T16).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FieldSource {
    /// The box under the "Game Name" label that was found: the field was located.
    Label,
    /// The line just under the found label: the field was located.
    LabelLine,
    /// The label was found by no OCR variant, so the fixed layout box was read: the field was not located.
    LayoutBox,
}

/// Classifies the readings of the Game Name field by where they were read. A field located by its label (`Label`,
/// `LabelLine`) follows `read_field_variants`, so a blank or `x`-only reading is `Masked`. A reading from the layout box
/// may only be `Matched` or, with positive evidence, `Masked`: an exact match of the room's expected name (after
/// normalisation) is self-validating wherever it is read, and a reading that is the mask itself (`x` characters only,
/// `is_masked`) shows the field is masked, so the player is asked to reveal the name. A blank box proves nothing, since
/// the box may be any part of the panel: from the layout box a blank or different reading, or no reading at all, is
/// `Other`, and nothing is posted. A match in any variant wins over a mask in another, as on the label path.
pub fn read_panel_field(source: FieldSource, reads: &[&str], expected: &str) -> FieldRead {
    match (source, read_field_variants(reads, expected)) {
        (FieldSource::LayoutBox, FieldRead::Matched) => FieldRead::Matched,
        (FieldSource::LayoutBox, _) if reads.iter().any(|read| is_masked(read)) => {
            FieldRead::Masked
        }
        (FieldSource::LayoutBox, _) => FieldRead::Other,
        (_, got) => got,
    }
}

/// Whether a reading is the masked value: one or more `x` characters and nothing else, after trimming (AGN-04).
pub fn is_masked(read: &str) -> bool {
    let trimmed = read.trim();
    !trimmed.is_empty() && trimmed.chars().all(|c| c == 'x' || c == 'X')
}

/// The normal form of a game name: trimmed, lower-cased, with the glyph rules of the module doc applied on each side of the
/// last `-`. A name without `-` is all letters.
pub fn normalise(name: &str) -> String {
    let lower = name.trim().to_lowercase();
    match lower.rfind('-') {
        Some(at) => {
            let letters = &lower[..at];
            let number = &lower[at + 1..];
            format!("{}-{}", letters_of(letters), digits_of(number))
        }
        None => letters_of(&lower),
    }
}

/// The part of a name before its last `-`: the glyphs of zero and the slashed zero, and the O drawn as `⊕` with every way
/// the engine reads it, read as `o`.
fn letters_of(part: &str) -> String {
    part.chars()
        .map(|c| match c {
            '0' | 'ø' | '⊕' | 'b' | '8' | 'e' | '9' | '@' | '®' | '©' | '°' | 'ö' | 'ó' | 'ò'
            | 'ô' | 'õ' | 'θ' | '⊗' | '⊙' | '◎' | '○' | '◯' => 'o',
            other => other,
        })
        .collect()
}

/// The part of a name after its last `-`: the letter O in every drawing reads as zero, and the letters l, I and the bar read as
/// one (a generated name holds only digits there, ADR 017, so the fold cannot turn one name into another).
fn digits_of(part: &str) -> String {
    part.chars()
        .map(|c| match c {
            'o' | 'ø' | '⊕' => '0',
            'l' | 'i' | '|' => '1',
            other => other,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{
        FieldRead, FieldSource, is_masked, normalise, read_field, read_field_variants,
        read_panel_field,
    };

    #[test]
    fn a_field_read_by_its_source() {
        let mask = "xxxxxxxx";
        let at = |source, reads: &[&str]| read_panel_field(source, reads, "mmcowsh-1");
        for source in [FieldSource::Label, FieldSource::LabelLine] {
            assert_eq!(at(source, &["", mask]), FieldRead::Masked, "label + mask");
            assert_eq!(at(source, &["", " "]), FieldRead::Masked, "label + blank");
            assert_eq!(at(source, &["mmcowsh-1"]), FieldRead::Matched);
            assert_eq!(at(source, &["mmcowsh-7"]), FieldRead::Other);
        }
        let layout = FieldSource::LayoutBox;
        assert_eq!(at(layout, &["", "mmcowsh-1"]), FieldRead::Matched);
        assert_eq!(at(layout, &["", " "]), FieldRead::Other, "layout + blank");
        assert_eq!(at(layout, &["", mask]), FieldRead::Masked, "layout + mask");
        assert_eq!(at(layout, &[mask, "mmcowsh-1"]), FieldRead::Matched);
        assert_eq!(at(layout, &["mmcowsh-7"]), FieldRead::Other);
        assert_eq!(at(layout, &[]), FieldRead::Other, "no field area at all");
    }

    #[test]
    fn the_crowded_glyph_pairs_match_their_expected_names() {
        // The glyph pairs of the design: the O of `cows` drawn as ⊕, the zero of `10` drawn as Ø or read as O.
        assert_eq!(read_field("MMC⊕WSH-1", "mmcowsh-1"), FieldRead::Matched);
        assert_eq!(read_field("MMCHA⊕SN-1Ø", "mmchaosn-10"), FieldRead::Matched);
        assert_eq!(read_field("MMCOWSH-1O", "mmcowsh-10"), FieldRead::Matched);
    }

    #[test]
    fn every_reading_the_engine_gives_the_circled_plus_matches_the_letter_o() {
        for glyph in [
            'b', 'e', '9', '@', '®', '©', '°', 'ö', 'ó', 'ò', 'ô', 'õ', 'θ', '⊗', '⊙', '◎', '○',
            '◯',
        ] {
            let read = format!("mmc{glyph}wsh-1");
            assert_eq!(
                read_field(&read, "mmcowsh-1"),
                FieldRead::Matched,
                "{glyph}"
            );
            assert_eq!(
                read_field(&read.to_uppercase(), "mmcowsh-1"),
                FieldRead::Matched,
                "{glyph} upper"
            );
        }
        // After the last `-` they are no zero: only the O glyphs are.
        assert_eq!(read_field("mmcowsh-1b", "mmcowsh-10"), FieldRead::Other);
        // A different letter is still another name.
        assert_eq!(read_field("mmcxwsh-1", "mmcowsh-1"), FieldRead::Other);
    }

    #[test]
    fn no_two_generated_room_names_collide_after_the_normalisation() {
        // `apps/api` lobby-room `GameName`: `mm{activity}{difficulty}-{n}`; activities of the glossary, difficulty codes
        // n, m, h (the API issues `h` today), n in 1..=99.
        let activities = [
            "baal", "chaos", "cows", "tz", "heralds", "duel1v1", "duel2v2", "arena6", "mephisto",
            "pvp",
        ];
        let mut seen = std::collections::HashMap::new();
        for activity in activities {
            for difficulty in ["n", "m", "h"] {
                for n in 1..=99 {
                    let name = format!("mm{activity}{difficulty}-{n}");
                    if let Some(other) = seen.insert(normalise(&name), name.clone()) {
                        panic!("{name} and {other} collide");
                    }
                }
            }
        }
    }

    #[test]
    fn another_number_does_not_match() {
        assert_eq!(read_field("mmcowsh-7", "mmcowsh-1"), FieldRead::Other);
        assert_eq!(read_field("mmbaalh-999", "mmbaalh-12"), FieldRead::Other);
    }

    #[test]
    fn the_masked_field_is_masked_and_never_matched() {
        assert_eq!(read_field("xxxxxxxxx", "mmcowsh-1"), FieldRead::Masked);
        assert_eq!(
            read_field("  xxxx ", "mmcowsh-1"),
            FieldRead::Masked,
            "trimmed first"
        );
        assert!(is_masked("XXXXXXXX"));
        assert!(!is_masked("xxx1"), "any other character is not masked");
        assert!(!is_masked(""), "an empty field is not masked by the x rule");
    }

    #[test]
    fn the_match_trims_and_ignores_case() {
        assert_eq!(read_field("  MMCOWSH-1 ", "mmcowsh-1"), FieldRead::Matched);
        assert_eq!(read_field("MmBaAlH-12", "mmbaalh-12"), FieldRead::Matched);
    }

    #[test]
    fn letters_before_the_dash_read_zero_and_slashed_zero_as_o() {
        assert_eq!(normalise("mm0wsh-1"), "mmowsh-1");
        assert_eq!(normalise("mmØwsh-1"), "mmowsh-1");
        assert_eq!(normalise("mm⊕wsh-1"), "mmowsh-1");
    }

    #[test]
    fn digits_after_the_dash_read_every_o_glyph_as_zero() {
        assert_eq!(normalise("mmbaalh-1O"), "mmoaalh-10");
        assert_eq!(normalise("mmbaalh-1o"), "mmoaalh-10");
        assert_eq!(normalise("mmbaalh-1Ø"), "mmoaalh-10");
        assert_eq!(normalise("mmbaalh-1⊕"), "mmoaalh-10");
    }

    #[test]
    fn a_name_without_a_dash_is_all_letters() {
        assert_eq!(normalise("DUEL NK L⊕CKS"), "duol nk locks");
        assert_eq!(
            read_field("DUEL NK L⊕CKS", "duel nk locks"),
            FieldRead::Matched
        );
    }

    #[test]
    fn an_empty_reading_is_masked_and_a_blank_expected_name_never_matches() {
        assert_eq!(
            read_field("", "mmcowsh-1"),
            FieldRead::Masked,
            "nothing readable is masked"
        );
        assert_eq!(
            read_field("   ", "mmcowsh-1"),
            FieldRead::Masked,
            "blank is masked"
        );
        assert_eq!(
            read_field("mmcowsh-1", ""),
            FieldRead::Other,
            "no expected name"
        );
    }

    #[test]
    fn the_digits_fold_l_i_and_bar_to_one_and_the_o_glyphs_to_zero_and_letters_are_untouched() {
        // Changed expectation (screen-recognition T6): after the last dash a letter l, I or | reads as the digit 1. It is
        // the first glyph rule driven by the pt-BR client (the read "mmPVPN-lØ" of mmpvpn-10, `ocr-real` run
        // 44709482062), taken from a real read as the game-name-reading rule allows.
        assert_eq!(read_field("mmpvpn-1O", "mmpvpn-10"), FieldRead::Matched);
        assert_eq!(read_field("mmPVPN-lØ", "mmpvpn-10"), FieldRead::Matched);
        assert_eq!(read_field("mmpvpn-I0", "mmpvpn-10"), FieldRead::Matched);
        assert_eq!(read_field("mmpvpn-|o", "mmpvpn-10"), FieldRead::Matched);
        // Letters before the dash are untouched: a real letter l stays an l, so a name with one is another name.
        assert_eq!(normalise("mmpvlN-10"), "mmpvln-10");
        assert_eq!(normalise("mmp|pn-10"), "mmp|pn-10");
        assert_eq!(read_field("mmpvln-10", "mmpvpn-10"), FieldRead::Other);
        assert_eq!(read_field("mmpvpn-l1", "mmpvpn-10"), FieldRead::Other);
    }

    #[test]
    fn no_two_different_names_collide_after_the_digit_fold_across_the_whole_vocabulary() {
        // ADR 017: `mm{activity}{difficulty}-{n}`. Each name, read with every digit as its fold glyph (1 as l, 0 as O), still
        // normalises to its own form and to no other name's.
        let activities = [
            "baal", "chaos", "cows", "tz", "heralds", "duel1v1", "duel2v2", "arena6", "mephisto",
            "pvp",
        ];
        let mut seen = std::collections::HashMap::new();
        for activity in activities {
            for difficulty in ["n", "m", "h"] {
                for n in 1..=9999u32 {
                    let name = format!("mm{activity}{difficulty}-{n}");
                    let glyphs: String = n
                        .to_string()
                        .chars()
                        .map(|digit| match digit {
                            '1' => 'l',
                            '0' => 'O',
                            other => other,
                        })
                        .collect();
                    let read = format!("mm{activity}{difficulty}-{glyphs}");
                    assert_eq!(normalise(&read), normalise(&name), "{read}");
                    if let Some(other) = seen.insert(normalise(&read), name.clone()) {
                        panic!("{name} and {other} collide after the fold");
                    }
                }
            }
        }
    }

    #[test]
    fn a_reading_one_character_off_does_not_match() {
        assert_eq!(read_field("mmcowsh-2", "mmcowsh-1"), FieldRead::Other);
        assert_eq!(read_field("mmcowsh-1x", "mmcowsh-1"), FieldRead::Other);
    }

    /// The maintainer's Windows OCR read "OUEL NK LBCKS" for the room "DUEL NK LOCKS" (2026-11-11). The compare is exact
    /// after normalisation, so a field with two wrong glyphs is refused; the threshold is not loosened to accept it (a
    /// wrong game name must stay refused). The upscale before the OCR is what fixes glyph accuracy.
    #[test]
    fn a_field_with_two_misread_glyphs_is_refused_at_the_current_threshold() {
        assert_eq!(
            read_field("OUEL NK LBCKS", "DUEL NK LOCKS"),
            FieldRead::Other
        );
        assert_eq!(
            read_field("DUEL NK LOCKS", "DUEL NK LOCKS"),
            FieldRead::Matched
        );
        assert_eq!(
            read_field("xxxxxxxxx", "DUEL NK LOCKS"),
            FieldRead::Masked,
            "the masked value is not a name"
        );
    }

    /// The first `ocr-real` run on the maintainer's Party screenshot (2026-11-11): the name is exact in one variant only.
    #[test]
    fn the_name_matches_when_any_variant_reads_it_exactly() {
        let reads = [
            "OUEL NK LBCKS",
            "OUEL NK L BCCS",
            "DUEL NK LOCKS",
            "DUEL NK LBCKS",
        ];
        assert_eq!(
            read_field_variants(&reads, "DUEL NK LOCKS"),
            FieldRead::Matched
        );
        let wrong = [reads[0], reads[1], "DUEL NK LACKS"];
        assert_eq!(
            read_field_variants(&wrong, "DUEL NK LOCKS"),
            FieldRead::Other,
            "no edit distance: a near name is refused"
        );
    }

    #[test]
    fn the_field_is_masked_when_any_variant_is_the_mask_or_all_are_blank() {
        let mask = "xxxxxxxxx";
        assert_eq!(
            read_field_variants(&[mask, mask, mask, mask], "mmcowsh-1"),
            FieldRead::Masked
        );
        assert_eq!(
            read_field_variants(&["", mask, "", ""], "mmcowsh-1"),
            FieldRead::Masked
        );
        assert_eq!(
            read_field_variants(&["", " "], "mmcowsh-1"),
            FieldRead::Masked
        );
        assert_eq!(
            read_field_variants(&[], "mmcowsh-1"),
            FieldRead::Masked,
            "nothing read is a blank field"
        );
        assert_eq!(
            read_field_variants(&["", "mmcowsh-7"], "mmcowsh-1"),
            FieldRead::Other
        );
    }

    #[test]
    fn a_name_one_letter_off_in_every_variant_is_never_matched() {
        let reads = [
            "DUEL NK LOCKX",
            "DUEL NK LOCKX",
            "DUEL NK LOCKX",
            "DUEL NK LOCKX",
        ];
        assert_ne!(
            read_field_variants(&reads, "DUEL NK LOCKS"),
            FieldRead::Matched
        );
        assert_eq!(
            read_field_variants(&reads, "DUEL NK LOCKS"),
            FieldRead::Other
        );
    }

    #[test]
    fn a_blank_expected_name_never_matches_in_any_variant() {
        assert_eq!(read_field_variants(&["abc", "abd"], " "), FieldRead::Other);
    }

    #[test]
    fn the_small_caps_b_read_as_eight_matches_before_the_dash_only() {
        assert_eq!(read_field("mm8aalh-19", "mmbaalh-19"), FieldRead::Matched);
        assert_eq!(read_field("MM8AALH-19", "mmbaalh-19"), FieldRead::Matched);
        assert_eq!(read_field("mm8aalm-99", "mmbaalm-99"), FieldRead::Matched);
        // After the last `-` the 8 stays the digit 8.
        assert_eq!(read_field("mmbaalh-18", "mmbaalh-18"), FieldRead::Matched);
        assert_eq!(read_field("mmbaalh-18", "mmbaalh-1b"), FieldRead::Other);
        assert_eq!(read_field("mmbaalh-18", "mmbaalh-10"), FieldRead::Other);
        assert_eq!(read_field("mmbaalh-1o", "mmbaalh-18"), FieldRead::Other);
        assert_eq!(read_field("mmcowsh-38", "mmcowsh-33"), FieldRead::Other);
        assert_eq!(normalise("mm8aalh-8"), "mmoaalh-8");
    }

    /// The activities and difficulty codes this agent is proven against, as the API issues them (lobby-room `GameName`).
    const AGENT_ACTIVITIES: [&str; 6] = ["baal", "chaos", "cows", "tz", "heralds", "pvp"];
    const AGENT_DIFFICULTY_CODES: [&str; 3] = ["n", "m", "h"];

    /// GNR-02 pin: the glyphs the table reads as the letter `o` before the last `-` (every one of them, in lower case).
    const LETTER_O_GLYPHS: [char; 22] = [
        '0', 'ø', '⊕', 'b', '8', 'e', '9', '@', '®', '©', '°', 'ö', 'ó', 'ò', 'ô', 'õ', 'θ', '⊗',
        '⊙', '◎', '○', '◯',
    ];

    #[test]
    fn every_glyph_of_the_letter_table_reads_as_o_before_the_dash_and_a_near_letter_does_not() {
        for glyph in LETTER_O_GLYPHS {
            assert_eq!(
                normalise(&format!("mmc{glyph}wsh-1")),
                "mmcowsh-1",
                "{glyph}"
            );
            assert_eq!(
                read_field(&format!("MMC{glyph}WSH-1"), "mmcowsh-1"),
                FieldRead::Matched,
                "{glyph} upper"
            );
            // The glyph in the letters part stands for `o` only: the name with another letter there is another name.
            assert_eq!(
                read_field(&format!("mmc{glyph}wsh-1"), "mmcawsh-1"),
                FieldRead::Other,
                "{glyph} is not an a"
            );
        }
        for near in ['a', 'c', 'q', 'x', 'l', '1', '6'] {
            assert_eq!(
                read_field(&format!("mmc{near}wsh-1"), "mmcowsh-1"),
                FieldRead::Other,
                "{near}"
            );
        }
    }

    #[test]
    fn every_glyph_of_the_digit_table_folds_after_the_dash_and_no_letter_glyph_does() {
        for zero in ['0', 'o', 'O', 'ø', 'Ø', '⊕'] {
            assert_eq!(
                normalise(&format!("mmcowsh-1{zero}")),
                "mmcowsh-10",
                "{zero}"
            );
        }
        for one in ['1', 'l', 'L', 'i', 'I', '|'] {
            assert_eq!(normalise(&format!("mmcowsh-{one}2")), "mmcowsh-12", "{one}");
        }
        // The glyphs the letters part reads as `o` stay themselves after the dash (8 and 9 are digits there).
        for stay in [
            'b', 'e', '@', '®', '©', '°', 'ö', 'ó', 'ò', 'ô', 'õ', 'θ', '⊗', '⊙', '◎', '○', '◯',
            '8', '9',
        ] {
            assert_eq!(
                normalise(&format!("mmcowsh-1{stay}")),
                format!("mmcowsh-1{stay}"),
                "{stay}"
            );
            assert_eq!(
                read_field(&format!("mmcowsh-1{stay}"), "mmcowsh-10"),
                FieldRead::Other,
                "{stay} is no zero"
            );
        }
    }

    #[test]
    fn a_name_of_another_difficulty_stays_other_in_both_directions() {
        // Pins `n` against `m`: the engine reads the two alike on some prints (`mmpvpn-10`, `mmbaalm-99`), the match must not.
        assert_eq!(read_field("mmpvpn-10", "mmpvpm-10"), FieldRead::Other);
        assert_eq!(read_field("mmpvpm-10", "mmpvpn-10"), FieldRead::Other);
        assert_eq!(read_field("mmbaalm-99", "mmbaaln-99"), FieldRead::Other);
        assert_eq!(read_field("mmbaaln-99", "mmbaalm-99"), FieldRead::Other);
        assert_eq!(read_field("mmbaalh-99", "mmbaalm-99"), FieldRead::Other);
        assert_eq!(read_field("mmbaalm-99", "mmbaalm-99"), FieldRead::Matched);
    }

    /// The seven generated names of the maintainer's Party prints (PR #87, `apps/agent/ocr-lab/README.md`).
    const PRINT_NAMES: [&str; 7] = [
        "mmbaalh-19",
        "mmchaosh-20",
        "mmcowsh-38",
        "mmtzh-47",
        "mmheraldsh-56",
        "mmpvpn-10",
        "mmbaalm-99",
    ];

    #[test]
    fn the_seven_print_names_normalise_to_distinct_forms() {
        let forms: std::collections::HashSet<String> =
            PRINT_NAMES.iter().map(|name| normalise(name)).collect();
        assert_eq!(forms.len(), PRINT_NAMES.len());
    }

    #[test]
    fn the_seven_print_names_equal_themselves_under_every_circled_plus_glyph() {
        for name in PRINT_NAMES {
            let (letters, number) = name.rsplit_once('-').expect("a generated name has a dash");
            for glyph in LETTER_O_GLYPHS {
                // Every `o` and `b` of the letters part stands for the same letter once the table has run.
                let drawn: String = letters
                    .chars()
                    .map(|c| if c == 'o' || c == 'b' { glyph } else { c })
                    .collect();
                let read = format!("{drawn}-{number}");
                assert_eq!(read_field(&read, name), FieldRead::Matched, "{read}");
                assert_eq!(normalise(&read), normalise(name), "{read}");
            }
            for zero in ['0', 'o', 'O', 'ø', 'Ø', '⊕'] {
                let read = format!("{letters}-{}", number.replace('0', &zero.to_string()));
                assert_eq!(read_field(&read, name), FieldRead::Matched, "{read}");
            }
            for other in PRINT_NAMES.iter().filter(|other| **other != name) {
                assert_eq!(read_field(other, name), FieldRead::Other, "{other}");
            }
        }
    }

    #[test]
    fn no_two_generated_names_collide_for_any_run_number_up_to_9999() {
        // The API's run number is a global sequence, not bounded by 99.
        let mut seen = std::collections::HashMap::new();
        for activity in AGENT_ACTIVITIES {
            for difficulty in AGENT_DIFFICULTY_CODES {
                for n in 1..=9999 {
                    let name = format!("mm{activity}{difficulty}-{n}");
                    if let Some(other) = seen.insert(normalise(&name), name.clone()) {
                        panic!("{name} and {other} collide");
                    }
                }
            }
        }
    }
}
