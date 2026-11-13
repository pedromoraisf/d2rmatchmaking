//! The one state the core publishes to the agent window (design.md § Data Models). Serialized as camelCase; the window
//! maps it to translated strings with a pure function, so the window holds no rule.

use serde::Serialize;

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
    pub rejected: Vec<RejectedSlot>,
    /// The outcome of the last character post: `not-sent`, `ok` or the kind of the error it carried.
    pub post: &'static str,
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
    /// The last look at the game window, once the agent has looked at one.
    pub diagnostics: Option<DiagnosticsView>,
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{
        AgentView, Connectivity, DiagnosticsView, PairingView, RejectedSlot, RoomView, UpdateView,
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
            }),
            update: UpdateView::Idle,
            ready_check_open: true,
            diagnostics: None,
        };

        assert_eq!(
            serde_json::to_value(&view).expect("the view serializes"),
            json!({
                "pairing": { "showingCode": { "code": "123456", "minutesLeft": 5 } },
                "connectivity": "connected",
                "room": { "gameName": "mmbaalh-12", "needsReveal": true, "matched": false },
                "update": "idle",
                "readyCheckOpen": true,
                "diagnostics": null,
            })
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
            diagnostics: None,
        };

        assert_eq!(
            serde_json::to_value(&view).expect("the view serializes"),
            json!({
                "pairing": "rateLimited",
                "connectivity": "unreachable",
                "room": null,
                "update": "required",
                "readyCheckOpen": false,
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
                "rejected": [{ "slot": 1, "reason": "name-disagree" }],
                "post": "not-sent",
            })
        );
    }
}
