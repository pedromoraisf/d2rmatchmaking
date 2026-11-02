//! A test helper with no assertion: it builds a value and holds nothing a test could weaken.
pub fn helper() -> u32 {
    let base = 1;
    base + 1
}
