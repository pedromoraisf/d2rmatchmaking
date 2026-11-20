// Fixture for the typing adapter rule: a `//` inside a string literal does not start a comment.
#![allow(unsafe_code)]

pub fn confirm() -> u16 {
    let url = "http://x";
    VK_RETURN.0
}
pub fn tab() -> u16 {
    let c = '"';
    let s = "a // b";
    VK_TAB.0
} /* VK_ESCAPE */
