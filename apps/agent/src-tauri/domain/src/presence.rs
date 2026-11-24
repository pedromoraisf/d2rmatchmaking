//! The presence the heartbeat reports (AHM-12, AHM-15; AD-055): whether the game process runs and which screen the game
//! shows. Only process names are read, never handles. The screen comes from the frames the agent reads (CHR-04).

use crate::capture_cascade::CaptureMethod;
use crate::timings::GAME_PROCESS;

/// The screen the game shows, as far as the agent knows it (CHR-04). Any frame the agent cannot place is `Unknown`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Screen {
    Unknown,
    CharacterSelect,
    InGame,
    AutomapOpen,
}

/// What the capture is doing, as the heartbeat reports it (CAP-07): the method of the last usable frame and the usable share
/// of the last looks. Nothing about a frame.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct CaptureReport {
    /// `None` while no method gave a usable frame: the heartbeat says `none`.
    pub method: Option<CaptureMethod>,
    /// A whole percent, 0 to 100.
    pub read_rate_percent: u8,
}

impl CaptureReport {
    /// The method's fixed word, or `none`.
    pub fn method_word(self) -> &'static str {
        self.method.map_or("none", CaptureMethod::word)
    }
}

/// What the agent reports on each heartbeat: whether the game runs, which screen it shows and what the capture is doing.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Presence {
    pub game_running: bool,
    pub screen: Screen,
    pub capture: CaptureReport,
}

/// Whether a process named `D2R.exe` is in the snapshot. The names are compared ASCII case-insensitively (AD-055).
pub fn game_running(names: &[String]) -> bool {
    names
        .iter()
        .any(|name| name.eq_ignore_ascii_case(GAME_PROCESS))
}

#[cfg(test)]
mod tests {
    use super::{CaptureReport, game_running};
    use crate::capture_cascade::CaptureMethod;

    #[test]
    fn the_report_says_none_until_a_method_gave_a_frame() {
        assert_eq!(CaptureReport::default().method_word(), "none");
        let report = CaptureReport {
            method: Some(CaptureMethod::GraphicsCapture),
            read_rate_percent: 97,
        };
        assert_eq!(report.method_word(), "graphics-capture");
    }

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
