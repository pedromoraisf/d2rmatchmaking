pub fn header(token: &Secret) {
    let value = token.expose();
    eprintln!("{value}");
}
