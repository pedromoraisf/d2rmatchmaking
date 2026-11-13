//! Closed-vocabulary matching (characters-reading T19). The game draws its words in small caps and the OCR engine returns
//! them noisy ("LEWEL", "m ATRIARCH", "SBRCERESS"). A word on a card is one of a closed list (the classes, the titles, "Level",
//! the three difficulties), so the reader asks which entry the read is nearest to, and refuses to answer when it cannot tell:
//! a tie, or nothing within the threshold, is unknown. A misread never becomes a wrong value. No I/O, no clock.

/// The fewest edits a read may be from a word of `length` letters: none for three letters or fewer (`Sir`), one up to five,
/// two beyond.
pub fn threshold(length: usize) -> usize {
    match length {
        0..=3 => 0,
        4..=5 => 1,
        _ => 2,
    }
}

/// The comparison form of a read: upper case, with spaces, punctuation and digits dropped. `0`, `Ø` and `⊕` are the letter
/// O the game draws, and accents fold to their letter.
pub fn squash(text: &str) -> String {
    text.chars()
        .flat_map(char::to_uppercase)
        .filter_map(|c| match c {
            '0' | 'Ø' | '⊕' => Some('O'),
            'Á' | 'À' | 'Â' | 'Ã' | 'Ä' => Some('A'),
            'É' | 'È' | 'Ê' | 'Ë' => Some('E'),
            'Í' | 'Ì' | 'Î' | 'Ï' => Some('I'),
            'Ó' | 'Ò' | 'Ô' | 'Õ' | 'Ö' => Some('O'),
            'Ú' | 'Ù' | 'Û' | 'Ü' => Some('U'),
            'Ç' => Some('C'),
            other if other.is_alphabetic() => Some(other),
            _ => None,
        })
        .collect()
}

/// The Levenshtein distance between two texts, in characters.
pub fn edit_distance(a: &str, b: &str) -> usize {
    let b: Vec<char> = b.chars().collect();
    let mut previous: Vec<usize> = (0..=b.len()).collect();
    for (row, left) in a.chars().enumerate() {
        let mut current = vec![row + 1];
        for (column, right) in b.iter().enumerate() {
            let substitution = previous[column] + usize::from(left != *right);
            let insertion = current[column] + 1;
            let deletion = previous[column + 1] + 1;
            current.push(substitution.min(insertion).min(deletion));
        }
        previous = current;
    }
    previous[b.len()]
}

/// The glyph runs the engine reads as several letters for the game's `M`: two strokes and a foot (`RN`, `RT`, `RF`), or the
/// three vertical strokes of the small-caps `M` read as bars (`LLT`, `IIT`; the real read "GA me N AllTE" of "Game Name").
const COLLAPSES: [&str; 5] = ["RN", "RT", "RF", "LLT", "IIT"];

/// The forms of a squashed read to compare: itself, each single collapse of a `COLLAPSES` run to `M`, and all of them at once.
fn candidates(squashed: &str) -> Vec<String> {
    let mut forms = vec![squashed.to_string()];
    for pair in COLLAPSES {
        for (at, _) in squashed.match_indices(pair) {
            forms.push(format!(
                "{}M{}",
                &squashed[..at],
                &squashed[at + pair.len()..]
            ));
        }
    }
    let all = COLLAPSES
        .iter()
        .fold(squashed.to_string(), |text, pair| text.replace(pair, "M"));
    forms.push(all);
    forms.sort();
    forms.dedup();
    forms
}

/// The vocabulary entry a read is nearest to, or `None`. The read and the words are squashed; an entry qualifies when its
/// distance (the least over the read's collapse forms) is within `threshold` of its length; the nearest wins only when it is
/// the only entry at that distance.
pub fn nearest<T: Copy>(read: &str, vocabulary: &[(T, &str)]) -> Option<T> {
    let squashed = squash(read);
    if squashed.is_empty() {
        return None;
    }
    let forms = candidates(&squashed);
    let mut best: Option<(usize, T)> = None;
    let mut tied = false;
    for (key, word) in vocabulary {
        let word = squash(word);
        let Some(distance) = forms
            .iter()
            .map(|form| edit_distance(form, &word))
            .min()
            .filter(|distance| *distance <= threshold(word.chars().count()))
        else {
            continue;
        };
        match best {
            Some((nearest, _)) if distance > nearest => {}
            Some((nearest, _)) if distance == nearest => tied = true,
            _ => {
                best = Some((distance, *key));
                tied = false;
            }
        }
    }
    best.filter(|_| !tied).map(|(_, key)| key)
}

#[cfg(test)]
mod tests {
    use super::{edit_distance, nearest, squash, threshold};

    #[test]
    fn the_threshold_grows_with_the_length_of_the_word() {
        assert_eq!(threshold(3), 0);
        assert_eq!(threshold(4), 1);
        assert_eq!(threshold(5), 1);
        assert_eq!(threshold(6), 2);
        assert_eq!(threshold(11), 2);
    }

    #[test]
    fn a_read_is_squashed_to_upper_case_letters() {
        assert_eq!(squash("m A TRIARCH"), "MATRIARCH");
        assert_eq!(squash("S*acEREss"), "SACERESS");
        assert_eq!(squash("N0rmal"), "NORMAL");
        assert_eq!(squash("  "), "");
    }

    #[test]
    fn the_edit_distance_counts_each_insertion_deletion_and_substitution() {
        assert_eq!(edit_distance("", ""), 0);
        assert_eq!(edit_distance("ABC", ""), 3);
        assert_eq!(edit_distance("KITTEN", "SITTING"), 3);
        assert_eq!(edit_distance("LEVEL", "LEWEL"), 1);
    }

    const CLASSES: [(u8, &str); 3] = [(1, "Sorceress"), (2, "Necromancer"), (3, "Barbarian")];
    const NORMAL: [(u8, &str); 3] = [(1, "Normal"), (2, "Nightmare"), (3, "Hell")];

    #[test]
    fn the_real_reads_of_a_class_find_it() {
        for read in [
            "SBRCERESS",
            "Sa RCERESS",
            "SeRCERESS",
            "SGRCERESS",
            "RCERESS",
            "S*acEREss",
            "Sorceress",
        ] {
            assert_eq!(nearest(read, &CLASSES), Some(1), "{read:?}");
        }
    }

    #[test]
    fn the_real_reads_of_the_difficulties_find_them() {
        assert_eq!(nearest("NeRrnAL", &NORMAL), Some(1), "rn is an m");
        assert_eq!(nearest("NIGHTmARE", &NORMAL), Some(2));
        assert_eq!(nearest("N IGHTrnARE", &NORMAL), Some(2));
        assert_eq!(nearest("HELL", &NORMAL), Some(3));
        assert_eq!(nearest("NERMAL", &NORMAL), Some(1));
    }

    #[test]
    fn a_read_too_far_from_every_word_is_unknown() {
        assert_eq!(nearest("NeRtTIAL", &NORMAL), None, "too many edits");
        assert_eq!(nearest("N HTTTIARE", &NORMAL), None);
        assert_eq!(nearest("NIG", &NORMAL), None);
        assert_eq!(nearest("Wizard", &CLASSES), None);
        assert_eq!(nearest("", &CLASSES), None);
        assert_eq!(nearest("*-", &CLASSES), None, "no letter at all");
    }

    #[test]
    fn a_read_equidistant_from_two_words_is_unknown() {
        let near = [(1_u8, "Dame"), (2, "Duke")];
        assert_eq!(nearest("Dume", &near), None, "one edit from each");
        assert_eq!(nearest("Dame", &near), Some(1), "an exact word wins");
        let classes = [(1_u8, "Amazon"), (2, "Assassin"), (3, "Paladin")];
        assert_eq!(nearest("Amazon", &classes), Some(1));
    }

    #[test]
    fn a_word_of_three_letters_must_be_exact() {
        let titles = [(1_u8, "Sir")];
        assert_eq!(nearest("SIR", &titles), Some(1));
        assert_eq!(nearest("SIX", &titles), None);
    }

    #[test]
    fn a_longer_title_is_not_taken_for_its_shorter_one() {
        let titles = [(1_u8, "Count"), (2, "Countess")];
        assert_eq!(nearest("COUNTESS", &titles), Some(2));
        assert_eq!(nearest("COUNTES", &titles), Some(2));
        assert_eq!(nearest("COUNT", &titles), Some(1));
    }
}
