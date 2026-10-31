//! Real I/O under a paused clock. Tokio auto-advances the paused clock whenever the runtime is idle, even while a request
//! is in flight, which would fire timers (and client timeouts) inside an HTTP exchange. A running `spawn_blocking` task
//! inhibits that auto-advance (tokio's documented pattern), so requests complete at their real pace and the clock moves
//! only through `tokio::time::advance`.

use std::sync::mpsc::{Sender, channel};

/// Keeps the clock from auto-advancing for as long as it lives.
pub struct RealIo {
    release: Option<Sender<()>>,
}

/// Starts the inhibiting blocking task and waits until it runs. Call it inside a `start_paused` runtime.
pub async fn real_io() -> RealIo {
    let (started, has_started) = tokio::sync::oneshot::channel::<()>();
    let (release, released) = channel::<()>();
    tokio::task::spawn_blocking(move || {
        let _ = started.send(());
        let _ = released.recv();
    });
    let _ = has_started.await;
    RealIo {
        release: Some(release),
    }
}

impl Drop for RealIo {
    fn drop(&mut self) {
        if let Some(release) = self.release.take() {
            let _ = release.send(());
        }
    }
}
