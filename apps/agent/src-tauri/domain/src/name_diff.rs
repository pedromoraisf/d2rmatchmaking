//! How a read of the Game Name field differs from the expected game name, as public-safe text for the diagnostics: the edit
//! operations of a Levenshtein backtrace, printed only through a fixed alphabet so a read never leaks a character that
//! could be a player's text. Pure and deterministic; the matching rule itself lives in `game_name_match` and is unchanged.

use crate::game_name_match::normalise;

/// How many edit operations the diagnostics print before saying the reading is far from the expected name.
pub const MAX_OPERATIONS: usize = 4;

/// The Levenshtein distance between two strings, in characters.
pub fn edit_distance(a: &str, b: &str) -> usize {
    let b: Vec<char> = b.chars().collect();
    let mut row: Vec<usize> = (0..=b.len()).collect();
    for (i, ca) in a.chars().enumerate() {
        let mut diagonal = row[0];
        row[0] = i + 1;
        for (j, cb) in b.iter().enumerate() {
            let above = row[j + 1];
            row[j + 1] = (diagonal + usize::from(ca != *cb))
                .min(row[j] + 1)
                .min(above + 1);
            diagonal = above;
        }
    }
    row[b.len()]
}

/// A character of a normalised read as it may be printed: `[a-z0-9 ]` as is, anything else as `?`.
pub fn printable(c: char) -> char {
    if c.is_ascii_lowercase() || c.is_ascii_digit() || c == ' ' {
        c
    } else {
        '?'
    }
}

/// `printable` for a game name: the dash prints too, `[a-z0-9 -]`.
pub fn printable_name(c: char) -> char {
    if c == '-' { c } else { printable(c) }
}

/// The edit operations that turn `read` into `expected` (a Levenshtein backtrace), in order of position in `expected`:
/// `sub(r>e)@i`, `del(r)@i`, `ins(e)@i`, where `i` indexes `expected`. Characters print through `printable`.
pub fn edit_operations(read: &str, expected: &str) -> Vec<String> {
    edit_operations_with(read, expected, printable)
}

/// `edit_operations` printing each character through `print`.
pub fn edit_operations_with(read: &str, expected: &str, print: fn(char) -> char) -> Vec<String> {
    let a: Vec<char> = read.chars().collect();
    let b: Vec<char> = expected.chars().collect();
    let mut d = vec![vec![0usize; b.len() + 1]; a.len() + 1];
    for (i, row) in d.iter_mut().enumerate() {
        row[0] = i;
    }
    for (j, cell) in d[0].iter_mut().enumerate() {
        *cell = j;
    }
    for i in 1..=a.len() {
        for j in 1..=b.len() {
            d[i][j] = (d[i - 1][j - 1] + usize::from(a[i - 1] != b[j - 1]))
                .min(d[i][j - 1] + 1)
                .min(d[i - 1][j] + 1);
        }
    }
    let (mut i, mut j) = (a.len(), b.len());
    let mut operations = Vec::new();
    while i > 0 || j > 0 {
        if i > 0 && j > 0 && a[i - 1] == b[j - 1] && d[i][j] == d[i - 1][j - 1] {
            i -= 1;
            j -= 1;
        } else if i > 0 && j > 0 && d[i][j] == d[i - 1][j - 1] + 1 {
            operations.push(format!(
                "sub({}>{})@{}",
                print(a[i - 1]),
                print(b[j - 1]),
                j - 1
            ));
            i -= 1;
            j -= 1;
        } else if i > 0 && d[i][j] == d[i - 1][j] + 1 {
            operations.push(format!("del({})@{j}", print(a[i - 1])));
            i -= 1;
        } else {
            operations.push(format!("ins({})@{}", print(b[j - 1]), j - 1));
            j -= 1;
        }
    }
    operations.reverse();
    operations
}

/// The edit operations of the closest non-blank reading (after `normalise` on both sides) against the expected name, joined
/// by commas, in the `[a-z0-9 -]` alphabet (anything else prints `?`). More than `MAX_OPERATIONS` edits, the text is `far`.
/// `None` when no reading has text.
pub fn closest_reading_diff(reads: &[&str], expected: &str) -> Option<String> {
    let expected = normalise(expected);
    let (distance, read) = reads
        .iter()
        .filter(|read| !read.trim().is_empty())
        .map(|read| normalise(read))
        .map(|read| (edit_distance(&read, &expected), read))
        .min_by_key(|(distance, _)| *distance)?;
    if distance > MAX_OPERATIONS {
        return Some("far".to_string());
    }
    let operations = edit_operations_with(&read, &expected, printable_name);
    Some(if operations.is_empty() {
        "same".to_string()
    } else {
        operations.join(",")
    })
}

#[cfg(test)]
mod tests {
    use super::{closest_reading_diff, edit_operations, edit_operations_with, printable_name};

    #[test]
    fn the_dash_prints_for_a_game_name_and_other_characters_print_a_question_mark() {
        assert_eq!(printable_name('-'), '-');
        assert_eq!(printable_name('a'), 'a');
        assert_eq!(printable_name('Z'), '?');
        assert_eq!(printable_name('|'), '?');
        assert_eq!(edit_operations("a-c", "abc"), ["sub(?>b)@1"]);
        assert_eq!(
            edit_operations_with("a-c", "abc", printable_name),
            ["sub(->b)@1"]
        );
    }

    #[test]
    fn the_closest_reading_names_its_edits_against_the_expected_name() {
        assert_eq!(
            closest_reading_diff(&["mmbaalh-1l"], "mmbaalh-19"),
            Some("sub(l>9)@9".to_string())
        );
        assert_eq!(
            closest_reading_diff(&["mmbaalh|19"], "mmbaalh-19"),
            // Without a dash the whole read is "letters", so the normaliser reads the 9 as an o too.
            Some("sub(?>-)@7,sub(o>9)@9".to_string())
        );
        assert_eq!(
            closest_reading_diff(&["mmbaalh 19"], "mmbaalh-19"),
            Some("sub( >-)@7,sub(o>9)@9".to_string())
        );
        assert_eq!(
            closest_reading_diff(&["mmbaalh-19"], "mmbaalh-19"),
            Some("same".to_string())
        );
    }

    #[test]
    fn the_closest_of_several_readings_wins_and_blank_ones_are_ignored() {
        assert_eq!(
            closest_reading_diff(&["", "zzzzzzzzzz", "mmbaalh-1l", "  "], "mmbaalh-19"),
            Some("sub(l>9)@9".to_string())
        );
        assert_eq!(closest_reading_diff(&["", "  "], "mmbaalh-19"), None);
        assert_eq!(closest_reading_diff(&[], "mmbaalh-19"), None);
    }

    #[test]
    fn up_to_the_cap_the_operations_print_and_beyond_it_says_far() {
        // Four edits print; five is far.
        let four = closest_reading_diff(&["mmbaxxxx-19"], "mmbaalh-19").unwrap();
        assert!(four.contains("sub(") && four != "far", "{four}");
        assert_eq!(
            closest_reading_diff(&["mmbaxxxxxx-19"], "mmbaalh-19"),
            Some("far".to_string())
        );
        assert_eq!(
            closest_reading_diff(&["qqqqqqqqqq"], "mmbaalh-19"),
            Some("far".to_string())
        );
    }
}
