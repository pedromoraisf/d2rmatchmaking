//! Agent core: every rule the agent follows, behind ports. No Tauri, no Cargo features (AGS-01).
#![forbid(unsafe_code)]

#[cfg(test)]
mod tests {
    #[test]
    fn core_builds() {
        assert_eq!(env!("CARGO_PKG_NAME"), "d2rmm-agent-core");
    }
}
