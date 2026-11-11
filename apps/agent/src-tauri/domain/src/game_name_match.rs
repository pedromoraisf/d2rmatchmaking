//! Matching the game name the Party panel shows against the room's expected name (AGN-03, AGN-04). D2R draws the letter O as
//! `⊕` and zero as `Ø`, and OCR reads both as zero or as O, so each side is normalised the same way before the comparison:
//! before the last `-` the glyphs `0`, `Ø` and `⊕` mean the letter `o` (`mmcowsh`, `mmchaosn`), and after it `O`, `o`, `Ø`
//! and `⊕` mean the digit `0` (the level number, `mmchaosn-10`). A masked field (only `x` characters) is never compared.

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

/// Classifies one reading of the field against the expected game name. An empty reading is `Other`, never a match.
pub fn read_field(read: &str, expected: &str) -> FieldRead {
    if is_masked(read) {
        return FieldRead::Masked;
    }
    if read.trim().is_empty() || expected.trim().is_empty() {
        return FieldRead::Other;
    }
    if normalise(read) == normalise(expected) {
        FieldRead::Matched
    } else {
        FieldRead::Other
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

/// The part of a name before its last `-`: the glyphs of zero and the slashed zero and the O drawn as `⊕` read as `o`.
fn letters_of(part: &str) -> String {
    part.chars()
        .map(|c| match c {
            '0' | 'ø' | '⊕' => 'o',
            other => other,
        })
        .collect()
}

/// The part of a name after its last `-`: the letter O in every drawing reads as zero.
fn digits_of(part: &str) -> String {
    part.chars()
        .map(|c| match c {
            'o' | 'ø' | '⊕' => '0',
            other => other,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{FieldRead, is_masked, normalise, read_field};

    #[test]
    fn the_crowded_glyph_pairs_match_their_expected_names() {
        // The glyph pairs of the design: the O of `cows` drawn as ⊕, the zero of `10` drawn as Ø or read as O.
        assert_eq!(read_field("MMC⊕WSH-1", "mmcowsh-1"), FieldRead::Matched);
        assert_eq!(read_field("MMCHA⊕SN-1Ø", "mmchaosn-10"), FieldRead::Matched);
        assert_eq!(read_field("MMCOWSH-1O", "mmcowsh-10"), FieldRead::Matched);
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
        assert!(!is_masked(""), "an empty field is not masked");
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
        assert_eq!(normalise("mmbaalh-1O"), "mmbaalh-10");
        assert_eq!(normalise("mmbaalh-1o"), "mmbaalh-10");
        assert_eq!(normalise("mmbaalh-1Ø"), "mmbaalh-10");
        assert_eq!(normalise("mmbaalh-1⊕"), "mmbaalh-10");
    }

    #[test]
    fn a_name_without_a_dash_is_all_letters() {
        assert_eq!(normalise("DUEL NK L⊕CKS"), "duel nk locks");
        assert_eq!(
            read_field("DUEL NK L⊕CKS", "duel nk locks"),
            FieldRead::Matched
        );
    }

    #[test]
    fn an_empty_reading_or_expected_name_never_matches() {
        assert_eq!(read_field("", "mmcowsh-1"), FieldRead::Other);
        assert_eq!(read_field("   ", "mmcowsh-1"), FieldRead::Other);
        assert_eq!(read_field("mmcowsh-1", ""), FieldRead::Other);
    }

    #[test]
    fn a_reading_one_character_off_does_not_match() {
        assert_eq!(read_field("mmcowsh-2", "mmcowsh-1"), FieldRead::Other);
        assert_eq!(read_field("mmcowsh-1x", "mmcowsh-1"), FieldRead::Other);
    }
}
