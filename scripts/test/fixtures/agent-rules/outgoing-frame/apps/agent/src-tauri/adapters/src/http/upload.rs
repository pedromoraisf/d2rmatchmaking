use d2rmm_agent_core::ports::Rgba;

pub async fn send(client: &Client, frame: Rgba) {
    client.post("/v1/upload").body(frame.pixels).send().await;
}
