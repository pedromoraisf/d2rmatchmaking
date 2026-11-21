//! The one state the core publishes to the agent window (design.md § Data Models). Serialized as camelCase; the window
//! maps it to translated strings with a pure function, so the window holds no rule.

use d2rmm_agent_domain::typing::HotkeyPair;
use serde::Serialize;

use crate::fill_name::FillOutcome;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum PairingView {
    Requesting,
    ShowingCode { code: String, minutes_left: u8 },
    Paused,
    RateLimited,
    Unreachable,
    SaveFailed,
    Paired,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Connectivity {
    Connected,
    Unreachable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum UpdateView {
    Idle,
    Failed,
    Required,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoomView {
    pub game_name: String,
    /// The Party panel showed the masked game name, so the player must click the eye (AGN-04). Cleared by a match.
    pub needs_reveal: bool,
    /// The Party panel showed the expected game name in this run, so the room's observation is sent (AGN-03).
    pub matched: bool,
    /// The API accepted the observation for this run (ARL-03). Sent only when true; the window then says "presence
    /// confirmed" instead of "waiting for the game". A new run or a dropped room clears it (ARL-04).
    #[serde(skip_serializing_if = "is_false")]
    pub confirmed: bool,
}

fn is_false(value: &bool) -> bool {
    !*value
}

/// One card slot that held text but settled no card, and the short code of the field that refused it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RejectedSlot {
    pub slot: u8,
    pub reason: &'static str,
}

/// What the last look at the game window read, for the player to see in the window and nowhere else (CHR-03, NFR-04).
/// Counts, sizes and codes only: never a character name, a line of game text or any pixel.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsView {
    /// The screen the frame was placed on: `unknown`, `characterSelect`, `inGame` or `automapOpen`.
    pub screen: &'static str,
    pub frame_width: u32,
    pub frame_height: u32,
    /// How many card slots held text.
    pub cards_read: u8,
    /// How many of them settled into a complete card.
    pub cards_settled: u8,
    /// How many popup options were found by their word (0 to 3). A count, never a text.
    pub popup_options_found: u8,
    pub rejected: Vec<RejectedSlot>,
    /// The outcome of the last character post: `not-sent`, `ok` or the kind of the error it carried.
    pub post: &'static str,
}

/// What the last Party look saw, as plain state for the diagnostics (never the text it read, NFR-04, NFR-05).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PartyLookView {
    /// The Party panel was open: its title read as its word.
    pub panel_open: bool,
    /// What the Game Name field showed: `notRead`, `empty`, `masked` or `text`.
    pub field: &'static str,
    /// The field read as the expected game name.
    pub matched: bool,
    /// How the field was read; `None` when it was not.
    pub detail: Option<FieldDetailView>,
}

/// How the Game Name field was read: where, by how many OCR variants and, for another name, the edit operations of the
/// closest variant against the expected name (`[a-z0-9 -]`, `?` for any other character, `far` past a few edits). Never text.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldDetailView {
    /// `label`, `labelLine` or `layoutBox`.
    pub source: &'static str,
    pub variants: usize,
    pub diff: Option<String>,
}

/// What the capture itself shows, to tell a wrong geometry from a blank frame (the Windows incident of 2026-11-19). Numbers
/// and booleans only: never a pixel, a text or a name.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureView {
    /// The mean luminance of the frame, 0 to 255.
    pub brightness: u8,
    /// The frame is uniform or near-black.
    pub blank: bool,
    /// The size of the whole game window (title bar and borders included), when the platform can say it.
    pub window_width: Option<u32>,
    pub window_height: Option<u32>,
    /// The last Party look of the held run; `None` before one was made, or without a held room.
    pub party: Option<PartyLookView>,
}

/// The two hotkeys as the window shows them, such as `Ctrl+Shift+A` (RDY-07, AST-01).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HotkeysView {
    pub accept: String,
    pub fill: String,
}

impl HotkeysView {
    pub fn of(pair: &HotkeyPair) -> Self {
        Self {
            accept: pair.accept().to_string(),
            fill: pair.fill().to_string(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentView {
    pub pairing: PairingView,
    pub connectivity: Connectivity,
    pub room: Option<RoomView>,
    pub update: UpdateView,
    /// A ready check is open for the account: the window shows the hotkey that accepts it (RDY-07).
    pub ready_check_open: bool,
    /// The keys that accept a ready check and fill the game name (AST-01).
    pub hotkeys: HotkeysView,
    /// What the last press of the fill hotkey did (AST-08); absent until the first press. A closed set of codes, no text.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_fill: Option<FillOutcome>,
    /// The last look at the game window, once the agent has looked at one.
    pub diagnostics: Option<DiagnosticsView>,
    /// What the capture showed in the last look; absent until the first frame.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub capture: Option<CaptureView>,
}

#[cfg(test)]
mod tests {
    use d2rmm_agent_domain::typing::HotkeyPair;
    use serde_json::json;

    use super::{
        AgentView, Connectivity, DiagnosticsView, FillOutcome, HotkeysView, PairingView,
        RejectedSlot, RoomView, UpdateView,
    };

    #[test]
    fn agent_view_serialises_in_camel_case() {
        let view = AgentView {
            pairing: PairingView::ShowingCode {
                code: "123456".to_string(),
                minutes_left: 5,
            },
            connectivity: Connectivity::Connected,
            room: Some(RoomView {
                game_name: "mmbaalh-12".to_string(),
                needs_reveal: true,
                matched: false,
                confirmed: false,
            }),
            update: UpdateView::Idle,
            ready_check_open: true,
            hotkeys: HotkeysView::of(&HotkeyPair::defaults()),
            last_fill: None,
            diagnostics: None,
            capture: None,
        };

        assert_eq!(
            serde_json::to_value(&view).expect("the view serializes"),
            json!({
                "pairing": { "showingCode": { "code": "123456", "minutesLeft": 5 } },
                "connectivity": "connected",
                "room": { "gameName": "mmbaalh-12", "needsReveal": true, "matched": false },
                "update": "idle",
                "readyCheckOpen": true,
                "hotkeys": { "accept": "Ctrl+Shift+A", "fill": "Ctrl+Shift+F" },
                "diagnostics": null,
            })
        );
    }

    #[test]
    fn a_confirmed_room_serialises_its_flag_and_an_unconfirmed_one_omits_it() {
        let room = |confirmed| RoomView {
            game_name: "mmbaalh-12".to_string(),
            needs_reveal: false,
            matched: true,
            confirmed,
        };

        assert_eq!(
            serde_json::to_value(room(true)).expect("the room serializes"),
            json!({ "gameName": "mmbaalh-12", "needsReveal": false, "matched": true, "confirmed": true })
        );
        assert_eq!(
            serde_json::to_value(room(false)).expect("the room serializes"),
            json!({ "gameName": "mmbaalh-12", "needsReveal": false, "matched": true })
        );
    }

    #[test]
    fn unit_states_serialise_as_camel_case_names() {
        let view = AgentView {
            pairing: PairingView::RateLimited,
            connectivity: Connectivity::Unreachable,
            room: None,
            update: UpdateView::Required,
            ready_check_open: false,
            hotkeys: HotkeysView::of(&HotkeyPair::defaults()),
            last_fill: Some(FillOutcome::RefusedKeys),
            diagnostics: None,
            capture: None,
        };

        assert_eq!(
            serde_json::to_value(&view).expect("the view serializes"),
            json!({
                "pairing": "rateLimited",
                "connectivity": "unreachable",
                "room": null,
                "update": "required",
                "readyCheckOpen": false,
                "hotkeys": { "accept": "Ctrl+Shift+A", "fill": "Ctrl+Shift+F" },
                "lastFill": "refused-keys",
                "diagnostics": null,
            })
        );
    }

    #[test]
    fn diagnostics_serialise_as_camel_case_counts_and_codes() {
        let diagnostics = DiagnosticsView {
            screen: "characterSelect",
            frame_width: 1920,
            frame_height: 1080,
            cards_read: 2,
            cards_settled: 1,
            popup_options_found: 2,
            rejected: vec![RejectedSlot {
                slot: 1,
                reason: "name-disagree",
            }],
            post: "not-sent",
        };

        assert_eq!(
            serde_json::to_value(&diagnostics).expect("the diagnostics serialize"),
            json!({
                "screen": "characterSelect",
                "frameWidth": 1920,
                "frameHeight": 1080,
                "cardsRead": 2,
                "cardsSettled": 1,
                "popupOptionsFound": 2,
                "rejected": [{ "slot": 1, "reason": "name-disagree" }],
                "post": "not-sent",
            })
        );
    }
    #[test]
    fn the_capture_serialises_as_numbers_and_codes_and_is_left_out_when_absent() {
        use super::{CaptureView, FieldDetailView, PartyLookView};
        let capture = CaptureView {
            brightness: 42,
            blank: false,
            window_width: Some(1936),
            window_height: None,
            party: Some(PartyLookView {
                panel_open: true,
                field: "text",
                matched: false,
                detail: Some(FieldDetailView {
                    source: "label",
                    variants: 3,
                    diff: Some("sub(l>9)@9".to_string()),
                }),
            }),
        };

        assert_eq!(
            serde_json::to_value(capture).expect("the capture serializes"),
            json!({
                "brightness": 42,
                "blank": false,
                "windowWidth": 1936,
                "windowHeight": null,
                "party": {
                    "panelOpen": true,
                    "field": "text",
                    "matched": false,
                    "detail": { "source": "label", "variants": 3, "diff": "sub(l>9)@9" },
                },
            })
        );
    }
}
