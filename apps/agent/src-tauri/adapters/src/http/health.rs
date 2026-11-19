//! The reachability probe of the app's `--self-check --online` (startup smoke check): one GET of `/healthz` with a short
//! timeout. It sends no token and no body, follows no redirect and answers only "reachable and healthy" or why not.

use std::time::Duration;

use reqwest::redirect::Policy;

use crate::config::ApiBase;

/// Why the probe failed. It carries no URL, so a log line never holds the base or a query.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum HealthError {
    #[error("the health URL could not be built")]
    Url,
    #[error("the API could not be reached")]
    Unreachable,
    #[error("the API answered with status {0}")]
    Status(u16),
}

/// GETs `/healthz` under `base` and succeeds on a 200.
pub async fn check(base: &ApiBase, timeout: Duration) -> Result<(), HealthError> {
    let url = base.url().join("healthz").map_err(|_| HealthError::Url)?;
    let client = reqwest::Client::builder()
        .https_only(base.url().scheme() == "https")
        .redirect(Policy::none())
        .timeout(timeout)
        .build()
        .map_err(|_| HealthError::Unreachable)?;
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|_| HealthError::Unreachable)?;
    match response.status().as_u16() {
        200 => Ok(()),
        other => Err(HealthError::Status(other)),
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    use super::{HealthError, check};
    use crate::config::{AllowLoopbackHttp, ApiBase};

    async fn serve_once(status_line: &'static str) -> ApiBase {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let address = listener.local_addr().expect("address");
        tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.expect("accept");
            let mut request = [0_u8; 2048];
            let read = socket.read(&mut request).await.expect("read");
            assert!(
                String::from_utf8_lossy(&request[..read]).starts_with("GET /healthz "),
                "the probe asks for /healthz"
            );
            let reply =
                format!("HTTP/1.1 {status_line}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
            socket.write_all(reply.as_bytes()).await.expect("write");
        });
        ApiBase::parse(&format!("http://{address}"), AllowLoopbackHttp::Yes).expect("loopback base")
    }

    #[tokio::test]
    async fn a_200_is_healthy() {
        let base = serve_once("200 OK").await;
        assert_eq!(check(&base, Duration::from_secs(5)).await, Ok(()));
    }

    #[tokio::test]
    async fn another_status_is_reported() {
        let base = serve_once("503 Service Unavailable").await;
        assert_eq!(
            check(&base, Duration::from_secs(5)).await,
            Err(HealthError::Status(503))
        );
    }

    #[tokio::test]
    async fn a_closed_port_is_unreachable() {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let address = listener.local_addr().expect("address");
        drop(listener);
        let base = ApiBase::parse(&format!("http://{address}"), AllowLoopbackHttp::Yes)
            .expect("loopback base");
        assert_eq!(
            check(&base, Duration::from_secs(5)).await,
            Err(HealthError::Unreachable)
        );
    }
}
