// A fixture the chat post rules must reject: a frame type, a raw body, and a name in a span, an event and a counter.
use crate::ports::Rgba;

pub async fn post(frame: &Rgba, name: &str, observation: &PlayerObservation) {
    let span = tracing::info_span!("agent.chat.post", player = name);
    tracing::info!(who = %observation.name(), "agent.chat.posts");
    tracing::warn!(
        outcome = "failed",
        seen = observation.name(),
        "agent.chat.posts"
    );
    client.post(url).body(frame.pixels.clone()).send().await;
}
