//! Agent adapters: the HTTP gateway, the generated contracts, the translation to the core's messages and the SSE parser
//! (ADR 027). Nothing here depends on Tauri, keyring or Windows.
#![forbid(unsafe_code)]

#[cfg(test)]
mod tests {
    #[test]
    fn adapters_crate_builds() {
        assert_eq!(env!("CARGO_PKG_NAME"), "d2rmm-agent-adapters");
    }
}
