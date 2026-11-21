// A fixture the name-in-telemetry rule must reject in the HTTP adapters: the name in a span and in an event.
pub fn body(value: &PlayerObservation) {
    let span = tracing::info_span!("agent.http.chat", player = value.name());
    tracing::debug!(seen = %value.name(), "agent.http.chat");
}
