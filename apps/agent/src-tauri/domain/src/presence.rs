//! The presence the heartbeat reports (AHM-12, AHM-15; AD-055): whether the game process runs and which screen the game
//! shows. Only process names are read, never handles. The screen is unknown until F2 reads it (AGS-10).

use crate::timings::GAME_PROCESS;

/// The screen the game shows, as far as the agent knows it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Screen {
    Unknown,
    AutomapOpen,
}

/// What the agent reports on each heartbeat: whether the game runs and which screen it shows.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Presence {
    pub game_running: bool,
    pub screen: Screen,
}

/// Whether a process named `D2R.exe` is in the snapshot. The names are compared ASCII case-insensitively (AD-055).
pub fn game_running(names: &[String]) -> bool {
    names
        .iter()
        .any(|name| name.eq_ignore_ascii_case(GAME_PROCESS))
}

#[cfg(test)]
mod tests {
    use super::game_running;

    #[test]
    fn game_running_matches_the_executable_name_only() {
        assert!(game_running(&["explorer.exe".into(), "d2r.exe".into()]));
        assert!(game_running(&["D2R.EXE".into()]));
        assert!(!game_running(&[
            "D2R.exe.bak".into(),
            "d2r-helper.exe".into()
        ]));
        assert!(!game_running(&[]));
    }
}
