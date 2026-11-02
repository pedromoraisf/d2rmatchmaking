//! The API base the adapters call (AGS-04). The core knows only its version; the base is an HTTP concern and lives here.

use url::Url;

/// Whether `http://127.0.0.1` and `http://localhost` are accepted. Only debug builds pass `Yes`.
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

fn is_loopback(url: &Url) -> bool {
    matches!(url.host_str(), Some("127.0.0.1" | "localhost"))
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
}
