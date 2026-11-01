//! The Credential Manager token store (design.md § Secret and ports; AGS-06, AGS-09). The token lives in the Windows
//! credential store under `service = "d2rmm-agent"`, `user = "agent-token"`, and nowhere else.

use d2rmm_agent_core::ports::{StoreError, TokenStore};
use d2rmm_agent_core::secret::Secret;
use keyring::Entry;

/// The credential store service name of the agent.
pub const SERVICE: &str = "d2rmm-agent";
/// The credential store user name holding the agent token.
pub const USER: &str = "agent-token";

/// The token in the Windows credential store. Its methods never log the value (AGS-09).
#[derive(Debug, Clone)]
pub struct KeyringTokenStore {
    service: String,
    user: String,
}

impl KeyringTokenStore {
    /// The agent's own entry: `d2rmm-agent` / `agent-token`.
    pub fn new() -> Self {
        Self::with_names(SERVICE, USER)
    }

    /// An entry under other names. Tests use it with a unique service name and remove the entry they wrote.
    pub fn with_names(service: &str, user: &str) -> Self {
        Self {
            service: service.to_string(),
            user: user.to_string(),
        }
    }

    fn entry(&self) -> keyring::Result<Entry> {
        Entry::new(&self.service, &self.user)
    }
}

impl Default for KeyringTokenStore {
    fn default() -> Self {
        Self::new()
    }
}

impl TokenStore for KeyringTokenStore {
    fn load(&self) -> Option<Secret> {
        self.entry().ok()?.get_password().ok().map(Secret::new)
    }

    fn save(&self, token: &Secret) -> Result<(), StoreError> {
        self.entry()
            .and_then(|entry| entry.set_password(token.expose()))
            .map_err(|_| StoreError)
    }

    fn delete(&self) {
        if let Ok(entry) = self.entry() {
            let _ = entry.delete_credential();
        }
    }
}

#[cfg(test)]
mod tests {
    use d2rmm_agent_core::ports::TokenStore;
    use d2rmm_agent_core::secret::Secret;

    use super::KeyringTokenStore;

    /// Save, load and delete under a unique service name that the test removes, so the agent's own entry is never touched.
    #[test]
    fn keyring_round_trip() {
        let unique = format!(
            "d2rmm-agent-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("the clock is after 1970")
                .as_nanos()
        );
        let store = KeyringTokenStore::with_names(&unique, "agent-token-test");
        let token = Secret::new("d2rmm_test_round_trip_token");

        store
            .save(&token)
            .expect("the credential store accepts the write");
        assert_eq!(store.load(), Some(token));
        store.delete();
        assert_eq!(store.load(), None, "delete removes the entry");
    }
}
