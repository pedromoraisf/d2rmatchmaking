//! The language packs the app ships as JSON (AGN-08, ADR 027): `{ "language": "en", "words": { "party": "Party", … } }`.
//! The domain holds the pack and its rules; this file parses the file, so the domain stays free of serialisation.

use std::collections::BTreeMap;

use d2rmm_agent_domain::language::{LanguagePack, PackError};
use serde::Deserialize;

/// The shape of a pack file. Unknown fields are refused, so a misspelt key cannot pass as a missing word.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct PackFile {
    language: String,
    words: BTreeMap<String, String>,
}

/// Why a pack file is refused.
#[derive(Debug, thiserror::Error)]
pub enum PackFileError {
    #[error("the file is not a language pack")]
    Malformed,
    #[error(transparent)]
    Pack(#[from] PackError),
}

/// Parses one pack file into the domain's pack.
pub fn parse_pack(text: &str) -> Result<LanguagePack, PackFileError> {
    let file: PackFile = serde_json::from_str(text).map_err(|_| PackFileError::Malformed)?;
    Ok(LanguagePack::from_words(file.language, file.words)?)
}

#[cfg(test)]
mod tests {
    use d2rmm_agent_domain::language::{LanguagePack, PARTY, PackError};

    use super::{PackFileError, parse_pack};

    const ENGLISH_JSON: &str = r#"{
        "language": "en",
        "words": { "party": "Party", "gameName": "Game Name", "password": "Password" }
    }"#;

    #[test]
    fn the_english_file_parses_to_the_built_in_pack() {
        let parsed = parse_pack(ENGLISH_JSON).expect("the English file parses");
        assert_eq!(parsed, LanguagePack::english());
    }

    #[test]
    fn a_file_without_a_required_word_is_refused() {
        let text =
            r#"{ "language": "en", "words": { "party": "Party", "gameName": "Game Name" } }"#;
        assert!(matches!(
            parse_pack(text),
            Err(PackFileError::Pack(PackError::MissingWord(_)))
        ));
    }

    #[test]
    fn a_misspelt_key_is_refused_as_an_unknown_field() {
        let text = r#"{ "language": "en", "word": { "party": "Party" } }"#;
        assert!(matches!(parse_pack(text), Err(PackFileError::Malformed)));
    }

    #[test]
    fn text_that_is_not_json_is_refused() {
        assert!(matches!(
            parse_pack("party=Party"),
            Err(PackFileError::Malformed)
        ));
    }

    #[test]
    fn a_portuguese_file_adds_words_and_no_rule() {
        let text = r#"{
            "language": "pt-BR",
            "words": { "party": "Grupo", "gameName": "Nome do Jogo", "password": "Senha" }
        }"#;
        let pack = parse_pack(text).expect("the Portuguese file parses");
        assert_eq!(pack.tag(), "pt-BR");
        assert_eq!(pack.word(PARTY), Some("Grupo"));
    }
}
