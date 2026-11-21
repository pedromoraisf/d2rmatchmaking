// Fixture for the clipboard rule (AST-14): a write outside src/adapters/clipboard.rs is rejected.
pub fn copy() {
    let _ = SetClipboardData;
}
