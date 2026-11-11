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

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentView {
    pub pairing: PairingView,
    pub connectivity: Connectivity,
    pub room: Option<RoomView>,
    pub update: UpdateView,
    /// A ready check is open for the account: the window shows the hotkey that accepts it (RDY-07).
    pub ready_check_open: bool,
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{AgentView, Connectivity, PairingView, RoomView, UpdateView};

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
        };

        assert_eq!(
            serde_json::to_value(&view).expect("the view serializes"),
            json!({
                "pairing": { "showingCode": { "code": "123456", "minutesLeft": 5 } },
                "connectivity": "connected",
                "room": { "gameName": "mmbaalh-12", "needsReveal": true, "matched": false },
                "update": "idle",
                "readyCheckOpen": true,
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
        };

        assert_eq!(
            serde_json::to_value(&view).expect("the view serializes"),
            json!({
                "pairing": "rateLimited",
                "connectivity": "unreachable",
                "room": null,
                "update": "required",
                "readyCheckOpen": false,
            })
        );
    }
}
