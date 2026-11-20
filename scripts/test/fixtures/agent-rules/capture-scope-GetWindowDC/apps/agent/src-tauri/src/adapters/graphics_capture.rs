// Fixture for the capture scope rule (ADR 010, CAP-04).
pub fn capture() {
    let _dc = unsafe { GetWindowDC(Some(window)) };
}
