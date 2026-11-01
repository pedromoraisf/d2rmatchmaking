//! The wrapper for the claim secret and the token (AGS-09). It prints `***`, zeroes its memory on drop and serializes
//! only through `expose`, which the generated contract fields that send it name with `serialize_with`.

use std::fmt;

use serde::{Deserialize, Serializer};
use zeroize::Zeroize;

/// A value that must never reach a log, a span or a file. Only the API client and the token store call `expose`.
#[derive(Clone, PartialEq, Eq, Deserialize)]
#[serde(transparent)]
pub struct Secret(String);

impl Secret {
    /// Wraps a value received from the API or read from the token store.
    pub fn new(value: impl Into<String>) -> Self {
        Self(value.into())
    }

    /// The secret text. Only the API client and the token store call this.
    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl Drop for Secret {
    fn drop(&mut self) {
        self.0.zeroize();
    }
}

impl fmt::Debug for Secret {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("***")
    }
}

impl fmt::Display for Secret {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("***")
    }
}

/// The `serialize_with` target of the contract fields that carry a secret. `Secret` has no `Serialize` impl of its own.
pub fn expose<S: Serializer>(secret: &Secret, serializer: S) -> Result<S::Ok, S::Error> {
    serializer.serialize_str(secret.expose())
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::Secret;
    use crate::contracts::generated::{ClaimRequest, ClaimResponse, PairingCodeResponse};

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
