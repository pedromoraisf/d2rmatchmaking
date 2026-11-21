// Fixture for the clipboard rule (AST-14): the adapter may write, never read.
pub fn copy_and_peek() {
    let _ = SetClipboardData;
    let _ = GetClipboardData;
}
