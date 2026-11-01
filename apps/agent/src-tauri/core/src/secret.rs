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
