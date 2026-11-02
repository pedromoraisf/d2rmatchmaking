//! The HTTP client the app builds for the gateway (design.md § API client; AGS-12, AGS-23). The gateway receives it already
//! configured: HTTPS only outside a debug build's loopback, no redirects, and the timeouts of design.md.

use std::time::Duration;

use reqwest::{Client, redirect::Policy};

use crate::config::ApiBase;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

/// Builds the client for `base`. Plain HTTP is reachable only when `ApiBase` accepted a loopback HTTP base, which only a
/// debug build can do; every other base is HTTPS-only. Redirects are never followed, so a 302 reaches the caller as is.
pub fn client(base: &ApiBase) -> reqwest::Result<Client> {
    Client::builder()
        .https_only(base.url().scheme() == "https")
        .redirect(Policy::none())
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(REQUEST_TIMEOUT)
        .build()
}

#[cfg(test)]
mod tests {
    use crate::config::{AllowLoopbackHttp, ApiBase};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    use super::client;

    /// A local server that answers every request with a 302 pointing at another host. A client that followed it would
    /// reach that host; the test asserts the 302 itself comes back.
    #[tokio::test]
    async fn client_follows_no_redirect() {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind a local port");
        let address = listener.local_addr().expect("local address");
        tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.expect("accept");
            let mut request = [0_u8; 2048];
            let _ = socket.read(&mut request).await;
            socket
                .write_all(
                    b"HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1:9/elsewhere\r\n\
                      Content-Length: 0\r\nConnection: close\r\n\r\n",
                )
                .await
                .expect("write the redirect");
        });

        let base = ApiBase::parse(&format!("http://{address}"), AllowLoopbackHttp::Yes)
            .expect("a loopback base is accepted in tests");
        let response = client(&base)
            .expect("the client builds")
            .get(format!("http://{address}/v1/agents/heartbeat"))
            .send()
            .await
            .expect("the local server answers");

        assert_eq!(response.status().as_u16(), 302);
        assert_eq!(
            response
                .headers()
                .get("location")
                .and_then(|value| value.to_str().ok()),
            Some("http://127.0.0.1:9/elsewhere"),
        );
    }
}
