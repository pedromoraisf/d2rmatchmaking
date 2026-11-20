use d2rmm_agent_core::ports::Rgba;

pub async fn send(client: &Client, frame: Rgba, batch: Bytes) {
    client.post("/v1/telemetry/traces").body(batch).body(frame.pixels).header("content-type", "image/png").send().await;
}
