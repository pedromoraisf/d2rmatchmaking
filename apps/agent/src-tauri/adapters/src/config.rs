//! The API base the adapters call (AGS-04). The core knows only its version; the base is an HTTP concern and lives here.

use url::{Host, Url};

/// Whether literal loopback hosts (`127.0.0.0/8`, `::1`, `localhost`) are accepted over HTTP. Only debug builds and the
/// headless example pass `Yes`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AllowLoopbackHttp {
    Yes,
    No,
}

/// The API base URL. Outside loopback it is always `https://`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApiBase(Url);

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum ApiBaseError {
    #[error("the API base is not a URL")]
    Malformed,
    #[error("the API base must use https outside loopback")]
    Insecure,
}

impl ApiBase {
    /// Accepts `https://` URLs. Accepts `http://127.0.0.1` and `http://localhost` only when `loopback` allows it.
    pub fn parse(raw: &str, loopback: AllowLoopbackHttp) -> Result<Self, ApiBaseError> {
        let url = Url::parse(raw).map_err(|_| ApiBaseError::Malformed)?;
        let allowed = match url.scheme() {
            "https" => true,
            "http" => loopback == AllowLoopbackHttp::Yes && is_loopback(&url),
            _ => false,
        };
        if allowed {
            Ok(Self(url))
        } else {
            Err(ApiBaseError::Insecure)
        }
    }

    pub fn url(&self) -> &Url {
        &self.0
    }
}

/// Literal loopback hosts only (OBS-24): `127.0.0.0/8`, `::1` and `localhost`. A name that resolves to loopback, or an
/// IPv4-mapped IPv6 address, is refused.
fn is_loopback(url: &Url) -> bool {
    match url.host() {
        Some(Host::Domain(name)) => name == "localhost",
        Some(Host::Ipv4(address)) => address.is_loopback(),
        Some(Host::Ipv6(address)) => address.is_loopback(),
        None => false,
    }
}

#[cfg(test)]
mod tests {
    use super::{AllowLoopbackHttp, ApiBase, ApiBaseError};

    #[test]
    fn api_base_must_be_https_outside_loopback() {
        assert!(ApiBase::parse("https://api.example.test", AllowLoopbackHttp::No).is_ok());
        assert!(ApiBase::parse("http://127.0.0.1:8080", AllowLoopbackHttp::Yes).is_ok());
        assert!(ApiBase::parse("http://localhost:8080", AllowLoopbackHttp::Yes).is_ok());

        assert_eq!(
            ApiBase::parse("http://127.0.0.1:8080", AllowLoopbackHttp::No),
            Err(ApiBaseError::Insecure)
        );
        assert_eq!(
            ApiBase::parse("http://example.com", AllowLoopbackHttp::Yes),
            Err(ApiBaseError::Insecure)
        );
        assert_eq!(
            ApiBase::parse("http://example.com", AllowLoopbackHttp::No),
            Err(ApiBaseError::Insecure)
        );
    }

    #[test]
    fn api_base_rejects_other_schemes_and_garbage() {
        assert_eq!(
            ApiBase::parse("ftp://api.example.test", AllowLoopbackHttp::Yes),
            Err(ApiBaseError::Insecure)
        );
        assert_eq!(
            ApiBase::parse("not a url", AllowLoopbackHttp::No),
            Err(ApiBaseError::Malformed)
        );
    }

    #[test]
    fn loopback_http_is_accepted_for_literal_loopback_hosts_only() {
        for base in [
            "http://127.0.0.1:8080",
            "http://127.0.0.2:8080",
            "http://127.255.255.254",
            "http://[::1]:8080",
            "http://localhost:8080",
        ] {
            assert!(
                ApiBase::parse(base, AllowLoopbackHttp::Yes).is_ok(),
                "{base} is a literal loopback host"
            );
        }
        for base in [
            "http://10.0.0.1:8080",
            "http://0.0.0.0:8080",
            "http://[::2]:8080",
            "http://[::ffff:127.0.0.1]:8080",
            "http://localhost.example.com:8080",
            "http://127.0.0.1.example.com:8080",
            "http://example.com",
        ] {
            assert_eq!(
                ApiBase::parse(base, AllowLoopbackHttp::Yes),
                Err(ApiBaseError::Insecure),
                "{base} is not a literal loopback host"
            );
        }
    }
}
