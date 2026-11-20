pub fn leak(token: &Secret) -> String {
    token.expose().to_string()
}
