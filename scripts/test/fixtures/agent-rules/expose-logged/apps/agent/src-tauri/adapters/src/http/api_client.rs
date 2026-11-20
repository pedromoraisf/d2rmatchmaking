pub fn header(token: &Secret) {
    let value = token.expose();
    tracing::info!("sending {value}");
}
