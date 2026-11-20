// Fixture for the capture scope rule (ADR 010, CAP-04).
pub fn capture() {
    let _hwnd = unsafe { GetDesktopWindow() };
}
