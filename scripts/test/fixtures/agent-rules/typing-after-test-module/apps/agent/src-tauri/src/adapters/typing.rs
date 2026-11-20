// Fixture for the typing adapter rule: code after the unit-test module is still read, and a key named inside the module is not.
#![allow(unsafe_code)]

pub fn real() {}

#[cfg(test)]
mod tests {
    fn only_in_tests() {
        let _ = "}{";
        let _ = VK_F1;
    }
}

#[cfg(windows)]
mod sneaky {
    fn confirm() {
        let _ = VK_RETURN;
    }
}
