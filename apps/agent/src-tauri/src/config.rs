//! The app's build-time configuration (design.md § Config; AGS-04, AGS-12). The API base URL is fixed at compile time and
//! the version comes from `tauri.conf.json` (`package_info`), never from `CARGO_PKG_VERSION`. Core receives a validated
//! `ApiBase`; the provider URL lives only in this crate.

use d2rmm_agent_core::config::{AllowLoopbackHttp, ApiBase, ApiBaseError, Config};

/// Why the app refuses to start.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum ConfigError {
    #[error("no API base URL was given at build time (D2RMM_API_BASE)")]
    MissingApiBase,
    #[error("the API base URL is not acceptable for this build")]
    InvalidApiBase(#[from] ApiBaseError),
}

/// The API base URL fixed at compile time from `D2RMM_API_BASE`.
#[allow(dead_code)] // wired into main by T27
pub fn build_api_base() -> Option<&'static str> {
    option_env!("D2RMM_API_BASE")
}

/// Validates the API base of a build. A release build accepts only `https://`; a debug build also accepts the loopback
/// addresses over plain HTTP, which the local runs and observability-e2e use.
#[allow(dead_code)] // wired into main by T27
pub fn api_base(raw: Option<&str>, release: bool) -> Result<ApiBase, ConfigError> {
    let raw = raw.ok_or(ConfigError::MissingApiBase)?;
    let loopback = if release {
        AllowLoopbackHttp::No
    } else {
        AllowLoopbackHttp::Yes
    };
    Ok(ApiBase::parse(raw, loopback)?)
}

/// What the core receives at start: the version read from the package info and the validated API base.
#[allow(dead_code)] // wired into main by T27
pub fn core_config(version: &str, api_base: ApiBase) -> Config {
    Config {
        version: version.to_string(),
        api_base,
    }
}

#[cfg(test)]
mod tests {
    use super::{ConfigError, api_base, core_config};
    use d2rmm_agent_core::config::ApiBaseError;

    #[test]
    fn release_requires_https_api_base() {
        assert_eq!(
            api_base(None, true),
            Err(ConfigError::MissingApiBase),
            "a release build without an API base refuses to start"
        );
        assert_eq!(
            api_base(Some("http://api.example.test"), true),
            Err(ConfigError::InvalidApiBase(ApiBaseError::Insecure)),
        );
        assert_eq!(
            api_base(Some("http://127.0.0.1:8080"), true),
            Err(ConfigError::InvalidApiBase(ApiBaseError::Insecure)),
            "loopback HTTP is a debug-only exception"
        );
        let base = api_base(Some("https://api.example.test"), true).expect("https is accepted");
        assert_eq!(base.url().scheme(), "https");
    }

    #[test]
    fn release_refuses_a_malformed_api_base() {
        assert_eq!(
            api_base(Some("not a url"), true),
            Err(ConfigError::InvalidApiBase(ApiBaseError::Malformed)),
        );
    }

    #[test]
    fn debug_build_accepts_loopback_http_base() {
        let base = api_base(Some("http://localhost:8080"), false).expect("loopback is accepted");
        assert_eq!(base.url().as_str(), "http://localhost:8080/");
        assert_eq!(
            api_base(Some("http://example.test"), false),
            Err(ConfigError::InvalidApiBase(ApiBaseError::Insecure)),
            "a debug build still refuses plain HTTP to a remote host"
        );
    }

    #[test]
    fn core_config_carries_the_given_version() {
        let base = api_base(Some("https://api.example.test"), true).expect("https is accepted");
        let config = core_config("1.2.3", base.clone());
        assert_eq!(config.version, "1.2.3");
        assert_eq!(config.api_base, base);
    }
}
