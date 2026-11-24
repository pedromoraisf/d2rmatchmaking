pub fn header(token: &Secret) -> String {
    format!("token={}", token.expose())
}
