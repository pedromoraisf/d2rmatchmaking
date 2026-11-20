#[cfg(test)]
use std::fmt::Write;

pub fn leak(token: &Secret) -> String {
    token.expose().to_string()
}

#[cfg(test)]
mod tests {}
