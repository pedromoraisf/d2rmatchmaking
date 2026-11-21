//! The language packs the agent ships (AGN-02, AGN-08): `resources/lang/en.json` and `resources/lang/pt-BR.json`, embedded in
//! the binary and parsed with the adapters' reader. The domain's built-in English pack is the fallback when its file does not
//! parse, and a test pins the two to the same words, so the fallback never differs from the file. The pt-BR file holds the
//! Party panel's words of a Brazilian client only (screen-recognition T6, SCR-04).

use d2rmm_agent_adapters::language::{PackFileError, parse_pack};
use d2rmm_agent_domain::language::LanguagePack;

/// The English pack file, embedded at build time.
pub const ENGLISH_JSON: &str = include_str!("../resources/lang/en.json");

/// The Brazilian Portuguese pack file, embedded at build time.
pub const PORTUGUESE_JSON: &str = include_str!("../resources/lang/pt-BR.json");

/// The English pack the file holds.
pub fn shipped_english() -> Result<LanguagePack, PackFileError> {
    parse_pack(ENGLISH_JSON)
}

/// The Brazilian Portuguese pack the file holds.
pub fn shipped_portuguese() -> Result<LanguagePack, PackFileError> {
    parse_pack(PORTUGUESE_JSON)
}

/// The pack the agent reads with: English, with the Brazilian words as the Party step's fallback. A file that does not parse
/// leaves its pack out (the built-in English words stand in for the English one).
pub fn shipped() -> LanguagePack {
    let english = shipped_english().unwrap_or_else(|_| LanguagePack::english());
    match shipped_portuguese() {
        Ok(portuguese) => english.with_fallback(portuguese),
        Err(_) => english,
    }
}

#[cfg(test)]
mod tests {
    use d2rmm_agent_domain::language::{GAME_NAME, LanguagePack, PARTY, PASSWORD};

    use super::{shipped, shipped_english, shipped_portuguese};

    #[test]
    fn the_shipped_english_file_is_the_built_in_pack() {
        assert_eq!(
            shipped_english().expect("the shipped English pack parses"),
            LanguagePack::english()
        );
    }

    #[test]
    fn the_shipped_brazilian_file_is_the_three_measured_party_words() {
        let words = [(PARTY, "Grupo"), (GAME_NAME, "Nome"), (PASSWORD, "Senha")]
            .map(|(key, word)| (key.to_string(), word.to_string()));
        assert_eq!(
            shipped_portuguese().expect("the shipped Brazilian pack parses"),
            LanguagePack::from_words("pt-BR", words).expect("the pack builds")
        );
    }

    #[test]
    fn the_pack_the_agent_reads_with_is_english_with_the_brazilian_fallback() {
        let pack = shipped();
        assert_eq!(pack.tag(), "en");
        assert_eq!(pack.word(PARTY), Some("Party"));
        let fallback = pack.fallback().expect("the Brazilian fallback");
        assert_eq!(fallback.tag(), "pt-BR");
        assert!(fallback.party_panel_open("GRUPO"));
        assert!(
            !pack.party_panel_open("GRUPO"),
            "English alone does not read it"
        );
    }
}
