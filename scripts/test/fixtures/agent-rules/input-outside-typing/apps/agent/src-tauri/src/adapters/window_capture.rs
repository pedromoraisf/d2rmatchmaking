// Fixture for the input rule: window_capture.rs may not send input or allow the clippy ban on it.
#![allow(unsafe_code)]
#![allow(clippy::disallowed_methods)]
use windows::Win32::UI::Input::KeyboardAndMouse::SendInput;

pub fn press() {
    let _ = SendInput;
}
