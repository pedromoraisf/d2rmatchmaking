//! AGS-09, AGS-12: over a pair, heartbeat and 401 cycle neither the token nor the claim secret reaches a log line or a
//! span, and the six loop spans carry their names.

mod support;

use std::time::Duration;

use d2rmm_agent_core::ports::Rgba;
use d2rmm_agent_core::runtime::{Handle, Runtime};
use support::capture::Capture;
use support::fake_api::{Answer, CLAIM_SECRET, Operation, TOKEN};
use support::harness::{Harness, advance, count, settle, until};

fn start(h: &Harness) -> Handle {
    Runtime::start(&h.config(), reqwest::Client::new(), h.adapters())
}

#[tokio::test(start_paused = true)]
async fn no_secret_in_logs_or_spans() {
    let capture = Capture::new();
    let _subscriber = tracing::subscriber::set_default(capture.subscriber());
    let h = Harness::start(None).await;
    h.api
        .script(Operation::Heartbeat, [Answer::Ok, Answer::Unauthorized]);
    let _handle = start(&h);

    until("the first code", || {
        count(&h.api, Operation::RequestCode) == 1
    })
    .await;
    settle().await;
    advance(Duration::from_secs(2)).await;
    until("the token is stored", || {
        h.tokens.stored().as_deref() == Some(TOKEN)
    })
    .await;
    until("the first heartbeat", || {
        count(&h.api, Operation::Heartbeat) == 1
    })
    .await;

    advance(Duration::from_secs(15)).await;
    until("the heartbeat is answered 401", || {
        h.tokens.stored().is_none()
    })
    .await;
    until("a new code after the 401", || {
        count(&h.api, Operation::RequestCode) == 2
    })
    .await;
    assert_eq!(
        h.tokens.save_calls(),
        1,
        "the token is written once, through the store"
    );
    assert_eq!(
        h.tokens.delete_calls(),
        1,
        "the 401 deleted it through the store"
    );

    let text = capture.text();
    assert!(!text.contains(TOKEN), "the token reached a log or span");
    assert!(
        !text.contains(CLAIM_SECRET),
        "the claim secret reached a log or span"
    );
}

#[tokio::test(start_paused = true)]
async fn loop_spans_are_named() {
    let capture = Capture::new();
    let _subscriber = tracing::subscriber::set_default(capture.subscriber());
    let h = Harness::start(None).await;
    let handle = start(&h);

    until("the first code", || {
        count(&h.api, Operation::RequestCode) == 1
    })
    .await;
    settle().await;
    advance(Duration::from_secs(2)).await;
    until("the token is stored", || h.tokens.stored().is_some()).await;
    until("the stream is open", || {
        count(&h.api, Operation::Stream) == 1
    })
    .await;
    settle().await;

    let frame = Rgba {
        width: 1920,
        height: 1080,
        pixels: Vec::new(),
    };
    handle.read_once(frame);
    until("the observation is posted", || {
        count(&h.api, Operation::Observation) == 1
    })
    .await;

    let names: Vec<String> = capture.spans().into_iter().map(|span| span.name).collect();
    for expected in [
        "agent.heartbeat",
        "agent.pairing.claim",
        "agent.update.check",
        "agent.stream.connect",
        "agent.vision.read",
        "agent.observation.post",
    ] {
        assert!(
            names.iter().any(|name| name == expected),
            "{expected} is opened"
        );
    }
}
