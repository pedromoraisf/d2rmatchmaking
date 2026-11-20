// Fixture for the capture scope rule (ADR 010, CAP-04).
pub fn capture() {
    unsafe { BitBlt(dest, 0, 0, w, h, Some(src), 0, 0, SRCCOPY)? };
}
