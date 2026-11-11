//! The language pack the agent ships (AGN-02, AGN-08): `resources/lang/en.json`, embedded in the binary and parsed with the
//! adapters' reader. The domain's built-in English pack is the fallback when the file does not parse, and a test pins the two
//! to the same words, so the fallback never differs from the file.

use d2rmm_agent_adapters::language::{PackFileError, parse_pack};
use d2rmm_agent_domain::language::LanguagePack;

/// The English pack file, embedded at build time.
pub const ENGLISH_JSON: &str = include_str!("../resources/lang/en.json");

/// The English pack the file holds.
pub fn shipped_english() -> Result<LanguagePack, PackFileError> {
    parse_pack(ENGLISH_JSON)
}

#[cfg(test)]
mod tests {
    use d2rmm_agent_domain::language::LanguagePack;

    use super::shipped_english;

    #[test]
    fn the_shipped_english_file_is_the_built_in_pack() {
        assert_eq!(
            shipped_english().expect("the shipped English pack parses"),
            LanguagePack::english()
        );
    }
}
