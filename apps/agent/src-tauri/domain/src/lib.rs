//! Agent domain: the rules of the desktop agent (ADR 027). No I/O, no async, no clock, no randomness, no contract types.
//! Time and identifiers enter as arguments.
#![forbid(unsafe_code)]

#[cfg(test)]
mod tests {
    #[test]
    fn domain_crate_builds() {
        assert_eq!(env!("CARGO_PKG_NAME"), "d2rmm-agent-domain");
    }
}
