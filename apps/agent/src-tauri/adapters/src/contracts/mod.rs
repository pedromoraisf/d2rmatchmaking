//! Generated contract types (AGS-03). Regenerate with `cargo run -p xtask -- contracts`; never edit `generated.rs`.
pub mod generated;
/// The agent JSON Schemas as text, generated with the types. Never edit `schemas.rs`.
pub mod schemas;

#[cfg(test)]
mod tests {
    use d2rmm_agent_core::secret::Secret;
    use serde_json::json;

    use super::generated::{ClaimRequest, ClaimResponse, PairingCodeResponse};

    const CLAIM_SECRET: &str = "claim-secret-7f3a9c1e5b2d";
    const TOKEN: &str = "d2rmm_a_0123456789abcdefghijklmnopqrstuvwxyzABCDE";

    #[test]
    fn secret_fields_are_redacted() {
        let pairing: PairingCodeResponse = serde_json::from_value(json!({
            "code": "123456",
            "expiresAt": "2026-10-31T10:05:00Z",
            "claimSecret": CLAIM_SECRET,
        }))
        .expect("the pairing code response parses");
        let request: ClaimRequest = serde_json::from_value(json!({ "claimSecret": CLAIM_SECRET }))
            .expect("the claim request parses");
        let claim: ClaimResponse =
            serde_json::from_value(json!({ "token": TOKEN })).expect("the claim response parses");

        for printed in [
            format!("{pairing:?}"),
            format!("{request:?}"),
            format!("{claim:?}"),
        ] {
            assert!(
                printed.contains("***"),
                "redacted marker missing: {printed}"
            );
            assert!(
                !printed.contains(CLAIM_SECRET),
                "claim secret printed: {printed}"
            );
            assert!(!printed.contains(TOKEN), "token printed: {printed}");
        }
        assert_eq!(format!("{}", Secret::new(TOKEN)), "***");
    }

    #[test]
    fn secret_serializes_only_where_sent() {
        let request: ClaimRequest = serde_json::from_value(json!({ "claimSecret": CLAIM_SECRET }))
            .expect("the claim request parses");

        let sent = serde_json::to_value(&request).expect("the claim request serializes");
        assert_eq!(sent, json!({ "claimSecret": CLAIM_SECRET }));

        let secret = Secret::new(CLAIM_SECRET);
        assert_eq!(secret.expose(), CLAIM_SECRET);
        assert_eq!(format!("{secret:?}"), "***");
    }
}
