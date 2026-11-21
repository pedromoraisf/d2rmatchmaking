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
    use d2rmm_agent_domain::language::{
        GAME_NAME, JOINED_GAME, LEFT_GAME, LanguagePack, PARTY, PASSWORD,
    };

    use super::{shipped, shipped_english, shipped_portuguese};

    /// The shipped Portuguese file holds the Party words and the two chat phrases that were once held in code (rule 14).
    #[test]
    fn the_portuguese_file_holds_the_party_words_and_the_chat_phrases_of_the_brazilian_pack() {
        let file = shipped_portuguese().expect("the Brazilian file parses");
        assert_eq!(file.tag(), "pt-BR");
        assert_eq!(file.word(PARTY), Some("Grupo"));
        assert_eq!(file.word(GAME_NAME), Some("Nome"));
        assert_eq!(file.word(PASSWORD), Some("Senha"));
        assert_eq!(file.word(JOINED_GAME), Some("entrou em nosso mundo"));
        assert_eq!(file.word(LEFT_GAME), Some("saiu de nosso mundo"));
    }

    #[test]
    fn the_shipped_english_file_is_the_built_in_pack() {
        assert_eq!(
            shipped_english().expect("the shipped English pack parses"),
            LanguagePack::english()
        );
    }

    /// The words of the file: the Party words, the chat phrases, and the words read on the maintainer's pt-BR screenshots of
    /// 2026-11-21 (selection screen, difficulty popup, HUD). A class or title nobody has seen on a print is not here.
    #[test]
    fn the_shipped_brazilian_file_is_exactly_the_words_read_on_real_prints() {
        let words = [
            (PARTY, "Grupo"),
            (GAME_NAME, "Nome"),
            (PASSWORD, "Senha"),
            (JOINED_GAME, "entrou em nosso mundo"),
            (LEFT_GAME, "saiu de nosso mundo"),
            ("characterLevel", "Nv."),
            ("classAmazon", "Amazona"),
            ("classAssassin", "Assassina"),
            ("classNecromancer", "Necromante"),
            ("classSorceress", "Maga"),
            ("titleMatriarch", "Matriarca"),
            ("createNew", "Criar novo"),
            ("life", "Vida:"),
            ("mana", "Mana:"),
            ("difficultyLabel", "Dificuldade:"),
            ("selectDifficulty", "Selecionar dificuldade"),
            ("difficultyNormal", "Normal"),
            ("difficultyNightmare", "Pesadelo"),
            ("difficultyHell", "Tormento"),
            ("tabOnline", "Online"),
            ("tabOffline", "Offline"),
        ]
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
